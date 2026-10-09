// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ActiveTask, PetState } from "../core/types";
import { ActivityFeed } from "./ActivityFeed";
import { CapabilityList } from "./CapabilityList";
import { Chat } from "./Chat";
import { MemoryPanel } from "./MemoryPanel";
import { Overview } from "./Overview";

export interface PetPanelProps {
  id: string;
  state: PetState;
  tasks: ActiveTask[];
  onClose: () => void;
  /** Tab shown first, for example when the desktop pet opens Phoenix at "#/panel/overview". */
  initialTab?: TabId;
}

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "chat", label: "Chat" },
  { id: "activity", label: "Activity" },
  { id: "capabilities", label: "Capabilities" },
  { id: "memory", label: "Memory" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export const isTabId = (v: string | undefined): v is TabId => TABS.some((t) => t.id === v);

/** Pet Panel (PRD v2.0 §5.3): current state, approvals, tasks, activity, capabilities, actions. */
export function PetPanel({ id, state, tasks, onClose, initialTab = "overview" }: PetPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [tab, setTab] = useState<TabId>(initialTab);

  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % TABS.length
        : e.key === "ArrowLeft"
          ? (i - 1 + TABS.length) % TABS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]!.id);
    tabRefs.current[TABS[next]!.id]?.focus();
  };

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
      <div role="tablist" aria-label="Pet Panel sections" className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${id}-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className="tab"
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKey}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-${tab}`}
        aria-labelledby={`${id}-tab-${tab}`}
        className="tabpanel"
      >
        {tab === "overview" && <Overview state={state} tasks={tasks} />}
        {tab === "chat" && <Chat />}
        {tab === "activity" && <ActivityFeed />}
        {tab === "capabilities" && <CapabilityList />}
        {tab === "memory" && <MemoryPanel />}
      </div>
    </section>
  );
}
