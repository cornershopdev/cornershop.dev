#!/usr/bin/env bash
set -Eeuo pipefail

image_name="${1:-}"
if [[ ! "$image_name" =~ ^cornershopdev:[a-zA-Z0-9._-]+$ ]]; then
  echo "Usage: $0 cornershopdev:<candidate-tag>" >&2
  exit 2
fi

readonly container="cornershopdev-runtime-contract-${RANDOM}"
readonly host_port="4180"
readonly base_url="http://127.0.0.1:${host_port}"
readonly database_url="${CONTAINER_DATABASE_URL:-postgresql://ci:ci@host.docker.internal:5432/cornershopdev_ci}"

cleanup() {
  local status="$?"
  if ((status != 0)); then
    docker logs "$container" >&2 || true
  fi
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d \
  --name "$container" \
  --add-host host.docker.internal:host-gateway \
  --publish "127.0.0.1:${host_port}:3000" \
  --no-healthcheck \
  --env DATABASE_URL="$database_url" \
  --env WORKFLOW_POSTGRES_URL="$database_url" \
  --env WORKFLOW_TARGET_WORLD="@workflow/world-postgres" \
  --env WORKFLOW_ENABLED="false" \
  --env BETTER_AUTH_SECRET="ci-only-better-auth-secret-32-bytes" \
  --env NEXT_PUBLIC_APP_URL="http://cornershop.dev" \
  --env PLATFORM_HOSTNAMES="127.0.0.1,localhost,cornershop.dev" \
  "$image_name" >/dev/null

ready="false"
for _ in $(seq 1 90); do
  if [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --header 'Host: cornershop.dev' "${base_url}/" || true)" == "200" ]]; then
    ready="true"
    break
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$container")" != "true" ]]; then
    echo "Candidate container exited before serving HTTP" >&2
    exit 1
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "Candidate container did not serve HTTP within 90 seconds" >&2
  exit 1
fi

node_version="$(docker exec "$container" node --version)"
bun_version="$(docker exec "$container" bun --version)"
node_executable="$(docker exec "$container" sh -c 'readlink /proc/1/exe')"
expected_node_executable="$(docker exec "$container" sh -c 'command -v node')"
if [[ "$node_version" != "v24.19.0" ]]; then
  printf 'Expected Node v24.19.0, got %q\n' "$node_version" >&2
  exit 1
fi
if [[ "$bun_version" != "1.4.0" ]]; then
  printf 'Expected Bun 1.4.0, got %q\n' "$bun_version" >&2
  exit 1
fi
if [[ "$node_executable" != "$expected_node_executable" ]]; then
  printf 'Expected PID 1 executable %q, got %q\n' \
    "$expected_node_executable" "$node_executable" >&2
  exit 1
fi
if ! docker exec "$container" test -f /app/scripts/dispatch-inbound-forwards.ts; then
  echo "Expected the inbound read-copy dispatcher in the candidate image" >&2
  exit 1
fi
if ! docker exec "$container" test -f /app/scripts/article-rollout.ts; then
  echo "Expected the article rollout gate in the candidate image" >&2
  exit 1
fi
if ! docker exec --env OUTREACH_INBOUND_FORWARD_TO= "$container" \
  bun run operator:dispatch-inbound-forwards >/dev/null; then
  echo "Expected the disabled inbound read-copy dispatcher to start safely" >&2
  exit 1
fi

assert_status() {
  local path="$1"
  local expected="$2"
  local actual
  actual="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --header 'Host: cornershop.dev' "${base_url}${path}")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected ${path} to return ${expected}, got ${actual}" >&2
    exit 1
  fi
}

assert_status "/" "200"
assert_status "/niche/restaurant" "200"
assert_status "/niche/beauty" "200"
assert_status "/niche/food_retail" "404"
assert_status "/sign-in" "200"
assert_status "/api/auth/get-session" "200"
assert_status "/dashboard" "307"

dashboard_location="$(
  curl --silent --show-error --dump-header - --output /dev/null \
    --header 'Host: cornershop.dev' "${base_url}/dashboard" |
    awk 'BEGIN { IGNORECASE=1 } $1 == "location:" { sub(/^location:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }'
)"
if [[ "$dashboard_location" != *"/sign-in"* ]]; then
  echo "Expected /dashboard to redirect to sign-in, got ${dashboard_location}" >&2
  exit 1
fi

if docker logs "$container" 2>&1 | grep -Fq "util.markAsUncloneable"; then
  echo "Candidate emitted the Bun-only Better Auth clone failure" >&2
  exit 1
fi

echo "container runtime contract passed (Node ${node_version}, Bun ${bun_version})"
