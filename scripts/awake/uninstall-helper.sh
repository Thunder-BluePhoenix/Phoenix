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
# The root rule is removed first, at its fixed path. Everything under your home is removed BY YOU
# (`sudo -u <you> rm`), never by root, and only after the same checks as the installer: when any
# part of those paths under your home is a symbolic link or is not owned by you, it refuses with a
# message and removes nothing there (the root rule is already gone by then).
#
# Usage:
#   sudo ./uninstall-helper.sh --yes [--user NAME] [--data-dir DIR]
#   ./uninstall-helper.sh --print-plan [...]     shows what would be removed; touches nothing, needs no root
#   ./uninstall-helper.sh --dry-run [...]        runs the real checks and prints every step as
#                                                "RUN root:" / "RUN <user>:"; executes none of them
#
# UNVERIFIED: written and tested only in --print-plan and --dry-run modes. It has not been run as root.
set -euo pipefail

LABEL="dev.phoenix.awake-backstop"
SUDOERS_NAME="phoenix-awake"

mode="uninstall"
yes=0
dry=0
user=""
home=""

die() { printf 'uninstall-helper: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) yes=1 ;;
    --dry-run) dry=1 ;;
    --print-plan) mode="plan" ;;
    --user) shift; [ $# -gt 0 ] || die "--user needs a value"; user="$1" ;;
    --home) shift; [ $# -gt 0 ] || die "--home needs a value"; home="$1" ;;
    --data-dir) shift; [ $# -gt 0 ] || die "--data-dir needs a value" ;; # accepted for symmetry with install
    --node) shift; [ $# -gt 0 ] || die "--node needs a value" ;;
    -h|--help) sed -n '2,/^# UNVERIFIED/p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

# Test seam: PHOENIX_SUDOERS_DIR moves the rule's folder ONLY where nothing is executed (--print-plan
# and --dry-run). A real removal always uses /etc/sudoers.d.
SUDOERS_DIR="/etc/sudoers.d"
if [ "$mode" != "uninstall" ] || [ "$dry" -eq 1 ]; then
  SUDOERS_DIR="${PHOENIX_SUDOERS_DIR:-/etc/sudoers.d}"
fi

# Real mode is refused up front: root, and --yes. The print mode and --dry-run touch nothing.
if [ "$mode" = "uninstall" ] && [ "$dry" -eq 0 ]; then
  [ "$(id -u)" -eq 0 ] || die "must run as root: sudo $0 --yes"
  [ "$yes" -eq 1 ] || die "pass --yes (see --print-plan for what is removed)"
fi

if [ -z "$user" ]; then user="${SUDO_USER:-$(id -un)}"; fi
case "$user" in
  *[!a-z0-9_-]*|"") die "not a plain account name: $user" ;;
esac
[ "$user" != "root" ] || die "run with sudo as your own account, or pass --user"

if [ -z "$home" ]; then
  if [ "$mode" != "uninstall" ] || [ "$dry" -eq 1 ]; then
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
log_dir="$home/Library/Logs"
log_dst="$log_dir/phoenix-awake-backstop.log"
sudoers_dst="$SUDOERS_DIR/$SUDOERS_NAME"

if [ "$mode" = "plan" ]; then
  echo "REMOVE $sudoers_dst"
  echo "REMOVE $script_dst"
  echo "REMOVE $plist_dst"
  echo "REMOVE $log_dst"
  echo "# then: rmdir \"$support_dir\" if empty; visudo -c; launchctl bootout gui/<uid>/$LABEL"
  exit 0
fi

run_root() {
  if [ "$dry" -eq 1 ]; then printf 'RUN root: %s\n' "$*"; else "$@"; fi
}
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
  if [ -L "$1" ]; then die "refusing: $1 is a symbolic link. Nothing under $home was removed."; fi
  if [ -e "$1" ]; then
    owner="$(owner_of "$1")" || die "cannot read the owner of $1. Nothing under $home was removed."
    [ "$owner" = "$user" ] || die "refusing: $1 is owned by $owner, not by $user. Nothing under $home was removed."
  fi
}

# $home and every component below it, down to $1, must pass guard_entry.
guard_chain() {
  local p rest comp
  guard_entry "$home"
  p="$home"
  rest="${1#"$home"/}"
  while [ -n "$rest" ]; do
    comp="${rest%%/*}"
    if [ "$comp" = "$rest" ]; then rest=""; else rest="${rest#*/}"; fi
    p="$p/$comp"
    guard_entry "$p"
  done
}

if [ "$dry" -eq 0 ]; then
  [ "$(uname -s)" = "Darwin" ] || die "macOS only"
  uid="$(id -u "$user")" || die "no such account: $user"
else
  uid="<uid of $user>"
fi

# Stop the job first so it cannot run while its files go away. Not finding it is fine (idempotent).
run_root_quiet /bin/launchctl bootout "gui/$uid/$LABEL" || true

# The root rule goes first, at its fixed path: after this line nothing can use sudo without a
# password for pmset, whatever is wrong under the home folder.
run_root /bin/rm -f -- "$sudoers_dst"

# Then the user's own files, removed AS THE USER and only if no part of the path is a link or foreign.
guard_chain "$script_dst"; guard_chain "$plist_dst"; guard_chain "$log_dst"
run_user /bin/rm -f -- "$plist_dst" "$script_dst" "$log_dst" "$script_dst.tmp"
if [ "$dry" -eq 1 ]; then
  run_user /bin/rmdir "$support_dir"
else
  run_user /bin/rmdir "$support_dir" 2>/dev/null || true
fi

if [ "$dry" -eq 1 ]; then
  run_root_quiet /usr/sbin/visudo -c
  echo "Removed: $sudoers_dst, $plist_dst, $script_dst, $log_dst"
  exit 0
fi
/usr/sbin/visudo -c >/dev/null || echo "uninstall-helper: WARNING: 'visudo -c' reports a problem in your sudoers setup; check it" >&2

if [ -e "$sudoers_dst" ]; then die "$sudoers_dst is still there"; fi
echo "Removed: $sudoers_dst, $plist_dst, $script_dst, $log_dst"
if /usr/bin/pmset -g 2>/dev/null | grep -Eq '^ *SleepDisabled[[:space:]]+1'; then
  echo "NOTE: sleep is still disabled system-wide. Run: sudo pmset -a disablesleep 0"
fi
