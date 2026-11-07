// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { visualFor } from "@phoenix/pet-states";
import { useTasks } from "../core/context";
import type { PetState } from "../core/types";
import { isMessageKey, useT } from "../i18n";
import "./companion-summary.css";

/** Small, live preview shared by the floating companion and expanded notch. */
export function CompanionSummary({
  state,
  onOpen,
  onClose,
  id,
}: {
  state: PetState;
  onOpen(): void;
  onClose(): void;
  id?: string;
}) {
  const t = useT();
  const tasks = useTasks();
  const key = `common.petState.${state.state}`;
  const label = isMessageKey(key) ? t(key) : visualFor(state.state).label;
  return (
    <section id={id} className="companion-summary" aria-label={t("pet.summary.title")}>
      <header className="companion-summary-heading">
        <strong>{label}</strong>
        <button
          type="button"
          className="companion-summary-close"
          aria-label={t("common.button.close")}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p className="companion-summary-text">{state.explanation || label}</p>
      {tasks.length > 0 && (
        <p className="companion-summary-count">{t("pet.summary.tasks", { count: tasks.length })}</p>
      )}
      {tasks.length > 0 && (
        <ul className="companion-summary-tasks">
          {tasks.slice(0, 2).map((task) => (
            <li key={task.key} title={task.title}>
              {task.title}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="companion-summary-open" onClick={onOpen}>
        {t("pet.desktop.openInPhoenix")}
      </button>
    </section>
  );
}
