#!/bin/bash
# Build the live demo from this checkout: the app itself (CPAP.html) served at the front door.
#   deploy/worker/publish.sh          build only, into deploy/worker/site
#   deploy/worker/publish.sh deploy   build and publish to https://cpap-demo.pingywon.workers.dev
set -euo pipefail
cd "$(dirname "$0")"
rm -rf site && mkdir -p site/assets
cp ../../CPAP.html site/index.html
cp ../../assets/cpap-mask-badge* site/assets/
cat > site/_headers <<'H'
/*
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-cache
  X-Content-Type-Options: nosniff
H
# the version shown in the app's header is the one source; version.txt only repeats it
grep -o 'id="headerVersion">[^<]*' ../../CPAP.html | sed 's/.*>//' > site/version.txt
test -s site/version.txt
echo "built $(cat site/version.txt): $(find site -type f | wc -l) files, $(du -sh site | cut -f1)"
if [ "${1:-}" = "deploy" ]; then
  CLOUDFLARE_API_TOKEN="$(tr -d '[:space:]' < ~/.cf_token)" \
  CLOUDFLARE_ACCOUNT_ID="$(tr -d '[:space:]' < ~/.cf_account)" \
  "${WRANGLER:-$HOME/gc-ops/node_modules/.bin/wrangler}" deploy
  echo "live: https://cpap-demo.pingywon.workers.dev  ($(cat site/version.txt))"
fi
