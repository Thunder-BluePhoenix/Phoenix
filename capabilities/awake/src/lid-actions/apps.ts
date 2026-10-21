// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The apps Phoenix may freeze, as a constant table. Nothing else is ever frozen: configuration
// can only pick keys of this table, and events and status carry only these keys.
//
// A process belongs to an app when its executable path starts with one of the app's bundle paths
// (the main process and its helpers). The bundle ids are for reference and for the README; they
// are not used to find processes. UNVERIFIED on a real Mac: paths assume a default install in
// /Applications.

export interface FreezableApp {
  key: string;
  bundleId: string;
  /** Executable path prefixes (bundle folders, with trailing slash). */
  paths: readonly string[];
  /** Frozen when the user has not chosen a list. */
  byDefault: boolean;
}

export const FREEZE_APPS: readonly FreezableApp[] = [
  {
    key: "slack",
    bundleId: "com.tinyspeck.slackmacgap",
    paths: ["/Applications/Slack.app/"],
    byDefault: true,
  },
  {
    key: "whatsapp",
    bundleId: "net.whatsapp.WhatsApp",
    paths: ["/Applications/WhatsApp.app/"],
    byDefault: true,
  },
  {
    key: "discord",
    bundleId: "com.hnc.Discord",
    paths: ["/Applications/Discord.app/"],
    byDefault: true,
  },
];

/** Docker Desktop's own processes only (not the `docker` CLI, which lives under Contents/Resources). Frozen only by the Docker action. */
export const DOCKER_APP: FreezableApp = {
  key: "docker_desktop",
  bundleId: "com.docker.docker",
  paths: ["/Applications/Docker.app/Contents/MacOS/"],
  byDefault: false,
};

export const FREEZE_APP_KEYS: readonly string[] = FREEZE_APPS.map((a) => a.key);

/** The app key a command path belongs to, among `apps`. */
export function appKeyOf(command: string, apps: readonly FreezableApp[]): string | undefined {
  return apps.find((a) => a.paths.some((p) => command.startsWith(p)))?.key;
}
