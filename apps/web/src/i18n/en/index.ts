// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { agents } from "./agents";
import { automation } from "./automation";
import { capture } from "./capture";
import { common } from "./common";
import { memory } from "./memory";
import { pet } from "./pet";
import { phone } from "./phone";
import { power } from "./power";
import { services } from "./services";
import { settings } from "./settings";
import { shell } from "./shell";

/** Every English message: the source text, bundled with the app and the fallback for every key. */
export const en = {
  ...common,
  ...shell,
  ...agents,
  ...automation,
  ...capture,
  ...memory,
  ...pet,
  ...phone,
  ...power,
  ...services,
  ...settings,
} as const;

/** A message id, e.g. "common.button.save". A misspelt id is a compile error. */
export type MessageKey = keyof typeof en;

/** A complete set of messages: what every non-English locale must provide. */
export type Messages = Readonly<Record<MessageKey, string>>;
