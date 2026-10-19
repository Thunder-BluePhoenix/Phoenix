// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Every AppleScript this capability runs. Each is a hard-coded constant: nothing (no track name,
// no volume, no seek position) is ever put into script text. Variable values travel as separate
// `osascript` arguments that the script reads with `item N of argv`. A script that talks to the
// player first checks the app is already running, because `tell application "Music"` would
// otherwise launch it.

/** Does not launch the app: `is running` only asks the system. */
export const RUNNING_SCRIPT = `return (application "Music" is running) as text`;

/** Field separator in `NOW_PLAYING_SCRIPT` output (ASCII unit separator). */
export const FIELD_SEPARATOR = "\u001f";

/** state, title, artist, album, duration s, position s, volume, shuffle, repeat (off|one|all) */
export const NOW_PLAYING_SCRIPT = `on clean(t)
	set saved to AppleScript's text item delimiters
	set AppleScript's text item delimiters to {(ASCII character 31), (ASCII character 10), (ASCII character 13), (ASCII character 9)}
	set parts to text items of (t as text)
	set AppleScript's text item delimiters to " "
	set r to parts as text
	set AppleScript's text item delimiters to saved
	return r
end clean
on run argv
	if application "Music" is not running then return "not_running"
	set vTitle to ""
	set vArtist to ""
	set vAlbum to ""
	set vDuration to -1
	set vPosition to -1
	set vVolume to -1
	set vShuffle to ""
	set vRepeat to ""
	tell application "Music"
		set vState to player state as text
		try
			set vTitle to name of current track
		end try
		try
			set vArtist to artist of current track
		end try
		try
			set vAlbum to album of current track
		end try
		try
			set vDuration to (duration of current track) as integer
		end try
		try
			set vPosition to (player position) as integer
		end try
		try
			set vVolume to sound volume
		end try
		try
			set vShuffle to (shuffle enabled) as text
		end try
		try
			set vRepeat to (song repeat) as text
		end try
	end tell
	set sep to (ASCII character 31)
	return vState & sep & my clean(vTitle) & sep & my clean(vArtist) & sep & my clean(vAlbum) & sep & (vDuration as text) & sep & (vPosition as text) & sep & (vVolume as text) & sep & vShuffle & sep & vRepeat
end run`;

export const PLAY_PAUSE_SCRIPT = `on run argv
	if application "Music" is not running then return "not_running"
	tell application "Music" to playpause
	return "ok"
end run`;

export const NEXT_SCRIPT = `on run argv
	if application "Music" is not running then return "not_running"
	tell application "Music" to next track
	return "ok"
end run`;

export const PREVIOUS_SCRIPT = `on run argv
	if application "Music" is not running then return "not_running"
	tell application "Music" to previous track
	return "ok"
end run`;

/** argv: whole seconds. */
export const SEEK_SCRIPT = `on run argv
	if application "Music" is not running then return "not_running"
	set p to (item 1 of argv) as integer
	tell application "Music" to set player position to p
	return "ok"
end run`;

/** argv: 0-100. */
export const VOLUME_SCRIPT = `on run argv
	if application "Music" is not running then return "not_running"
	set v to (item 1 of argv) as integer
	tell application "Music" to set sound volume to v
	return "ok"
end run`;

/** argv: "true" or "false". */
export const SHUFFLE_SCRIPT = `on run argv
	if application "Music" is not running then return "not_running"
	set s to ((item 1 of argv) is "true")
	tell application "Music" to set shuffle enabled to s
	return "ok"
end run`;

/** argv: "off", "one" or "all"; anything else changes nothing. */
export const REPEAT_SCRIPT = `on run argv
	if application "Music" is not running then return "not_running"
	set m to item 1 of argv
	tell application "Music"
		if m is "off" then
			set song repeat to off
		else if m is "one" then
			set song repeat to one
		else if m is "all" then
			set song repeat to all
		else
			return "bad_mode"
		end if
	end tell
	return "ok"
end run`;

export const ALL_SCRIPTS: ReadonlySet<string> = new Set([
  RUNNING_SCRIPT,
  NOW_PLAYING_SCRIPT,
  PLAY_PAUSE_SCRIPT,
  NEXT_SCRIPT,
  PREVIOUS_SCRIPT,
  SEEK_SCRIPT,
  VOLUME_SCRIPT,
  SHUFFLE_SCRIPT,
  REPEAT_SCRIPT,
]);
