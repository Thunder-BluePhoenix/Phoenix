// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 93: the chrome's half of permission prompts. A page asks (the shell emits the request), the
// person answers Allow once or Deny, and the shell applies it. The shell is the authority on the
// 30 second limit (it denies by itself); the chrome shows the countdown and sends its own deny at the
// same moment, which the shell ignores if it already acted. Nothing here ever grants more than once.
import { useCallback, useEffect, useRef, useState } from "react";
import { PERMISSION_TIMEOUT_MS, type BrowserShell, type PermissionRequest } from "./shell";

/** Open prompts at once. A page that asks for more is not shown the rest (the shell denies them itself). */
export const MAX_PENDING_PERMISSIONS = 8;

export interface PermissionClock {
  now(): number;
  every(run: () => void, ms: number): () => void;
}

export const SYSTEM_CLOCK: PermissionClock = {
  now: () => Date.now(),
  every: (run, ms) => {
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  },
};

/** One request on screen and the moment it stops being answerable. */
export interface PendingPermission extends PermissionRequest {
  deadline: number;
}

/** Whole seconds left, never negative. */
export function secondsLeft(pending: PendingPermission, now: number): number {
  return Math.max(0, Math.ceil((pending.deadline - now) / 1000));
}

export interface PermissionPrompts {
  /** Oldest first; the first one is the one the person is asked about. */
  queue: readonly PendingPermission[];
  now: number;
  answer(requestId: string, allow: boolean): void;
}

/**
 * Collects the shell's permission requests, drops the ones the shell settles itself and denies any
 * that reach the limit unanswered. `onError` hears about an answer the shell could not take.
 */
export function usePermissionPrompts(
  shell: BrowserShell | null,
  clock: PermissionClock,
  onError: () => void,
): PermissionPrompts {
  const [queue, setQueueState] = useState<readonly PendingPermission[]>([]);
  const [now, setNow] = useState(() => clock.now());
  // Events can arrive several in one tick, before React renders: the ref is the source of truth.
  const queueRef = useRef(queue);
  const setQueue = useCallback(
    (update: (q: readonly PendingPermission[]) => readonly PendingPermission[]) => {
      queueRef.current = update(queueRef.current);
      setQueueState(queueRef.current);
    },
    [],
  );
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const send = useCallback(
    (requestId: string, allow: boolean) => {
      void shell?.answerPermission(requestId, allow).catch(() => errorRef.current());
    },
    [shell],
  );

  const answer = useCallback(
    (requestId: string, allow: boolean) => {
      if (!queueRef.current.some((p) => p.requestId === requestId)) return;
      setQueue((q) => q.filter((p) => p.requestId !== requestId));
      send(requestId, allow);
    },
    [send, setQueue],
  );

  useEffect(() => {
    if (!shell) return;
    let alive = true;
    const undo: (() => void)[] = [];
    const keep = (p: Promise<() => void>) =>
      void p.then((off) => (alive ? undo.push(off) : off())).catch(() => {});
    keep(
      shell.onPermissionRequest((request) => {
        if (
          queueRef.current.some((p) => p.requestId === request.requestId) ||
          queueRef.current.length >= MAX_PENDING_PERMISSIONS
        ) {
          // A repeat id or a flood is never put in front of the person.
          if (queueRef.current.length >= MAX_PENDING_PERMISSIONS) send(request.requestId, false);
          return;
        }
        const at = clock.now();
        setNow(at);
        setQueue((q) => [...q, { ...request, deadline: at + PERMISSION_TIMEOUT_MS }]);
      }),
    );
    keep(
      shell.onPermissionResolved((requestId) =>
        setQueue((q) => q.filter((p) => p.requestId !== requestId)),
      ),
    );
    return () => {
      alive = false;
      undo.forEach((off) => off());
    };
  }, [shell, clock, send, setQueue]);

  // A request whose tab went away is the shell's to settle (`permission-resolved`); here only time.
  const waiting = queue.length > 0;
  useEffect(() => {
    if (!waiting) return;
    const tick = () => {
      const at = clock.now();
      setNow(at);
      const expired = queueRef.current.filter((p) => p.deadline <= at);
      if (expired.length === 0) return;
      setQueue((q) => q.filter((p) => p.deadline > at));
      for (const p of expired) send(p.requestId, false);
    };
    return clock.every(tick, 1000);
  }, [waiting, clock, send, setQueue]);

  return { queue, now, answer };
}
