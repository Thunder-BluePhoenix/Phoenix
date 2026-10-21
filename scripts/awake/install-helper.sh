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
#      THE RULE IS ACCOUNT-WIDE: it is for your whole account, not for Phoenix. ANY process that
#      runs as you (a terminal, a script, an AI agent with a shell) can run those four lines with
#      no password and without Phoenix knowing. Do not install it if you do not accept that.
#   2. ~/Library/Application Support/Phoenix/phoenix-awake-backstop.mjs   (owned by you, not root)
#   3. ~/Library/LaunchAgents/dev.phoenix.awake-backstop.plist            (owned by you, not root)
#        runs the script every 60 s as YOU. If Phoenix died with lid-closed mode on, the script
#        undoes it through the rule in (1).
#   4. ~/Library/Logs/phoenix-awake-backstop.log is written by launchd.
# Everything under your home (2-4 and their folders) is created BY YOU, not by root: this script
# runs `sudo -u <you> ...` for each of them, so a symlink planted in your home cannot make root
# hand a system folder to you. As a second guard it refuses (before touching anything) when any
# part of those paths under your home is a symbolic link or is not owned by you.
# Only the sudoers file is written by root, at the fixed path /etc/sudoers.d/phoenix-awake.
# Phoenix itself never runs as root and never runs this script.
#
# Usage:
#   sudo ./install-helper.sh --yes [--user NAME] [--data-dir DIR] [--node PATH]
#   ./install-helper.sh --print-plan [...]      shows what would happen; touches nothing, needs no root
#   ./install-helper.sh --print-sudoers [--user NAME]
#   ./install-helper.sh --print-plist [--home DIR] [--data-dir DIR] [--node PATH]
#   ./install-helper.sh --dry-run [...]         runs the real checks and prints every step as
#                                               "RUN root:" / "RUN <user>:"; executes none of them
# --data-dir DIR (absolute) is the Phoenix data folder whose awake/recovery-journal.jsonl the backstop
#   watches. Default: ~/.phoenix/prod. It MUST be the folder the running Phoenix uses (PHOENIX_DATA_DIR,
#   or ~/.phoenix/<PHOENIX_ENV>, where Phoenix defaults to dev when PHOENIX_ENV is unset): compare the
#   WATCH line of --print-plan with `journal_path` in the Keep awake recovery status.
# --yes means "I have read this script and the sudoers text it prints, and I accept that the rule is
#   account-wide". It is required.
# Run ./uninstall-helper.sh to remove everything this created.
#
# UNVERIFIED: this was written and tested only in --print-* and --dry-run modes. It has not been run as root.
set -euo pipefail

LABEL="dev.phoenix.awake-backstop"
SUDOERS_NAME="phoenix-awake"
SCRIPT_SRC_REL="../../capabilities/awake/helper/phoenix-awake-backstop.mjs"
INTERVAL_SECONDS=60

mode="install"
yes=0
dry=0
user=""
home=""
data_dir=""
data_dir_given=0
node_bin=""

die() { printf 'install-helper: %s\n' "$*" >&2; exit 1; }

ACCOUNT_WIDE_NOTICE="WARNING: the sudoers rule is account-wide. ANY process running as this account (a terminal, a script, an AI agent with a shell) can run the four pmset lines with no password, without Phoenix knowing."

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) yes=1 ;;
    --dry-run) dry=1 ;;
    --print-plan) mode="plan" ;;
    --print-sudoers) mode="sudoers" ;;
    --print-plist) mode="plist" ;;
    --user) shift; [ $# -gt 0 ] || die "--user needs a value"; user="$1" ;;
    --home) shift; [ $# -gt 0 ] || die "--home needs a value"; home="$1" ;;
    --data-dir) shift; [ $# -gt 0 ] || die "--data-dir needs a value"; data_dir="$1"; data_dir_given=1 ;;
    --node) shift; [ $# -gt 0 ] || die "--node needs a value"; node_bin="$1" ;;
    -h|--help) sed -n '2,/^# UNVERIFIED/p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

# Test seam: PHOENIX_SUDOERS_DIR moves the rule's folder, but ONLY where nothing is executed (the
# --print-* modes and --dry-run). A real installation always uses /etc/sudoers.d: a variable in the
# environment of a root process must never choose where root writes.
SUDOERS_DIR="/etc/sudoers.d"
if [ "$mode" != "install" ] || [ "$dry" -eq 1 ]; then
  SUDOERS_DIR="${PHOENIX_SUDOERS_DIR:-/etc/sudoers.d}"
fi

# Real mode is refused up front: root, and --yes. The print modes and --dry-run touch nothing.
if [ "$mode" = "install" ] && [ "$dry" -eq 0 ]; then
  [ "$(id -u)" -eq 0 ] || die "must run as root: sudo $0 --yes"
  [ "$yes" -eq 1 ] || die "pass --yes after reading this script and the rule it installs (see --print-sudoers). $ACCOUNT_WIDE_NOTICE"
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
  if [ "$mode" != "install" ] || [ "$dry" -eq 1 ]; then
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
[ "$data_dir_given" -eq 0 ] || case "$data_dir" in
  /*) ;;
  *) die "--data-dir must be an absolute path: $data_dir" ;;
esac
check_path "$home"; check_path "$data_dir"; check_path "$node_bin"

support_dir="$home/Library/Application Support/Phoenix"
script_dst="$support_dir/phoenix-awake-backstop.mjs"
agents_dir="$home/Library/LaunchAgents"
plist_dst="$agents_dir/$LABEL.plist"
log_dir="$home/Library/Logs"
log_dst="$log_dir/phoenix-awake-backstop.log"
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
  echo "# $ACCOUNT_WIDE_NOTICE"
  echo "# files under $home are created as $user (sudo -u $user), never as root; only $sudoers_dst is written by root"
  if [ "$data_dir_given" -eq 1 ]; then
    echo "WATCH $journal"
  else
    echo "WATCH $journal"
    echo "# no --data-dir given: the default is $home/.phoenix/prod. Phoenix itself defaults to ~/.phoenix/dev unless PHOENIX_DATA_DIR or PHOENIX_ENV is set; pass --data-dir to match it"
  fi
  echo "# compare the WATCH path with journal_path in the Keep awake recovery status"
  echo "# touches nothing else; the journal $journal is never created, changed or removed by this script"
}

case "$mode" in
  sudoers) render_sudoers; exit 0 ;;
  plist) render_plist; exit 0 ;;
  plan) print_plan; exit 0 ;;
esac

# ---- real installation: only below this line, only as root with --yes (or --dry-run) ----
# The two helpers below are the ONLY way anything is executed. --dry-run prints instead of running.
run_root() {
  if [ "$dry" -eq 1 ]; then printf 'RUN root: %s\n' "$*"; else "$@"; fi
}
# Same, with the command's own output silenced (its RUN line is still printed in --dry-run).
run_root_quiet() {
  if [ "$dry" -eq 1 ]; then printf 'RUN root: %s\n' "$*"; else "$@" >/dev/null 2>&1; fi
}
run_user() {
  if [ "$dry" -eq 1 ]; then printf 'RUN %s: %s\n' "$user" "$*"; else /usr/bin/sudo -n -u "$user" -H -- "$@"; fi
}

owner_of() {
  if [ "$(uname -s)" = "Darwin" ]; then /usr/bin/stat -f %Su -- "$1"; else stat -c %U -- "$1"; fi
}

# One path under $home: not a symbolic link, and owned by $user when it exists.
guard_entry() {
  if [ -L "$1" ]; then die "refusing: $1 is a symbolic link. Nothing was changed."; fi
  if [ -e "$1" ]; then
    owner="$(owner_of "$1")" || die "cannot read the owner of $1. Nothing was changed."
    [ "$owner" = "$user" ] || die "refusing: $1 is owned by $owner, not by $user. Nothing was changed."
  fi
}

# $home and every component below it, down to $1, must pass guard_entry; folders must be folders.
guard_chain() {
  local p rest comp
  guard_entry "$home"
  [ -d "$home" ] || die "refusing: $home is not a directory. Nothing was changed."
  p="$home"
  rest="${1#"$home"/}"
  while [ -n "$rest" ]; do
    comp="${rest%%/*}"
    if [ "$comp" = "$rest" ]; then rest=""; else rest="${rest#*/}"; fi
    p="$p/$comp"
    guard_entry "$p"
    if [ -n "$rest" ] && [ -e "$p" ] && [ ! -d "$p" ]; then die "refusing: $p is not a directory. Nothing was changed."; fi
  done
}

if [ "$dry" -eq 0 ]; then
  [ "$(uname -s)" = "Darwin" ] || die "macOS only"
  [ -x "$node_bin" ] || die "node not found at $node_bin (pass --node)"
fi
[ -f "$script_src" ] || die "missing $script_src"
if [ "$dry" -eq 1 ]; then
  uid="<uid of $user>"; group="<group of $user>"
else
  uid="$(id -u "$user")" || die "no such account: $user"
  group="$(id -gn "$user")"
fi

# Before anything is touched: no symbolic link, nothing foreign, anywhere under $home.
guard_chain "$script_dst"; guard_chain "$plist_dst"; guard_chain "$log_dst"

echo "install-helper: $ACCOUNT_WIDE_NOTICE" >&2

# Staging folder: root-owned, readable by everyone (nothing secret in it), writable by nobody else,
# so the user can install the staged copies but not swap them.
tmp="$(mktemp -d /tmp/phoenix-awake-install.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
chmod 0755 "$tmp"

# 1. the sudoers rule (root): validated first, then moved into place atomically.
render_sudoers > "$tmp/rule"
run_root_quiet /usr/sbin/visudo -cf "$tmp/rule" || die "the generated sudoers rule did not validate; nothing was installed"
run_root /usr/bin/install -m 0440 -o root -g wheel "$tmp/rule" "$sudoers_dst.new"
run_root /bin/mv -f "$sudoers_dst.new" "$sudoers_dst"
run_root_quiet /usr/sbin/visudo -c || { run_root /bin/rm -f "$sudoers_dst"; die "sudoers is invalid with the new rule; removed it"; }

# 2-3. everything under $home: created BY the user (never root-owned, never root following a link).
render_plist > "$tmp/plist"
cp -- "$script_src" "$tmp/script.mjs"
chmod 0644 "$tmp/plist" "$tmp/script.mjs"
run_root_quiet /usr/bin/plutil -lint "$tmp/plist" || die "the generated plist is invalid; the sudoers rule IS installed, run uninstall-helper.sh to remove it"
run_user /usr/bin/install -d -m 0700 "$support_dir"
run_user /usr/bin/install -d -m 0755 "$agents_dir"
run_user /usr/bin/install -d -m 0755 "$log_dir"
run_user /usr/bin/install -m 0644 "$tmp/script.mjs" "$script_dst"
run_user /usr/bin/install -m 0644 "$tmp/plist" "$plist_dst"

# Load the job (idempotent: unload a previous copy first).
run_root_quiet /bin/launchctl bootout "gui/$uid/$LABEL" || true
run_root /bin/launchctl bootstrap "gui/$uid" "$plist_dst" || echo "install-helper: could not load the launchd job now; it loads at your next login" >&2

echo "Installed: $sudoers_dst, $script_dst, $plist_dst"
echo "The backstop watches: $journal (must be the journal of the Phoenix you run; see journal_path in the Keep awake recovery status)"
echo "Remove everything with: sudo $here/uninstall-helper.sh --yes"
