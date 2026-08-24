#!/usr/bin/env bash
set -Eeuo pipefail

host_launcher_source="${1:-}"
caddy_fragment_source="${2:-}"
if [[ ! -f "$host_launcher_source" || ! -f "$caddy_fragment_source" ]]; then
  echo "Usage: bootstrap-host.sh <host-launcher> <caddy-fragment>" >&2
  exit 2
fi

host_launcher_destination="${CORNERSHOPDEV_HOST_LAUNCHER_PATH:-/usr/local/bin/deploy-cornershopdev}"
config_directory="${CORNERSHOPDEV_CONFIG_DIR:-/etc/cornershopdev}"
state_directory="${CORNERSHOPDEV_STATE_DIR:-/var/lib/cornershopdev}"
caddyfile="${CORNERSHOPDEV_CADDYFILE:-/etc/caddy/Caddyfile}"

install -m 755 "$host_launcher_source" "$host_launcher_destination"
install -d -m 700 "$config_directory" "$state_directory"

backup="/etc/caddy/Caddyfile.$(date -u +%Y%m%dT%H%M%SZ).bak"
if [[ "$caddyfile" != "/etc/caddy/Caddyfile" ]]; then
  backup="${caddyfile}.$(date -u +%Y%m%dT%H%M%SZ).bak"
fi
cp "$caddyfile" "$backup"

temporary_body="$(mktemp "${caddyfile}.body.XXXXXX")"
temporary_retargeted_body="$(mktemp "${caddyfile}.retargeted.XXXXXX")"
temporary_caddyfile="$(mktemp "${caddyfile}.candidate.XXXXXX")"
temporary_gated_caddyfile="$(mktemp "${caddyfile}.gated.XXXXXX")"
trap 'rm -f "$temporary_body" "$temporary_retargeted_body" "$temporary_caddyfile" "$temporary_gated_caddyfile"' EXIT

# A failed article rollout intentionally leaves the edge gate embedded in the
# managed block. Remember that state before replacing the block so a retry can
# never reload an open route while it downloads or verifies the next image.
article_gate_was_closed=0
if grep -q '^[[:space:]]*# BEGIN ARTICLE MUTATION GATE$' "$caddyfile"; then
  article_gate_was_closed=1
fi

# RESTOFRONT is the marker an earlier revision of this script wrote. A host
# bootstrapped before the rename still carries that block, and the fragment we
# append declares the same catch-all `https://` address, so dropping only the
# current marker leaves two blocks claiming it and `caddy validate` rejects the
# file. Keep matching the old name until no host is running the old bootstrap.
awk '
  /^# BEGIN (CORNERSHOPDEV|RESTOFRONT)$/ { managed = 1; next }
  /^# END (CORNERSHOPDEV|RESTOFRONT)$/ { managed = 0; next }
  !managed { print }
' "$caddyfile" >"$temporary_body"

# The global options block sits outside those markers, so the pre-rename run
# left an ask endpoint naming a container this script is about to rename away.
# Caddy denies every on-demand certificate when that endpoint stops resolving,
# which would cost each customer domain its issuance and renewal. Retarget only
# the exact line the old bootstrap wrote and leave operator edits untouched.
sed \
  -e 's#ask http://restofront:3000/api/domains/authorize#ask http://api-cornershop-dev:3000/api/domains/authorize#' \
  -e 's#ask http://cornershopdev:3000/api/domains/authorize#ask http://api-cornershop-dev:3000/api/domains/authorize#' \
  "$temporary_body" >"$temporary_retargeted_body"
cat "$temporary_retargeted_body" >"$temporary_body"

{
  if ! grep -q "on_demand_tls" "$temporary_body"; then
    printf '%s\n' '{'
    printf '%s\n' '	on_demand_tls {'
    printf '%s\n' '		ask http://api-cornershop-dev:3000/api/domains/authorize'
    printf '%s\n' '	}'
    printf '%s\n\n' '}'
  fi
  cat "$temporary_body"
  printf '\n'
  cat "$caddy_fragment_source"
} >"$temporary_caddyfile"

if [[ "$article_gate_was_closed" == 1 ]]; then
  article_gate_body="Article mutations are temporarily gated for a safe release."
  awk -v body="$article_gate_body" '
    /^# BEGIN CORNERSHOPDEV$/ { managed = 1 }
    /^# END CORNERSHOPDEV$/ { managed = 0 }
    {
      print
      if (managed && ($0 == "api.cornershop.dev {" || $0 == "https:// {")) {
        print "\t# BEGIN ARTICLE MUTATION GATE"
        print "\t@articleMutations {"
        print "\t\tmethod POST"
        print "\t\tpath /api/sites/*/articles /api/sites/*/articles/generate"
        print "\t}"
        print "\trespond @articleMutations \"" body "\" 503"
        print "\t# END ARTICLE MUTATION GATE"
      }
    }
  ' "$temporary_caddyfile" >"$temporary_gated_caddyfile"
  cat "$temporary_gated_caddyfile" >"$temporary_caddyfile"
fi

# Validate the candidate in the exact context that will load it. A throwaway
# caddy:2 container cannot resolve other tenants' managed imports — e.g.
# dailydraft's `import /config/dailydraft-*.caddy` resolves only inside
# shipshit-caddy, which made every deploy fail closed between 2026-07-29 and
# this fix. Run the candidate against the running binary beside the real
# Caddyfile instead, and keep refusing to touch the live file on any failure.
candidate_config="/etc/caddy/.cornershopdev-candidate.Caddyfile"
validated=0
if docker cp "$temporary_caddyfile" "shipshit-caddy:$candidate_config"; then
  if docker exec shipshit-caddy caddy validate --config "$candidate_config"; then
    validated=1
  fi
  docker exec shipshit-caddy rm -f "$candidate_config" || true
fi
if [[ "$validated" != 1 ]]; then
  echo "Candidate Caddyfile did not validate inside shipshit-caddy; leaving the live config untouched" >&2
  exit 1
fi

# Preserve the inode because the shared Caddy container bind-mounts this file.
cat "$temporary_caddyfile" >"$caddyfile"
chmod 644 "$caddyfile"

docker exec shipshit-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec shipshit-caddy caddy reload --config /etc/caddy/Caddyfile
echo "Cornershopdev host bootstrap complete; Caddy backup: ${backup}"
