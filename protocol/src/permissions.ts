// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Permission categories a capability can request (Full System PRD v2.0 §10.2). */
export const PERMISSIONS = [
  "microphone",
  "camera",
  "meeting_recording",
  "filesystem_read",
  "filesystem_write",
  "network",
  "shell_command",
  "repository_access",
  "container_access",
  "production_action",
  "external_api",
  "AI_external_processing",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_DESCRIPTIONS: Readonly<Record<Permission, string>> = {
  microphone: "Use the microphone",
  camera: "Use the camera",
  meeting_recording: "Record meetings",
  filesystem_read: "Read files on this computer",
  filesystem_write: "Write or delete files on this computer",
  network: "Make network connections",
  shell_command: "Run shell commands",
  repository_access: "Access source code repositories",
  container_access: "Read container and image state from the Docker engine",
  production_action: "Change production systems",
  external_api: "Call external services on your behalf",
  AI_external_processing: "Send data to an external AI provider",
};

/**
 * Permissions that always need an explicit user confirmation per action,
 * even when granted (no silent recording; PRD v2.0 §19).
 */
export const ALWAYS_CONFIRM: ReadonlySet<Permission> = new Set([
  "microphone",
  "camera",
  "meeting_recording",
  "production_action",
]);

/** What an action does to the world; read and write are always separated. */
export const SIDE_EFFECTS = ["none", "read", "write", "execute", "external", "production"] as const;
export type SideEffect = (typeof SIDE_EFFECTS)[number];

/** Side effects that require explicit confirmation in the MVP (PRD v2.0 §3.1, §11.4). */
export const CONFIRM_SIDE_EFFECTS: ReadonlySet<SideEffect> = new Set([
  "write",
  "execute",
  "external",
  "production",
]);

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
