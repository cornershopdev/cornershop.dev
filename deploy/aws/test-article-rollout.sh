#!/usr/bin/env bash
# The rollback function is extracted and sourced dynamically so this harness
# executes the production definition; ShellCheck cannot resolve those symbols.
# shellcheck disable=SC1090,SC2034,SC2329
set -Eeuo pipefail

deploy_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

fake_bin="${root}/bin"
mkdir -p "$fake_bin" "${root}/usr/local/bin" "${root}/etc/caddy"
cat >"${fake_bin}/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
exit 0
EOF
chmod +x "${fake_bin}/docker"

cat >"${root}/launcher.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "${root}/launcher.sh"

caddyfile="${root}/etc/caddy/Caddyfile"
cat >"$caddyfile" <<'EOF'
{
	on_demand_tls {
		ask http://api-cornershop-dev:3000/api/domains/authorize
	}
}

# BEGIN CORNERSHOPDEV
api.cornershop.dev {
	# BEGIN ARTICLE MUTATION GATE
	@articleMutations {
		method POST
		path /api/sites/*/articles /api/sites/*/articles/generate
	}
	respond @articleMutations "Article mutations are temporarily gated for a safe release." 503
	# END ARTICLE MUTATION GATE
	reverse_proxy api-cornershop-dev:3000
}
https:// {
	# BEGIN ARTICLE MUTATION GATE
	@articleMutations {
		method POST
		path /api/sites/*/articles /api/sites/*/articles/generate
	}
	respond @articleMutations "Article mutations are temporarily gated for a safe release." 503
	# END ARTICLE MUTATION GATE
	reverse_proxy api-cornershop-dev:3000
}
# END CORNERSHOPDEV
EOF

PATH="${fake_bin}:$PATH" \
  CORNERSHOPDEV_HOST_LAUNCHER_PATH="${root}/usr/local/bin/deploy-cornershopdev" \
  CORNERSHOPDEV_CONFIG_DIR="${root}/etc/cornershopdev" \
  CORNERSHOPDEV_STATE_DIR="${root}/var/lib/cornershopdev" \
  CORNERSHOPDEV_CADDYFILE="$caddyfile" \
  "${deploy_directory}/bootstrap-host.sh" \
  "${root}/launcher.sh" \
  "${deploy_directory}/Caddyfile.fragment" >/dev/null

if [[ "$(grep -c 'BEGIN ARTICLE MUTATION GATE' "$caddyfile")" != 2 ]]; then
  echo "Bootstrap did not preserve both closed article edge gates" >&2
  exit 1
fi
if [[ "$(grep -c 'respond @articleMutations .* 503' "$caddyfile")" != 2 ]]; then
  echo "Bootstrap did not preserve fail-closed article responses" >&2
  exit 1
fi

rollback_function="${root}/rollback-function.sh"
sed -n '/^rollback_article_rollout() {$/,/^}$/p' \
  "${deploy_directory}/deploy.sh" >"$rollback_function"
if [[ ! -s "$rollback_function" ]]; then
  echo "Could not extract rollback_article_rollout" >&2
  exit 1
fi

run_rollback_case() {
  local edge_set_result="$1"
  local edge_verify_result="$2"
  local database_result="$3"
  local expect_restore="$4"
  local log="${root}/rollback-${edge_set_result}-${edge_verify_result}-${database_result}.log"
  (
    source "$rollback_function"
    container="api-cornershop-dev"
    candidate="api-cornershop-dev-candidate"
    previous="api-cornershop-dev-previous"
    article_rollout_active=1
    set_article_edge_gate() { return "$edge_set_result"; }
    verify_article_edge_gate() { return "$edge_verify_result"; }
    run_article_rollout() { return "$database_result"; }
    reload_caddy() { printf '%s\n' "reload" >>"$log"; }
    docker() {
      printf '%s\n' "$*" >>"$log"
      if [[ "$1" == "inspect" && "$2" == "$previous" ]]; then return 0; fi
      return 0
    }
    set +e
    rollback_article_rollout 17 2>>"$log"
    status="$?"
    set -e
    if [[ "$status" != 17 ]]; then
      echo "Rollback changed the original failure status" >&2
      exit 1
    fi
    if [[ "$expect_restore" == 1 ]]; then
      grep -Fxq "rename ${previous} ${container}" "$log"
      grep -Fxq "start ${container}" "$log"
    else
      if grep -Fq "start ${previous}" "$log"; then
        echo "Rollback restarted the predecessor without verified gates" >&2
        exit 1
      fi
      grep -Fxq "stop ${container}" "$log"
      grep -Fxq "stop ${previous}" "$log"
    fi
  )
}

run_rollback_case 1 0 0 0
run_rollback_case 0 1 0 0
run_rollback_case 0 0 1 0
run_rollback_case 0 0 0 1

echo "article rollout failure-path tests passed"
