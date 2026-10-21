# Lid-close actions

When you close the lid during a Keep awake session, Phoenix can (all optional, in Settings → Lid-close
actions): turn the display off, freeze chat apps (Slack, WhatsApp, Discord), mute the sound, turn on
Low Power Mode, freeze Docker Desktop when no container runs (off by default) and keep agent apps
out of App Nap (off by default). Opening the lid, ending the session, disabling the capability or the
emergency stop undoes every one of them.

What Phoenix will never do: freeze Phoenix itself, a terminal, an editor, a running coding agent, or
any meeting, recording or dictation app. While a meeting, recording or dictation is in progress, or
while Phoenix cannot tell whether one is, it also leaves the sound, the display and App Nap alone. You
can add names to the protected list; you cannot remove the built-in ones.

In-app calls (Slack, WhatsApp, Discord) are detected only in one way: Phoenix reads which apps hold a
power or audio "assertion" (macOS's way of saying "keep me awake" or "I am playing sound"; read-only,
`pmset -g assertions`) and does not freeze an app that holds one. A call that holds none is not
detected. If the assertions cannot be read, nothing is frozen. A frozen app is resumed only when
Phoenix can prove it is the very same process it froze (same program, same start time, same user);
if it looks restarted, it is left alone and you are told.

Everything is written to the recovery journal before it is made. If Phoenix crashes, the next launch
undoes what was left (a frozen app stays frozen until then; Low Power Mode is also covered by the
launchd backstop). Limits on this Mac are shown in the settings: per-device mute and the keyboard
light are not supported (if you switch the sound output while the lid is closed, Phoenix leaves the new
output alone and tells you), brightness needs the free `brightness` tool, Low Power Mode needs the
privileged helper (see awake-helper.md). Details and unverified points: `capabilities/awake/README-lid.md`.
