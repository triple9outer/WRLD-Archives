#!/bin/zsh
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required."
  read -r "?Press Return to close..."
  exit 1
fi
if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama is not installed. Install it from https://ollama.com/download/mac, then run: ollama pull qwen3:1.7b"
  read -r "?Press Return to close..."
  exit 1
fi
open -a Ollama >/dev/null 2>&1 || true
if ! ollama list | rg -q '^qwen3:1\.7b'; then
  echo "The local model is missing. Run: ollama pull qwen3:1.7b"
  read -r "?Press Return to close..."
  exit 1
fi
SERVER_PID=""
if ! curl -fsS http://127.0.0.1:47821/api/status >/dev/null 2>&1; then
  node server.mjs &
  SERVER_PID=$!
  trap 'if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi' EXIT
  for n in {1..25}; do
    if curl -fsS http://127.0.0.1:47821/api/status >/dev/null 2>&1; then break; fi
    sleep 0.4
  done
fi
open http://127.0.0.1:47821
if [ -n "$SERVER_PID" ]; then wait "$SERVER_PID"; fi
