#!/bin/sh
set -eu

cd "$(dirname "$0")"
export XDG_CONFIG_HOME="$(pwd)/.local/config"
export WRANGLER_SEND_METRICS=false
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-83d1a69e8b44095e35b352bc323d5562}"

if [ ! -x node_modules/.bin/wrangler ]; then
  npm ci --no-audit --no-fund
fi

if [ "${1:-}" = "--login" ] && [ "$#" -eq 1 ]; then
  npx wrangler login
  exit 0
fi

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--check" ]; }; then
  echo "Cách dùng: ./update_bot.sh [--login|--check]" >&2
  exit 2
fi

node --check worker.js
npm test

if [ "${1:-}" = "--check" ]; then
  echo "Kiểm tra đạt; chưa triển khai."
  exit 0
fi

npx wrangler deploy
echo "Đã cập nhật bot trên Cloudflare. Dữ liệu D1 và webhook được giữ nguyên."
