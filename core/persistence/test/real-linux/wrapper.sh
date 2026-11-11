#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Phoenix contributors
#
# Recording stand-in for `secret-tool`, placed first in PATH INSIDE the test container only.
# For each call it logs (to /tmp/wlog.jsonl): argv, the wrapper's own /proc cmdline, and, while the
# REAL /usr/bin/secret-tool runs, that process's /proc cmdline and exe link. For `store` the real
# tool's stdin is held open for 0.5 s after the value (the delay trick) so the sample is taken while
# the real process is alive. Values are never written anywhere except what is in argv (which the
# probe then checks does not contain any value).
REAL=/usr/bin/secret-tool
LOG=/tmp/wlog.jsonl
in=$(mktemp)
cat > "$in"
json() { node -e "process.stdout.write(JSON.stringify(process.argv[1]))" -- "$1"; }
argv_json="["
for a in "$@"; do argv_json="$argv_json$(json "$a"),"; done
argv_json="${argv_json%,}]"
self_cmd=$(tr '\0' ' ' < /proc/$$/cmdline)
if [ "$1" = store ]; then
  "$REAL" "$@" < <(cat "$in"; sleep 0.5) &
else
  "$REAL" "$@" < "$in" &
fi
rp=$!
sleep 0.2
real_cmd=""
real_exe=""
if [ -r /proc/$rp/cmdline ]; then
  real_cmd=$(tr '\0' ' ' < /proc/$rp/cmdline)
  real_exe=$(readlink /proc/$rp/exe)
fi
wait $rp
rc=$?
printf '{"argv":%s,"exit":%s,"wrapper_cmdline":%s,"real_cmdline":%s,"real_exe":%s}\n' \
  "$argv_json" "$rc" "$(json "$self_cmd")" "$(json "$real_cmd")" "$(json "$real_exe")" >> "$LOG"
rm -f "$in"
exit $rc
