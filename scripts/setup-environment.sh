#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 or newer is required."); process.exit(1); }'
if [[ ! -f package-lock.json ]]; then
  echo "Missing package-lock.json: refusing an unpinned installation." >&2
  exit 1
fi
if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  chmod 600 .env.local
  echo "Created private .env.local from the checked-in template. Add the missing secrets there."
fi
export NEXT_TELEMETRY_DISABLED=1
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run build
npm run check:environment
echo "Workspace checks passed. Live services require separate access verification."
