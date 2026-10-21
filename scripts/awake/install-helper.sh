#!/bin/bash
# Phoenix keep-awake helper: INSTALL (Phase 73). Read this whole file before you run it.
#
# What it installs, and nothing else:
#   1. /etc/sudoers.d/phoenix-awake   (root:wheel, mode 0440)
#        <you> ALL = (root) NOPASSWD: /usr/bin/pmset -a disablesleep 1, ... disablesleep 0,
#                                     /usr/bin/pmset -a lowpowermode 1, ... lowpowermode 0
#      EXACTLY those four command lines, no wildcard. sudo matches arguments one by one, so
#      `pmset -a disablesleep 1 extra` or `pmset -a displaysleep 0` are NOT allowed.
#      It is checked with `visudo -cf` before it is put in place.
#   2. ~/Library/Application Support/Phoenix/phoenix-awake-backstop.mjs   (owned by you, not root)
#   3. ~/Library/LaunchAgents/dev.phoenix.awake-backstop.plist            (owned by you, not root)
#        runs the script every 60 s as YOU. If Phoenix died with lid-closed mode on, the script
#        undoes it through the rule in (1).
#   4. ~/Library/Logs/phoenix-awake-backstop.log is written by launchd.
# Phoenix itself never runs as root and never runs this script.
#
# Usage:
#   sudo ./install-helper.sh --yes [--user NAME] [--data-dir DIR] [--node PATH]
#   ./install-helper.sh --print-plan [...]      shows what would happen; touches nothing, needs no root
#   ./install-helper.sh --print-sudoers [--user NAME]
#   ./install-helper.sh --print-plist [--home DIR] [--data-dir DIR] [--node PATH]
# --yes means "I have read this script and the sudoers text it prints". It is required.
# Run ./uninstall-helper.sh to remove everything this created.
#
# UNVERIFIED: this was written and tested only in --print-* modes. It has not been run as root.
set -euo pipefail

LABEL="dev.phoenix.awake-backstop"
SUDOERS_NAME="phoenix-awake"
SUDOERS_DIR="${PHOENIX_SUDOERS_DIR:-/etc/sudoers.d}"
SCRIPT_SRC_REL="../../capabilities/awake/helper/phoenix-awake-backstop.mjs"
INTERVAL_SECONDS=60

mode="install"
yes=0
user=""
home=""
data_dir=""
node_bin=""

die() { printf 'install-helper: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) yes=1 ;;
    --print-plan) mode="plan" ;;
    --print-sudoers) mode="sudoers" ;;
    --print-plist) mode="plist" ;;
    --user) shift; [ $# -gt 0 ] || die "--user needs a value"; user="$1" ;;
    --home) shift; [ $# -gt 0 ] || die "--home needs a value"; home="$1" ;;
    --data-dir) shift; [ $# -gt 0 ] || die "--data-dir needs a value"; data_dir="$1" ;;
    --node) shift; [ $# -gt 0 ] || die "--node needs a value"; node_bin="$1" ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

# Real mode is refused up front: root, and --yes. The print modes below touch nothing.
if [ "$mode" = "install" ]; then
  [ "$(id -u)" -eq 0 ] || die "must run as root: sudo $0 --yes"
  [ "$yes" -eq 1 ] || die "pass --yes after reading this script and the rule it installs (see --print-sudoers)"
fi

# The account the rule is for: the person who ran sudo, never "root".
if [ -z "$user" ]; then user="${SUDO_USER:-$(id -un)}"; fi
case "$user" in
  *[!a-z0-9_-]*|"") die "not a plain account name: $user" ;;
  [!a-z_]*) die "not a plain account name: $user" ;;
esac
[ "${#user}" -le 32 ] || die "account name too long"
[ "$user" != "root" ] || die "refusing to grant the rule to root (run with sudo as your own account, or pass --user)"

if [ -z "$home" ]; then
  if [ "$mode" = "plan" ] || [ "$mode" = "plist" ] || [ "$mode" = "sudoers" ]; then
    home="${HOME:?HOME is not set}"
  else
    home="$(dscl . -read "/Users/$user" NFSHomeDirectory 2>/dev/null | sed 's/^NFSHomeDirectory: //' || true)"
    [ -n "$home" ] || die "cannot find the home directory of $user (pass --home)"
  fi
fi
[ -n "$data_dir" ] || data_dir="$home/.phoenix/prod"
if [ -z "$node_bin" ]; then node_bin="$(command -v node || true)"; fi
[ -n "$node_bin" ] || node_bin="/usr/local/bin/node"

# Paths go into a plist and a command line: only plain absolute paths are accepted.
check_path() {
  case "$1" in
    /*) ;;
    *) die "not an absolute path: $1" ;;
  esac
  case "$1" in
    *..*) die "path may not contain '..': $1" ;;
  esac
  if printf '%s' "$1" | LC_ALL=C grep -q '[^A-Za-z0-9._+@%/ -]'; then die "path has unusual characters: $1"; fi
}
check_path "$home"; check_path "$data_dir"; check_path "$node_bin"

support_dir="$home/Library/Application Support/Phoenix"
script_dst="$support_dir/phoenix-awake-backstop.mjs"
agents_dir="$home/Library/LaunchAgents"
plist_dst="$agents_dir/$LABEL.plist"
log_dst="$home/Library/Logs/phoenix-awake-backstop.log"
sudoers_dst="$SUDOERS_DIR/$SUDOERS_NAME"
journal="$data_dir/awake/recovery-journal.jsonl"
check_path "$script_dst"; check_path "$plist_dst"; check_path "$log_dst"; check_path "$journal"

here="$(cd "$(dirname "$0")" && pwd)"
script_src="$here/$SCRIPT_SRC_REL"

# The rule. Keep in step with ALLOWED_HELPER_LINES in src/power/helper-client.ts (a test compares).
render_sudoers() {
  printf '%s\n' \
    "# Phoenix keep-awake helper (scripts/awake/install-helper.sh). Remove with uninstall-helper.sh." \
    "# Allows the user below to run EXACTLY these command lines as root, without a password." \
    "# No wildcards: sudo matches the arguments one by one, so nothing else is permitted." \
    "$user ALL = (root) NOPASSWD: /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a lowpowermode 1, /usr/bin/pmset -a lowpowermode 0"
}

render_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$script_dst</string>
    <string>$journal</string>
  </array>
  <key>StartInterval</key>
  <integer>$INTERVAL_SECONDS</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$log_dst</string>
  <key>StandardErrorPath</key>
  <string>$log_dst</string>
</dict>
</plist>
PLIST
}

# One line per file this script creates. uninstall-helper.sh --print-plan prints the same paths.
print_plan() {
  echo "CREATE $sudoers_dst"
  echo "CREATE $script_dst"
  echo "CREATE $plist_dst"
  echo "CREATE $log_dst"
  echo "# the sudoers rule allows exactly:"
  render_sudoers | sed -n '4p' | sed 's/^[^:]*: //' | tr ',' '\n' | sed 's/^ */#   /'
  echo "# touches nothing else; the journal $journal is never created, changed or removed by this script"
}

case "$mode" in
  sudoers) render_sudoers; exit 0 ;;
  plist) render_plist; exit 0 ;;
  plan) print_plan; exit 0 ;;
esac

# ---- real installation: only below this line, only as root, only with --yes ----
[ "$(uname -s)" = "Darwin" ] || die "macOS only"
[ -f "$script_src" ] || die "missing $script_src"
[ -x "$node_bin" ] || die "node not found at $node_bin (pass --node)"
uid="$(id -u "$user")" || die "no such account: $user"
group="$(id -gn "$user")"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. the sudoers rule: validated first, then moved into place atomically.
render_sudoers > "$tmp/rule"
/usr/sbin/visudo -cf "$tmp/rule" >/dev/null || die "the generated sudoers rule did not validate; nothing was installed"
install -m 0440 -o root -g wheel "$tmp/rule" "$sudoers_dst.new"
mv -f "$sudoers_dst.new" "$sudoers_dst"
/usr/sbin/visudo -c >/dev/null || { rm -f "$sudoers_dst"; die "sudoers is invalid with the new rule; removed it"; }

# 2-3. user-owned files (never root-owned: the backstop runs as the user).
install -d -m 0700 -o "$user" -g "$group" "$support_dir"
install -d -m 0755 -o "$user" -g "$group" "$agents_dir"
install -d -m 0755 -o "$user" -g "$group" "$home/Library/Logs"
install -m 0644 -o "$user" -g "$group" "$script_src" "$script_dst"
render_plist > "$tmp/plist"
/usr/bin/plutil -lint "$tmp/plist" >/dev/null || die "the generated plist is invalid; the sudoers rule IS installed, run uninstall-helper.sh to remove it"
install -m 0644 -o "$user" -g "$group" "$tmp/plist" "$plist_dst"

# Load the job (idempotent: unload a previous copy first).
/bin/launchctl bootout "gui/$uid/$LABEL" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$uid" "$plist_dst" || echo "install-helper: could not load the launchd job now; it loads at your next login" >&2

echo "Installed: $sudoers_dst, $script_dst, $plist_dst"
echo "Remove everything with: sudo $here/uninstall-helper.sh --yes"
