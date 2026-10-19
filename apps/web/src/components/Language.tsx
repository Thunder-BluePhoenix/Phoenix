// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId } from "react";
import { useSaveLocale } from "../core/ui-settings";
import { useLocale, useT } from "../i18n";
import { isLocale, LOCALES } from "../i18n/supported";

/** Settings: the interface language. Each language is named in itself so anyone can find theirs. */
export function LanguageSection() {
  const t = useT();
  const { locale } = useLocale();
  const { save, failed, saved } = useSaveLocale();
  const headingId = useId();
  const selectId = useId();
  return (
    <section aria-labelledby={headingId} className="card">
      <h2 id={headingId} className="h3">
        {t("shell.language.title")}
      </h2>
      <label className="field" htmlFor={selectId}>
        {t("shell.language.label")}
      </label>
      <select
        id={selectId}
        value={locale}
        onChange={(e) => {
          if (isLocale(e.target.value)) void save(e.target.value);
        }}
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code} dir={l.dir}>
            {l.native}
          </option>
        ))}
      </select>
      <p className="muted small">{t("shell.language.available", { count: LOCALES.length })}</p>
      <p className="muted small">{t("shell.language.machineNote")}</p>
      {failed && (
        <p className="error-text small" role="alert">
          {t("shell.language.failed")}
        </p>
      )}
      {saved && !failed && (
        <p className="small" role="status">
          {t("shell.language.saved")}
        </p>
      )}
    </section>
  );
}
