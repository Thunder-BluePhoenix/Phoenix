// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { formatChord, isComposing, type Platform } from "../commands/keys";
import { PALETTE_ATTRIBUTE } from "../commands/useShortcuts";
import { available, type Bindings, type Command, type CommandContext } from "../commands/registry";
import { useHashRoute } from "../core/hooks";
import { useLocale, useT } from "../i18n";

/** Combining accents and Arabic vowel marks: ignored when comparing, so "cafe" finds "café". */
const MARKS = /[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g;

/** Text as compared when filtering: no case, no accents, one Unicode form, in the language's rules. */
export function fold(text: string, locale: string): string {
  return text.normalize("NFKD").replace(MARKS, "").toLocaleLowerCase(locale).normalize("NFC");
}

interface Entry {
  command: Command;
  label: string;
}

/**
 * The commands that match `query`, best first. Every word of the query must appear in the
 * command's label or keywords; a label that starts with the query beats one that contains it,
 * which beats a keyword match. Matching is a plain substring test on folded text, so it works for
 * scripts without word breaks (Chinese) and for Arabic with or without vowel marks.
 */
export function filterCommands(entries: readonly Entry[], query: string, locale: string): Entry[] {
  const words = fold(query, locale).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  const scored: { entry: Entry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const label = fold(entry.label, locale);
    const keywords = entry.command.keywords.map((k) => fold(k, locale)).join(" ");
    if (!words.every((w) => label.includes(w) || keywords.includes(w))) return;
    const score = label.startsWith(words.join(" "))
      ? 0
      : words.every((w) => label.includes(w))
        ? 1
        : 2;
    scored.push({ entry, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.entry);
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: readonly Command[];
  bindings: Bindings;
  platform: Platform;
  ctx: CommandContext;
}

/**
 * The command palette: Cmd/Ctrl+K opens a modal list of every command, filtered as you type.
 * A combobox (the input keeps focus; the arrow keys move the highlight with aria-activedescendant),
 * a focus trap, and focus returns to what had it before the palette opened.
 */
export function CommandPalette(props: CommandPaletteProps) {
  // Mounted only while open, so each opening starts with an empty query.
  return props.open ? <PaletteDialog {...props} /> : null;
}

function PaletteDialog({ onClose, commands, bindings, platform, ctx }: CommandPaletteProps) {
  const t = useT();
  const { locale } = useLocale();
  const route = useHashRoute();
  const base = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // Focus goes into the palette, and back to where it was when the palette closes. The element
  // is put back before a command's own focus move (the panel's heading) because unmount cleanups
  // run first; if it left the page, nothing is focused.
  useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  // Going somewhere else (a link, the back button, a command) closes the palette.
  const opened = useRef(route);
  useEffect(() => {
    if (route !== opened.current) onClose();
  }, [route, onClose]);

  const entries = useMemo(
    () =>
      available(commands, ctx)
        .filter((c) => c.inPalette !== false)
        .map((command) => ({
          command,
          label: t(command.labelKey),
        })),
    [commands, ctx, t],
  );
  const shown = useMemo(() => filterCommands(entries, query, locale), [entries, query, locale]);
  const current = Math.min(active, Math.max(shown.length - 1, 0));
  const optionId = (i: number) => `${base}-opt-${i}`;

  useEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView?.({ block: "nearest" });
  }, [current, shown]);

  const run = (command: Command) => {
    onClose();
    command.run(ctx);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // Not the panel's Escape handler on the document: one Escape closes one thing.
      e.stopPropagation();
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      const focusable = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          "input, button, [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !dialog.current?.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !dialog.current?.contains(at))) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    // Keys that belong to an input method (choosing a candidate with Enter or the arrows).
    if (isComposing(e.nativeEvent)) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + shown.length) % shown.length);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : Math.max(shown.length - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = shown[current];
      if (entry) run(entry.command);
    }
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${base}-title`}
        {...{ [PALETTE_ATTRIBUTE]: "" }}
        onKeyDown={onKeyDown}
      >
        <h2 id={`${base}-title`} className="sr-only">
          {t("shell.palette.title")}
        </h2>
        <input
          ref={input}
          className="palette-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${base}-list`}
          aria-autocomplete="list"
          aria-label={t("shell.palette.inputLabel")}
          aria-activedescendant={shown.length > 0 ? optionId(current) : undefined}
          aria-describedby={`${base}-hint`}
          placeholder={t("shell.palette.placeholder")}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        <ul
          id={`${base}-list`}
          className="palette-list"
          role="listbox"
          aria-label={t("shell.palette.results")}
        >
          {shown.map(({ command, label }, i) => {
            const chord = bindings.byCommand.get(command.id);
            return (
              <li
                key={command.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === current}
                className={
                  i === current ? "palette-option palette-option-active" : "palette-option"
                }
                onMouseMove={() => i !== current && setActive(i)}
                onClick={() => run(command)}
              >
                <span className="palette-label">{label}</span>
                {chord && <kbd className="palette-keys">{formatChord(chord, platform)}</kbd>}
              </li>
            );
          })}
        </ul>
        {shown.length === 0 && (
          <p className="palette-empty muted">{t("shell.palette.empty", { query })}</p>
        )}
        <p id={`${base}-hint`} className="palette-hint muted small">
          {t("shell.palette.hint")}
        </p>
        <p className="sr-only" role="status">
          {shown.length === 0
            ? t("shell.palette.empty", { query })
            : t("shell.palette.count", { count: shown.length })}
        </p>
      </div>
    </div>
  );
}
