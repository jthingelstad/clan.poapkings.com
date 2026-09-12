#!/usr/bin/env bash
# Two independent verdicts: public observation and checkout mutation eligibility.
# A busy checkout must not suppress independent read-only review.
set -euo pipefail
command -v git >/dev/null || { echo "git not found"; exit 2; }
command -v node >/dev/null || { echo "node not found"; exit 2; }
exec node "$(dirname "$0")/preflight.mjs"
