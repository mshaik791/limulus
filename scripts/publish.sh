#!/bin/bash
# Publishes the Limulus MVP to a public GitHub repo.
# Run after git is installed and `gh auth login` has completed.
set -euo pipefail

GH="$HOME/.local/gh/bin/gh"
REPO_NAME="${1:-limulus}"
cd "$(dirname "$0")/.."

command -v git >/dev/null || { echo "git is not installed. Run: xcode-select --install"; exit 1; }
"$GH" auth status >/dev/null 2>&1 || { echo "Not logged in. Run: $GH auth login"; exit 1; }

# Identity, only if it isn't set already.
git config user.name >/dev/null 2>&1 || git config user.name "Hameed Shaik"
git config user.email >/dev/null 2>&1 || git config user.email "$($GH api user --jq '.email // empty' || echo '')"

if [ ! -d .git ]; then
  git init -q -b main
fi

git add -A
git diff --cached --quiet || git commit -q -m "Limulus: three-way match gateway for AI agent payments

Before an agent pays a vendor it declares what it intends to pay and why.
A payment is released only when the authorization, the declaration and the
payment order agree, and every decision is signed and hash-chained.

- nine checks, including declaration vs payment order and hidden instructions
- Ed25519 signatures over a SHA-256 hash chain, verifiable offline
- HTTP API and an interactive tamper demo
- five scenarios: clean, poisoned, altered, overlimit, duplicate"

if ! git remote get-url origin >/dev/null 2>&1; then
  "$GH" repo create "$REPO_NAME" \
    --public \
    --source . \
    --remote origin \
    --description "Proof before the money moves. A three-way match for AI agent payments." \
    --push
else
  git push -u origin main
fi

"$GH" repo edit --add-topic ai-agents --add-topic payments --add-topic fintech \
  --add-topic fraud-prevention --add-topic ach --add-topic mcp 2>/dev/null || true

echo
echo "Published: $($GH repo view --json url --jq .url)"
