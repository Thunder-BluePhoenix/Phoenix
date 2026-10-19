// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useState } from "react";
import { useCapabilities, useCommandAction, useCommandResult } from "../core/hooks";
import {
  formatClock,
  MEDIA_SERVICES,
  nextRepeat,
  readNowPlaying,
  type MediaRepeat,
  type MediaServiceId,
} from "../core/media";

type ControlCommand =
  "play_pause" | "next" | "previous" | "seek" | "set_volume" | "set_shuffle" | "set_repeat";

interface RangeProps {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  busy: boolean;
  onCommit: (value: number) => void;
}

/**
 * A slider that only holds a local draft while it moves and sends ONE command when the user lets
 * go (pointer up or key up): every command asks for approval, so one per change event would bury
 * the user in prompts. The draft stays until that command is over, so the thumb does not jump back.
 */
function Range({ label, value, max, disabled, busy, onCommit }: RangeProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (sent && !busy) {
      setSent(false);
      setDraft(null);
    }
  }, [sent, busy]);
  const commit = () => {
    if (draft === null || sent) return;
    setSent(true);
    onCommit(Math.min(max, Math.max(0, Math.round(draft))));
  };
  return (
    <input
      type="range"
      aria-label={label}
      min={0}
      max={max}
      step={1}
      value={Math.min(max, draft ?? value)}
      disabled={disabled}
      onChange={(e) => setDraft(Number(e.target.value))}
      onPointerUp={commit}
      onKeyUp={commit}
    />
  );
}

function MediaSection({ id, name }: { id: MediaServiceId; name: string }) {
  const { data, error, reload } = useCommandResult<unknown>(id, "now_playing", true, (t) =>
    t.startsWith(`${id.replaceAll("-", "_")}.track.`),
  );
  const controls = {
    play_pause: useCommandAction(id, "play_pause"),
    next: useCommandAction(id, "next"),
    previous: useCommandAction(id, "previous"),
    seek: useCommandAction(id, "seek"),
    set_volume: useCommandAction(id, "set_volume"),
    set_shuffle: useCommandAction(id, "set_shuffle"),
    set_repeat: useCommandAction(id, "set_repeat"),
  };
  const [last, setLast] = useState<ControlCommand>("play_pause");
  const lastState = controls[last].state;
  useEffect(() => {
    if (lastState === "succeeded") void reload();
  }, [lastState, reload]);

  const now = readNowPlaying(data);
  const all = Object.values(controls);
  const busy = all.some((c) => c.busy);
  const waiting = all.some((c) => c.state === "waiting");
  const controlError = controls[last].state === "failed" ? controls[last].error : null;
  const send = (command: ControlCommand, input: Record<string, unknown>) => {
    setLast(command);
    void controls[command].submit(input);
  };

  const notRunning = now?.state === "not_running";
  const off = notRunning || now === null || busy;
  const repeat: MediaRepeat = now?.repeat ?? "off";
  const headingId = `now-playing-${id}-h`;
  return (
    <section aria-labelledby={headingId} className="now-playing">
      <h3 id={headingId}>Now playing · {name}</h3>
      {error && <p className="error-text small">{error}</p>}
      {now === null && !error && <p className="muted small">Not yet loaded.</p>}
      {notRunning && <p className="muted small">{name} is not running.</p>}
      {now && !notRunning && (
        <div className="media-track">
          {now.cover && <img className="media-cover" src={now.cover} alt="" />}
          <div className="media-text">
            {now.title ? (
              <strong>{now.title}</strong>
            ) : (
              <span className="muted">Nothing playing</span>
            )}
            {now.artist && <div>{now.artist}</div>}
            {now.album && <div className="muted small">{now.album}</div>}
          </div>
        </div>
      )}
      {now && !notRunning && (
        <p className="muted small media-clock">
          {formatClock(now.position_s)} / {formatClock(now.duration_s)}
        </p>
      )}
      <div className="media-controls">
        <button
          type="button"
          className="btn"
          aria-label="Previous"
          disabled={off}
          onClick={() => send("previous", {})}
        >
          ⏮
        </button>
        <button
          type="button"
          className="btn"
          aria-label={now?.state === "playing" ? "Pause" : "Play"}
          disabled={off}
          onClick={() => send("play_pause", {})}
        >
          {now?.state === "playing" ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          className="btn"
          aria-label="Next"
          disabled={off}
          onClick={() => send("next", {})}
        >
          ⏭
        </button>
        <button
          type="button"
          className="btn"
          aria-label={now?.shuffle ? "Shuffle on" : "Shuffle off"}
          aria-pressed={now?.shuffle === true}
          disabled={off}
          onClick={() => send("set_shuffle", { enabled: now?.shuffle !== true })}
        >
          🔀
        </button>
        <button
          type="button"
          className="btn"
          aria-label={`Repeat: ${repeat}`}
          aria-pressed={repeat !== "off"}
          disabled={off}
          onClick={() => send("set_repeat", { mode: nextRepeat(repeat, id) })}
        >
          🔁
        </button>
      </div>
      <div className="media-sliders">
        <div className="media-slider">
          <span className="muted small" aria-hidden="true">
            Seek
          </span>
          <Range
            label="Seek"
            value={now?.position_s ?? 0}
            max={Math.floor(now?.duration_s ?? 0)}
            disabled={off || !now?.duration_s}
            busy={controls.seek.busy}
            onCommit={(position_s) => send("seek", { position_s })}
          />
        </div>
        <div className="media-slider">
          <span className="muted small" aria-hidden="true">
            Volume
          </span>
          <Range
            label="Volume"
            value={now?.volume ?? 0}
            max={100}
            disabled={off || now?.volume === undefined}
            busy={controls.set_volume.busy}
            onCommit={(volume) => send("set_volume", { volume })}
          />
        </div>
      </div>
      {waiting && (
        <p role="status" className="muted small">
          Waiting for your approval…
        </p>
      )}
      {controlError && (
        <p role="alert" className="error-text small">
          {controlError}
        </p>
      )}
    </section>
  );
}

/** What Spotify and Apple Music are playing, with controls. One section per media capability that is on. */
export function NowPlayingGlance() {
  const { data: caps } = useCapabilities();
  return (
    <>
      {MEDIA_SERVICES.filter((s) => caps.find((c) => c.id === s.id)?.status === "enabled").map(
        (s) => (
          <MediaSection key={s.id} id={s.id} name={s.name} />
        ),
      )}
    </>
  );
}
