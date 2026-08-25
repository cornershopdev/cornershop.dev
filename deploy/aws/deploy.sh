#!/usr/bin/env bash
set -Eeuo pipefail

artifact_uri="${1:-}"
image_name="${2:-}"
if [[ ! "$artifact_uri" =~ ^s3://cornershopdev-production-deploy-[a-z0-9-]+/images/[0-9a-f]{40}\.tar\.gz$ ]]; then
  echo "Invalid deployment artifact URI" >&2
  exit 2
fi
if [[ ! "$image_name" =~ ^cornershopdev:[0-9a-f]{40}$ ]]; then
  echo "Invalid deployment image name" >&2
  exit 2
fi
readonly container="api-cornershop-dev"
readonly candidate="${container}-candidate"
readonly previous="${container}-previous"
readonly deployed_sha="${image_name#cornershopdev:}"
readonly expected_bootstrap_sha256="e9634ec4452851279a933eb0e423b1239bebdc84c87f0bf9ef9a9ac4bef375f5"
readonly expected_caddy_fragment_sha256="9f0bb5f0c1d9cc0e4b341b2795c6c63563aff918c4e47a8570fcecc23ec72b70"
readonly expected_host_launcher_sha256="75aa0e06cf621dd7c9c742b6a73e45a1d8c23dc7720feab08547253f1e934abc"
readonly article_gate_body="Article mutations are temporarily gated for a safe release."

install -d -m 700 /etc/cornershopdev /var/lib/cornershopdev
environment_file="/etc/cornershopdev/production.env"
temporary_environment="$(mktemp /etc/cornershopdev/production.env.XXXXXX)"
artifact_file="$(mktemp /var/lib/cornershopdev/image.XXXXXX.tar.gz)"
bootstrap_file="$(mktemp /var/lib/cornershopdev/bootstrap.XXXXXX.sh)"
caddy_fragment_file="$(mktemp /var/lib/cornershopdev/Caddyfile.XXXXXX.fragment)"
host_launcher_file="$(mktemp /var/lib/cornershopdev/launcher.XXXXXX.sh)"
trap 'rm -f "$temporary_environment" "$artifact_file" "$bootstrap_file" "$caddy_fragment_file" "$host_launcher_file"' EXIT
umask 077

reload_caddy() {
  docker exec shipshit-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
}

set_article_edge_gate() {
  local state="$1"
  if [[ "$state" != "closed" && "$state" != "open" ]]; then
    echo "Article edge gate state must be closed or open" >&2
    return 2
  fi
  local caddyfile="/etc/caddy/Caddyfile"
  local stripped
  local candidate_config
  stripped="$(mktemp /etc/caddy/Caddyfile.article-stripped.XXXXXX)"
  candidate_config="$(mktemp /etc/caddy/Caddyfile.article-candidate.XXXXXX)"
  awk '
    /^[[:space:]]*# BEGIN ARTICLE MUTATION GATE$/ { gate = 1; next }
    /^[[:space:]]*# END ARTICLE MUTATION GATE$/ { gate = 0; next }
    !gate { print }
  ' "$caddyfile" >"$stripped"
  awk -v state="$state" -v body="$article_gate_body" '
    /^# BEGIN CORNERSHOPDEV$/ { managed = 1 }
    /^# END CORNERSHOPDEV$/ { managed = 0 }
    {
      print
      if (
        state == "closed" && managed &&
        ($0 == "api.cornershop.dev {" || $0 == "https:// {")
      ) {
        print "\t# BEGIN ARTICLE MUTATION GATE"
        print "\t@articleMutations {"
        print "\t\tmethod POST"
        print "\t\tpath /api/sites/*/articles /api/sites/*/articles/generate"
        print "\t}"
        print "\trespond @articleMutations \"" body "\" 503"
        print "\t# END ARTICLE MUTATION GATE"
      }
    }
  ' "$stripped" >"$candidate_config"
  local container_candidate="/etc/caddy/.cornershopdev-article-gate.Caddyfile"
  if ! docker cp "$candidate_config" "shipshit-caddy:$container_candidate"; then
    rm -f "$stripped" "$candidate_config"
    return 1
  fi
  if ! docker exec shipshit-caddy caddy validate --config "$container_candidate"; then
    docker exec shipshit-caddy rm -f "$container_candidate" || true
    rm -f "$stripped" "$candidate_config"
    return 1
  fi
  docker exec shipshit-caddy rm -f "$container_candidate" || true
  cat "$candidate_config" >"$caddyfile"
  chmod 644 "$caddyfile"
  rm -f "$stripped" "$candidate_config"
  reload_caddy
}

verify_article_edge_gate() {
  local expected_state="$1"
  local response
  for origin in "https://api.cornershop.dev" "https://cornershop.dev"; do
    response="$(
      curl --silent --show-error --max-time 10 \
        --request POST \
        --header 'Content-Type: application/json' \
        --data '{"count":1}' \
        --write-out $'\n%{http_code}' \
        "${origin}/api/sites/__article-rollout__/articles/generate"
    )"
    local status="${response##*$'\n'}"
    local body="${response%$'\n'*}"
    if [[ "$expected_state" == "closed" ]]; then
      if [[ "$status" != "503" || "$body" != "$article_gate_body" ]]; then
        echo "Article edge gate did not close ${origin}" >&2
        return 1
      fi
    elif [[ "$status" == "503" && "$body" == "$article_gate_body" ]]; then
      echo "Article edge gate remained closed on ${origin}" >&2
      return 1
    fi
  done
}

required_parameters=(
  AWS_REGION
  BETTER_AUTH_SECRET
  CLAIM_TOKEN_SECRET
  CUSTOM_DOMAIN_CNAME
  DATABASE_URL
  FIRST_CUSTOMER_EVIDENCE_PUBLIC_KEY
  HEALTHCHECK_TOKEN
  NEXT_PUBLIC_APP_URL
  OUTREACH_LEGAL_CONTROLLER
  OPERATOR_ALERT_EMAILS
  PLATFORM_HOSTNAMES
  PUBLIC_APP_IP
  REDIS_URL
  RESEND_API_KEY
  RESEND_INBOUND_WEBHOOK_SECRET
  RESEND_WEBHOOK_SECRET
  S3_BUCKET
  S3_PUBLIC_BASE_URL
  STRIPE_SECRET_KEY
  STRIPE_PRICE_ID
  STRIPE_WEBHOOK_SECRET
  SUPERADMIN_EMAILS
  WORKFLOW_POSTGRES_JOB_PREFIX
  WORKFLOW_POSTGRES_MAX_POOL_SIZE
  WORKFLOW_POSTGRES_URL
  WORKFLOW_POSTGRES_WORKER_CONCURRENCY
  WORKFLOW_TARGET_WORLD
  WORKFLOW_ENABLED
)
optional_parameters=(
  AI_GATEWAY_API_KEY
  AI_IMAGE_MODEL
  AI_TEXT_MODEL
  EMAIL_FROM
  EMAIL_REPLY_TO
  GOOGLE_PLACES_API_KEY
  LEAD_DISCOVERY_NOMINATIM_BASE_URL
  OPENROUTER_API_KEY
  OPENROUTER_IMAGE_MODEL
  OPENROUTER_TEXT_MODEL
  OUTREACH_INBOUND_FORWARD_TO
  PHOTO_DISCOVERY_MAX_IMAGES
  PHOTO_ENHANCEMENT_BATCH_MAX_IMAGES
  PHOTO_ENHANCEMENT_CONCURRENCY
  PHOTO_ENHANCEMENT_ESTIMATED_COST_MICROS
  PHOTO_ENHANCEMENT_MODEL
  PHOTO_ENHANCEMENT_PER_IMAGE_CEILING_MICROS
  PHOTO_ENHANCEMENT_PER_SITE_CEILING_MICROS
  PHOTO_INGEST_CONCURRENCY
)

read_parameter() {
  local key="$1"
  aws ssm get-parameter \
    --region us-east-1 \
    --name "/shipshit/production/cornershopdev/${key}" \
    --with-decryption \
    --query "Parameter.Value" \
    --output text
}

download_verified_companion() {
  local uri="$1"
  local destination="$2"
  local expected_sha256="$3"
  local label="$4"
  aws s3 cp \
    "$uri" \
    "$destination" \
    --region us-west-1 \
    --only-show-errors
  local actual_sha256
  actual_sha256="$(sha256sum "$destination" | awk '{print $1}')"
  if [[ "$actual_sha256" != "$expected_sha256" ]]; then
    echo "${label} checksum mismatch" >&2
    exit 1
  fi
}

companion_prefix="${artifact_uri%.tar.gz}"
download_verified_companion \
  "${companion_prefix}.bootstrap-host.sh" \
  "$bootstrap_file" \
  "$expected_bootstrap_sha256" \
  "Host bootstrap"
download_verified_companion \
  "${companion_prefix}.Caddyfile.fragment" \
  "$caddy_fragment_file" \
  "$expected_caddy_fragment_sha256" \
  "Caddy fragment"
download_verified_companion \
  "${companion_prefix}.host-launcher.sh" \
  "$host_launcher_file" \
  "$expected_host_launcher_sha256" \
  "Host launcher"

for key in "${required_parameters[@]}"; do
  value="$(read_parameter "$key")"
  if [[ -z "$value" || "$value" == "None" ]]; then
    echo "Required parameter ${key} is empty" >&2
    exit 1
  fi
  printf '%s=%s\n' "$key" "$value" >>"$temporary_environment"
done

# Deployment provenance is supplied by the immutable image name, not by SSM.
# Scripts and evidence may read it, but operators cannot configure a different
# SHA than the artifact the launcher verified and Docker loaded.
printf '%s=%s\n' "DEPLOYED_GIT_SHA" "$deployed_sha" >>"$temporary_environment"

for key in "${optional_parameters[@]}"; do
  if value="$(read_parameter "$key" 2>/dev/null)" && [[ -n "$value" && "$value" != "None" ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$temporary_environment"
  fi
done
install -m 600 "$temporary_environment" "$environment_file"
echo "release-state configuration-loaded sha=${deployed_sha}"

chmod 500 "$bootstrap_file" "$host_launcher_file"
"$bootstrap_file" "$host_launcher_file" "$caddy_fragment_file"
echo "release-state caddy-configured sha=${deployed_sha}"

docker network inspect shipshit >/dev/null

aws s3 cp "$artifact_uri" "$artifact_file" --region us-west-1 --only-show-errors
gzip -dc "$artifact_file" | docker load >/dev/null
docker image inspect "$image_name" >/dev/null

wait_for_health() {
  # `container` is a script-wide readonly; a local of the same name would abort
  # the function under `set -u` on bash < 5 with "readonly variable".
  local watched_container="$1"
  for _ in $(seq 1 36); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$watched_container")"
    if [[ "$status" == "healthy" ]]; then return 0; fi
    if [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]]; then
      docker logs --tail 120 "$watched_container" >&2
      return 1
    fi
    sleep 5
  done
  docker logs --tail 120 "$watched_container" >&2
  return 1
}

run_article_rollout() {
  local action="$1"
  docker run --rm \
    --network shipshit \
    --env-file "$environment_file" \
    --entrypoint bun \
    "$image_name" \
    run operator:article-rollout --action "$action"
}

wait_for_article_quiescence() {
  for _ in $(seq 1 120); do
    if run_article_rollout check >/dev/null 2>&1; then return 0; fi
    sleep 5
  done
  run_article_rollout check
  return 1
}

article_rollout_active=0
rollback_article_rollout() {
  local failure_status="${1:-1}"
  trap - ERR
  set +e
  local edge_gate_verified=0
  local database_gate_verified=0
  if [[ "$article_rollout_active" == 1 ]]; then
    echo "Article rollout failed; retaining both mutation gates" >&2
    if set_article_edge_gate closed && verify_article_edge_gate closed; then
      edge_gate_verified=1
    fi
    if run_article_rollout close >/dev/null; then
      database_gate_verified=1
    fi
  fi
  docker rm -f "$candidate" >/dev/null 2>&1
  if
    [[ "$article_rollout_active" == 1 ]] &&
    [[ "$edge_gate_verified" != 1 || "$database_gate_verified" != 1 ]]
  then
    echo "Article gates could not be verified; leaving application containers stopped" >&2
    docker stop "$container" >/dev/null 2>&1
    docker stop "$previous" >/dev/null 2>&1
    return "$failure_status"
  fi
  if docker inspect "$previous" >/dev/null 2>&1; then
    docker rm -f "$container" >/dev/null 2>&1
    docker rename "$previous" "$container"
    docker start "$container" >/dev/null
    reload_caddy
  fi
  return "$failure_status"
}

# Close both public article mutation routes before any schema change. The
# database setting exists on the predecessor schema and is also asserted by the
# expand migration, so a candidate or rollback cannot reopen itself.
set_article_edge_gate closed
verify_article_edge_gate closed
article_rollout_active=1
trap 'rollback_article_rollout $?' ERR
run_article_rollout close >/dev/null
echo "release-state article-mutations-gated sha=${deployed_sha}"

# Run from the reviewed image before its entrypoint can apply migrations. This
# uses only predecessor-schema columns and blocks a chargeable legacy Checkout
# from being stranded by the migration. Remediation is an explicit operator
# procedure after the matching Stripe Session has been expired.
docker run --rm \
  --network shipshit \
  --env-file "$environment_file" \
  --entrypoint bun \
  "$image_name" \
  run operator:preflight-first-customer-migration \
  --environment production \
  --mode check \
  --execute >/dev/null

docker run --rm \
  --network shipshit \
  --env-file "$environment_file" \
  --entrypoint bun \
  "$image_name" \
  run db:migrate:deploy
echo "release-state migrations-applied sha=${deployed_sha}"

# The predecessor remains alive behind the edge gate while its already-bound
# work drains. Workflow run state is authoritative; passive timestamps never
# participate. Graphile flow/step jobs must be absent too.
wait_for_article_quiescence
echo "release-state article-workflow-drained sha=${deployed_sha}"

docker rm -f "$previous" >/dev/null 2>&1 || true
if docker inspect "$container" >/dev/null 2>&1; then
  docker stop "$container" >/dev/null
  docker rename "$container" "$previous"
fi
run_article_rollout check >/dev/null
echo "release-state predecessor-worker-stopped sha=${deployed_sha}"

docker run --rm \
  --network shipshit \
  --env-file "$environment_file" \
  --entrypoint bun \
  "$image_name" \
  run workflow:migrate

docker rm -f "$candidate" >/dev/null 2>&1 || true
docker run -d \
  --name "$candidate" \
  --network shipshit \
  --env-file "$environment_file" \
  --env CORNERSHOP_SKIP_STARTUP_MIGRATIONS=true \
  --restart no \
  --memory 768m \
  --cpus 1 \
  "$image_name" >/dev/null

wait_for_health "$candidate"
candidate_image="$(docker inspect --format '{{.Config.Image}}' "$candidate")"
if [[ "$candidate_image" != "$image_name" ]]; then
  echo "Candidate image does not match the reviewed artifact" >&2
  exit 1
fi
docker exec "$candidate" bun run db:migrate:status
docker exec "$candidate" bun run operator:article-rollout --action check >/dev/null
echo "release-state article-candidate-verified sha=${deployed_sha}"
docker exec "$candidate" \
  bun run operator:preflight-outreach --environment production
echo "release-state outreach-configured sha=${deployed_sha}"
docker exec "$candidate" \
  bun run operator:preflight-platform-edge --phase dns
echo "release-state wildcard-dns-ready sha=${deployed_sha}"
# One deployment-time provider read proves the configured live Price still
# matches the approved founding offer. It is intentionally separate from the
# five-second health probe so normal readiness never hammers Stripe.
docker exec "$candidate" bun run operator:preflight-stripe --mode live >/dev/null
docker rename "$candidate" "$container"
docker update --restart unless-stopped "$container" >/dev/null

if ! reload_caddy || ! wait_for_health "$container"; then
  echo "Deployment failed after cutover; rolling back" >&2
  false
fi

if ! docker exec "$container" \
  bun run operator:preflight-platform-edge --phase tls; then
  echo "Platform TLS preflight failed after cutover; rolling back" >&2
  false
fi
echo "release-state platform-tls-ready sha=${deployed_sha}"

# Open the application setting first, then the edge. If either operation fails,
# the ERR handler recloses both and any predecessor rollback remains gated.
docker exec "$container" bun run operator:article-rollout --action open >/dev/null
set_article_edge_gate open
verify_article_edge_gate open
article_rollout_active=0
trap - ERR
echo "release-state article-mutations-open sha=${deployed_sha}"

echo "release-state production-deployed sha=${deployed_sha}"

docker rm -f "$previous" >/dev/null 2>&1 || true

monitor_service="/etc/systemd/system/cornershopdev-public-health.service"
monitor_timer="/etc/systemd/system/cornershopdev-public-health.timer"
alert_service="/etc/systemd/system/cornershopdev-operator-alerts.service"
alert_timer="/etc/systemd/system/cornershopdev-operator-alerts.timer"
forward_service="/etc/systemd/system/cornershopdev-inbound-forwards.service"
forward_timer="/etc/systemd/system/cornershopdev-inbound-forwards.timer"
temporary_monitor_service="$(mktemp /etc/systemd/system/cornershopdev-public-health.service.XXXXXX)"
temporary_monitor_timer="$(mktemp /etc/systemd/system/cornershopdev-public-health.timer.XXXXXX)"
temporary_alert_service="$(mktemp /etc/systemd/system/cornershopdev-operator-alerts.service.XXXXXX)"
temporary_alert_timer="$(mktemp /etc/systemd/system/cornershopdev-operator-alerts.timer.XXXXXX)"
temporary_forward_service="$(mktemp /etc/systemd/system/cornershopdev-inbound-forwards.service.XXXXXX)"
temporary_forward_timer="$(mktemp /etc/systemd/system/cornershopdev-inbound-forwards.timer.XXXXXX)"
trap 'rm -f "$temporary_environment" "$artifact_file" "$bootstrap_file" "$caddy_fragment_file" "$host_launcher_file" "$temporary_monitor_service" "$temporary_monitor_timer" "$temporary_alert_service" "$temporary_alert_timer" "$temporary_forward_service" "$temporary_forward_timer"' EXIT

{
  printf '%s\n' '[Unit]'
  printf '%s\n' 'Description=Cornershopdev public-site health check'
  printf '%s\n' 'After=docker.service network-online.target'
  printf '%s\n' 'Wants=network-online.target'
  printf '\n%s\n' '[Service]'
  printf '%s\n' 'Type=oneshot'
  printf '%s\n' 'TimeoutStartSec=45s'
  printf '%s\n' "ExecStart=/usr/bin/docker run --rm --network shipshit --memory 256m --cpus 0.25 --env-file ${environment_file} --entrypoint bun ${image_name} run operator:monitor-public-site --execute"
} >"$temporary_monitor_service"

{
  printf '%s\n' '[Unit]'
  printf '%s\n' 'Description=Check Cornershopdev public health every two minutes'
  printf '\n%s\n' '[Timer]'
  printf '%s\n' 'OnBootSec=2min'
  printf '%s\n' 'OnUnitActiveSec=2min'
  printf '%s\n' 'RandomizedDelaySec=15s'
  printf '%s\n' 'Persistent=true'
  printf '\n%s\n' '[Install]'
  printf '%s\n' 'WantedBy=timers.target'
} >"$temporary_monitor_timer"

{
  printf '%s\n' '[Unit]'
  printf '%s\n' 'Description=Dispatch due Cornershopdev operator alerts'
  printf '%s\n' 'After=docker.service network-online.target'
  printf '%s\n' 'Wants=network-online.target'
  printf '\n%s\n' '[Service]'
  printf '%s\n' 'Type=oneshot'
  printf '%s\n' 'TimeoutStartSec=45s'
  printf '%s\n' "ExecStart=/usr/bin/docker run --rm --network shipshit --memory 256m --cpus 0.25 --env-file ${environment_file} --entrypoint bun ${image_name} run operator:dispatch-alerts"
} >"$temporary_alert_service"

{
  printf '%s\n' '[Unit]'
  printf '%s\n' 'Description=Dispatch Cornershopdev operator alerts every minute'
  printf '\n%s\n' '[Timer]'
  printf '%s\n' 'OnBootSec=1min'
  printf '%s\n' 'OnUnitActiveSec=1min'
  printf '%s\n' 'RandomizedDelaySec=15s'
  printf '%s\n' 'Persistent=true'
  printf '\n%s\n' '[Install]'
  printf '%s\n' 'WantedBy=timers.target'
} >"$temporary_alert_timer"

{
  printf '%s\n' '[Unit]'
  printf '%s\n' 'Description=Dispatch due Cornershopdev inbound read copies'
  printf '%s\n' 'After=docker.service network-online.target'
  printf '%s\n' 'Wants=network-online.target'
  printf '\n%s\n' '[Service]'
  printf '%s\n' 'Type=oneshot'
  printf '%s\n' 'TimeoutStartSec=55s'
  printf '%s\n' "ExecStart=/usr/bin/docker run --rm --network shipshit --memory 256m --cpus 0.25 --env-file ${environment_file} --entrypoint bun ${image_name} run operator:dispatch-inbound-forwards"
} >"$temporary_forward_service"

{
  printf '%s\n' '[Unit]'
  printf '%s\n' 'Description=Dispatch Cornershopdev inbound read copies every minute'
  printf '\n%s\n' '[Timer]'
  printf '%s\n' 'OnBootSec=1min'
  printf '%s\n' 'OnUnitActiveSec=1min'
  printf '%s\n' 'RandomizedDelaySec=15s'
  printf '%s\n' 'Persistent=true'
  printf '\n%s\n' '[Install]'
  printf '%s\n' 'WantedBy=timers.target'
} >"$temporary_forward_timer"

install -m 644 "$temporary_monitor_service" "$monitor_service"
install -m 644 "$temporary_monitor_timer" "$monitor_timer"
install -m 644 "$temporary_alert_service" "$alert_service"
install -m 644 "$temporary_alert_timer" "$alert_timer"
install -m 644 "$temporary_forward_service" "$forward_service"
install -m 644 "$temporary_forward_timer" "$forward_timer"
systemctl daemon-reload
systemctl enable --now cornershopdev-public-health.timer >/dev/null
systemctl enable --now cornershopdev-operator-alerts.timer >/dev/null
systemctl enable --now cornershopdev-inbound-forwards.timer >/dev/null

echo "Cornershopdev deployment is healthy: ${image_name}"
