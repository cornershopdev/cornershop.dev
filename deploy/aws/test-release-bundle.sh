#!/usr/bin/env bash
set -Eeuo pipefail

deploy_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deploy_script="${deploy_directory}/deploy.sh"

assert_embedded_checksum() {
  local variable_name="$1"
  local path="$2"
  local expected
  expected="$(
    sed -n \
      "s/^readonly ${variable_name}=\"\([0-9a-f]\{64\}\)\"$/\1/p" \
      "$deploy_script"
  )"
  if [[ -z "$expected" ]]; then
    echo "Missing embedded checksum: ${variable_name}" >&2
    exit 1
  fi
  local actual
  actual="$(sha256sum "$path" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "Embedded checksum is stale for ${path}" >&2
    exit 1
  fi
}

assert_embedded_checksum \
  expected_bootstrap_sha256 \
  "${deploy_directory}/bootstrap-host.sh"
assert_embedded_checksum \
  expected_caddy_fragment_sha256 \
  "${deploy_directory}/Caddyfile.fragment"
assert_embedded_checksum \
  expected_host_launcher_sha256 \
  "${deploy_directory}/host-launcher.sh"

if ! grep -Fq 'headers: { "x-forwarded-host": host },' "$deploy_script"; then
  echo "Candidate host probe does not match the trusted forwarded-host path" >&2
  exit 1
fi

echo "release bundle checksum tests passed"
