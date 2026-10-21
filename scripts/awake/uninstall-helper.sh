#!/bin/bash
# Phoenix keep-awake helper: UNINSTALL (Phase 73). Removes every file install-helper.sh created.
#
#   1. /etc/sudoers.d/phoenix-awake                                    (the root rule)
#   2. ~/Library/LaunchAgents/dev.phoenix.awake-backstop.plist         (after unloading the job)
#   3. ~/Library/Application Support/Phoenix/phoenix-awake-backstop.mjs
#   4. ~/Library/Logs/phoenix-awake-backstop.log
# Then it runs `visudo -c` so a broken sudoers setup is reported, and tells you if `pmset` still has
# sleep disabled (it does not change that: run `sudo pmset -a disablesleep 0` yourself if it says so).
# It never touches the recovery journal (your data) and removes the Phoenix support folder only if empty.
#
# Usage:
#   sudo ./uninstall-helper.sh --yes [--user NAME] [--data-dir DIR]
#   ./uninstall-helper.sh --print-plan [...]     shows what would be removed; touches nothing, needs no root
#
# UNVERIFIED: written and tested only in --print-plan mode. It has not been run as root.
set -euo pipefail

LABEL="dev.phoenix.awake-backstop"
SUDOERS_NAME="phoenix-awake"
SUDOERS_DIR="${PHOENIX_SUDOERS_DIR:-/etc/sudoers.d}"

mode="uninstall"
yes=0
user=""
home=""

die() { printf 'uninstall-helper: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) yes=1 ;;
    --print-plan) mode="plan" ;;
    --user) shift; [ $# -gt 0 ] || die "--user needs a value"; user="$1" ;;
    --home) shift; [ $# -gt 0 ] || die "--home needs a value"; home="$1" ;;
    --data-dir) shift; [ $# -gt 0 ] || die "--data-dir needs a value" ;; # accepted for symmetry with install
    --node) shift; [ $# -gt 0 ] || die "--node needs a value" ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

# Real mode is refused up front: root, and --yes. The print modes below touch nothing.
if [ "$mode" = "uninstall" ]; then
  [ "$(id -u)" -eq 0 ] || die "must run as root: sudo $0 --yes"
  [ "$yes" -eq 1 ] || die "pass --yes (see --print-plan for what is removed)"
fi

if [ -z "$user" ]; then user="${SUDO_USER:-$(id -un)}"; fi
case "$user" in
  *[!a-z0-9_-]*|"") die "not a plain account name: $user" ;;
esac
[ "$user" != "root" ] || die "run with sudo as your own account, or pass --user"

if [ -z "$home" ]; then
  if [ "$mode" = "plan" ]; then
    home="${HOME:?HOME is not set}"
  else
    home="$(dscl . -read "/Users/$user" NFSHomeDirectory 2>/dev/null | sed 's/^NFSHomeDirectory: //' || true)"
    [ -n "$home" ] || die "cannot find the home directory of $user (pass --home)"
  fi
fi
case "$home" in
  /*) ;;
  *) die "not an absolute path: $home" ;;
esac
case "$home" in
  *..*) die "path may not contain '..': $home" ;;
esac

support_dir="$home/Library/Application Support/Phoenix"
script_dst="$support_dir/phoenix-awake-backstop.mjs"
plist_dst="$home/Library/LaunchAgents/$LABEL.plist"
log_dst="$home/Library/Logs/phoenix-awake-backstop.log"
sudoers_dst="$SUDOERS_DIR/$SUDOERS_NAME"

if [ "$mode" = "plan" ]; then
  echo "REMOVE $sudoers_dst"
  echo "REMOVE $script_dst"
  echo "REMOVE $plist_dst"
  echo "REMOVE $log_dst"
  echo "# then: rmdir \"$support_dir\" if empty; visudo -c; launchctl bootout gui/<uid>/$LABEL"
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || die "macOS only"
uid="$(id -u "$user")" || die "no such account: $user"

# Stop the job first so it cannot run while its files go away. Not finding it is fine (idempotent).
/bin/launchctl bootout "gui/$uid/$LABEL" >/dev/null 2>&1 || true

# The root rule goes first: after this line nothing can use sudo without a password for pmset.
rm -f -- "$sudoers_dst"
rm -f -- "$plist_dst" "$script_dst" "$log_dst" "$script_dst.tmp"
rmdir "$support_dir" 2>/dev/null || true

/usr/sbin/visudo -c >/dev/null || echo "uninstall-helper: WARNING: 'visudo -c' reports a problem in your sudoers setup; check it" >&2

if [ -e "$sudoers_dst" ]; then die "$sudoers_dst is still there"; fi
echo "Removed: $sudoers_dst, $plist_dst, $script_dst, $log_dst"
if /usr/bin/pmset -g 2>/dev/null | grep -Eq '^ *SleepDisabled[[:space:]]+1'; then
  echo "NOTE: sleep is still disabled system-wide. Run: sudo pmset -a disablesleep 0"
fi
