// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { isMessageKey, useT, type Translate } from "../i18n";
import type { CapabilityView } from "./types";

type Source = Pick<CapabilityView, "id" | "kind" | "name" | "description">;

/**
 * Display name of a capability. Only a capability Core reports as built in, and that has an entry in
 * the label table, is translated; anything else (a third-party manifest, a built-in added later
 * without a label) shows the text its manifest sent, untouched.
 */
export function capabilityName(t: Translate, c: Source): string {
  const key = `capabilityLabels.${c.id}.name`;
  return c.kind === "builtin" && isMessageKey(key) ? t(key) : c.name;
}

/** One-line description of a capability; same rule as {@link capabilityName}. */
export function capabilityDescription(t: Translate, c: Source): string {
  const key = `capabilityLabels.${c.id}.description`;
  return c.kind === "builtin" && isMessageKey(key) ? t(key) : c.description;
}

/**
 * Label of a configuration field: `<capabilityId>.<field>` first, then `<field>`, only for a built-in
 * capability. Any other capability's field shows its key, as before.
 */
export function capabilityFieldLabel(t: Translate, c: Pick<Source, "id" | "kind">, field: string) {
  if (c.kind !== "builtin") return field;
  const specific = `capabilityLabels.field.${c.id}.${field}`;
  if (isMessageKey(specific)) return t(specific);
  const general = `capabilityLabels.field.${field}`;
  return isMessageKey(general) ? t(general) : field;
}

/** The translate function plus the three label lookups, for a component. */
export function useCapabilityText() {
  const t = useT();
  return {
    name: (c: Source) => capabilityName(t, c),
    description: (c: Source) => capabilityDescription(t, c),
    field: (c: Pick<Source, "id" | "kind">, field: string) => capabilityFieldLabel(t, c, field),
  };
}
