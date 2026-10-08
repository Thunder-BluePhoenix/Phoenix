// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { CapabilityManager } from "@phoenix/capability-manager";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { MeetingStore, Summary, Transcript } from "@phoenix/persistence";
import type { PhoenixEvent } from "@phoenix/protocol";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * Keeps Phoenix's meeting records in step with meeting capabilities (Kage).
 * Any capability event with `payload.meeting_id` updates the record; when a
 * transcript or summary becomes ready it is fetched through the capability's
 * own read commands, so content never travels inside events.
 */
export function syncMeetings(o: {
  bus: EventBus;
  store: MeetingStore;
  capabilities: CapabilityManager;
  logger: Logger;
}): () => void {
  const fetchContent = async (event: PhoenixEvent, externalId: string) => {
    const id = `${event.source}:${externalId}`;
    try {
      // Events can come from any source, including ones that are not registered capabilities
      // (POST /api/events). That must never reach the process as an unhandled rejection.
      const commands = new Set(o.capabilities.get(event.source).commands.map((c) => c.name));
      const pull = async (command: string) => {
        if (!commands.has(command)) return undefined;
        const op = await o.capabilities.invokeAndWait(
          event.source,
          command,
          { meeting_id: externalId },
          "core",
        );
        if (op.status !== "succeeded") throw new Error(op.error?.message ?? `${command} failed`);
        return op.result;
      };
      const transcript = (await pull("meeting.get_transcript")) as Transcript | undefined;
      if (transcript) o.store.setTranscript(id, transcript);
      const summary = (await pull("meeting.get_summary")) as Summary | null | undefined;
      if (summary) o.store.setSummary(id, summary);
    } catch (err) {
      o.logger.warn("could not fetch meeting content", { id, error: (err as Error).message });
    }
  };

  return o.bus.subscribe("meetings", "*", (event) => {
    const p = event.payload;
    const externalId = str(p.meeting_id);
    if (!externalId || event.source === "core" || !str(p.status)) return;
    const recording = p.recording as { location?: unknown; retention?: unknown } | undefined;
    const meeting = o.store.upsert({
      capabilityId: event.source,
      externalId,
      status: p.status as string,
      ...(str(p.title) ? { title: p.title as string } : {}),
      ...(str(p.started_at) ? { startedAt: p.started_at as string } : {}),
      ...(str(p.ended_at) ? { endedAt: p.ended_at as string } : {}),
      ...(typeof p.duration_seconds === "number" ? { durationSeconds: p.duration_seconds } : {}),
      ...(Array.isArray(p.participants) ? { participants: p.participants.map(String) } : {}),
      ...(str(recording?.location)
        ? {
            recording: {
              location: recording!.location as string,
              retention: str(recording!.retention) ?? "managed by the capability",
            },
          }
        : {}),
    });
    const done =
      event.event_type.endsWith(".transcription.completed") ||
      event.event_type.endsWith(".summary.ready");
    const missing =
      (meeting?.status === "transcribed" || meeting?.status === "ready") && !meeting.has_transcript;
    if (meeting && (done || missing)) {
      // Not awaited: the bus must not wait on a capability round trip.
      void fetchContent(event, externalId);
    }
  });
}
