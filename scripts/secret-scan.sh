#!/usr/bin/env bash
# Runs the same secret scan CI runs (.github/workflows/ci.yml, job secret-scan): gitleaks v8.24.3 with
# .gitleaks.toml, over the full git history AND over the files you have not committed yet.
#
# Needs Docker. Run it before you push:  scripts/secret-scan.sh
#
# Why both: CI scans commits, so a token-shaped test value that is only in your working tree passes
# locally and then fails after the push. Test credentials must be built at runtime
# (protocol/testing/fake-secrets.ts), never written as literals.
set -euo pipefail

IMAGE="zricethezav/gitleaks:v8.24.3"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v docker >/dev/null || { echo "docker is required (it runs the pinned gitleaks image)" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "the Docker daemon is not running" >&2; exit 2; }

echo "== history (what CI scans)"
docker run --rm -v "$ROOT:/repo" "$IMAGE" detect --source /repo --config /repo/.gitleaks.toml \
  --redact --no-banner --exit-code 2 --log-level warn

# The copy has to live inside the repository directory: some Docker setups (Colima) only share
# the home directory with the container, and an unshared path is scanned as empty.
echo "== tracked and uncommitted files (what the next push will contain)"
COPY="$ROOT/.secret-scan-tmp"
trap 'rm -rf "$COPY"' EXIT
rm -rf "$COPY"
mkdir -p "$COPY"
git ls-files --cached --others --exclude-standard -z | tar --null -T - -cf - | tar -xf - -C "$COPY"
test "$(find "$COPY" -type f | wc -l)" -gt 0 || { echo "nothing to scan; refusing to report a clean result" >&2; exit 2; }
docker run --rm -v "$COPY:/scan" "$IMAGE" detect --source /scan --no-git --config /scan/.gitleaks.toml \
  --redact --no-banner --exit-code 2 --log-level warn

echo "no secrets found"
