#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "[post-merge] Installing the locked project dependencies"
npm ci --include=dev --prefer-offline --no-audit --no-fund

echo "[post-merge] Building the application"
npm run build

# Workflow reconciliation is managed by Replit after this script succeeds.
# Do not start another server, run research scripts, or push database changes here.