// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { visualFor } from "@phoenix/pet-states";
import { useEffect, useRef } from "react";
import type { ActiveTask, PetState } from "../core/types";

export interface PetPanelProps {
  id: string;
  state: PetState;
  tasks: ActiveTask[];
  onClose: () => void;
}

/**
 * Pet Panel shell (Phase 08). Activity feed, capabilities, notifications and
 * quick actions arrive in Phase 09.
 */
export function PetPanel({ id, state, tasks, onClose }: PetPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const visual = visualFor(state.state);
  return (
    <section
      id={id}
      className="pet-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
    >
      <div className="pet-panel-header">
        <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
          Fawkes
        </h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close Pet Panel"
        >
          ×
        </button>
      </div>
      <div className={`pet-status tone-${visual.tone}`}>
        <strong>{visual.label}</strong>
        <span>{state.explanation}</span>
      </div>
      {state.recording && (
        <p className="pet-recording" role="note">
          Recording is active.
        </p>
      )}
      <h3>Active tasks</h3>
      {tasks.length === 0 ? (
        <p className="muted">Nothing running.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((t) => (
            <li key={t.key}>
              <span>{t.title}</span>
              <span className="muted"> · {t.source}</span>
              {t.progress !== undefined && (
                <progress max={1} value={t.progress} aria-label={`${t.title} progress`} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
