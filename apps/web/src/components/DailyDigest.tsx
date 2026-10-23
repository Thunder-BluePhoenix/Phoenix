// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useState } from "react";
import { useClient } from "../core/context";
import {
  digestText,
  type DailyDigest,
  type DigestCommitEvidence,
  type DigestEventEvidence,
  type DigestLine,
  type DigestSourceId,
} from "../core/digest";
import { useT } from "../i18n";

/** Loads one evidence record with the session token (a plain link cannot send it). */
function useEvidence<T>(path: string): { value: T | null; missing: boolean } {
  const client = useClient();
  const [value, setValue] = useState<T | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    setValue(null);
    setMissing(false);
    void client
      .request<T>("GET", path)
      .then((found) => {
        if (live) setValue(found);
      })
      .catch(() => {
        if (live) setMissing(true);
      });
    return () => {
      live = false;
    };
  }, [client, path]);
  return { value, missing };
}

/** The hash route is local evidence, never an untrusted payload URL. */
export function DailyDigestEventPage({ id }: { id: string }) {
  const t = useT();
  const { value: event, missing } = useEvidence<DigestEventEvidence>(
    `/api/digest/event/${encodeURIComponent(id)}`,
  );
  return (
    <section className="card">
      <a href="#/digest">{t("digest.back")}</a>
      <h1>{t("digest.eventTitle")}</h1>
      {missing && <p role="alert">{t("digest.eventMissing")}</p>}
      {!missing && !event && <p role="status">{t("digest.loading")}</p>}
      {event && (
        <>
          <p>{t("digest.unverified")}</p>
          <p>{event.title}</p>
          <p>{event.occurredAt}</p>
          <p>{event.id}</p>
        </>
      )}
    </section>
  );
}

/** A commit from a watched repository, shown in the app (the API needs the session token). */
export function DailyDigestCommitPage({ sha }: { sha: string }) {
  const t = useT();
  const { value: commit, missing } = useEvidence<DigestCommitEvidence>(
    `/api/digest/commit/${encodeURIComponent(sha)}`,
  );
  return (
    <section className="card">
      <a href="#/digest">{t("digest.back")}</a>
      <h1>{t("digest.commitTitle")}</h1>
      {missing && <p role="alert">{t("digest.commitMissing")}</p>}
      {!missing && !commit && <p role="status">{t("digest.loading")}</p>}
      {commit && (
        <>
          <p>{commit.title}</p>
          <p>{commit.occurredAt}</p>
          <p>{commit.sha}</p>
        </>
      )}
    </section>
  );
}

type Section = "yesterday" | "today" | "blockers" | "endOfDay";
type DigestSlackStatus = {
  enabled: boolean;
  available: boolean;
  reason:
    | "ready"
    | "disabled"
    | "chat_unavailable"
    | "slack_unconfigured"
    | "missing_token"
    | "emergency_stop";
};

type DigestSlackResult = { ok: true; day: string; cited_sources: number };

export function DailyDigestPage({
  load,
  copy = (text: string) => navigator.clipboard.writeText(text),
}: {
  /** Injection seam: production reads authenticated Core; tests do not contact a service. */
  load?: (day?: string) => Promise<DailyDigest>;
  copy?: (text: string) => Promise<void>;
}) {
  const client = useClient();
  const t = useT();
  const [day, setDay] = useState("");
  const [digest, setDigest] = useState<DailyDigest | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slack, setSlack] = useState<DigestSlackStatus | null>(null);
  const [slackBusy, setSlackBusy] = useState(false);
  const [slackResult, setSlackResult] = useState<DigestSlackResult | null>(null);
  const [slackError, setSlackError] = useState(false);
  useEffect(() => {
    let live = true;
    setDigest(null);
    setError(false);
    const path = `/api/digest${day ? `?day=${encodeURIComponent(day)}` : ""}`;
    void (load ? load(day || undefined) : client.request<DailyDigest>("GET", path))
      .then((value) => {
        if (live) setDigest(value);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [client, day, load]);
  useEffect(() => {
    let live = true;
    void client
      .request<DigestSlackStatus>("GET", "/api/digest/slack")
      .then((value) => {
        if (live) setSlack(value);
      })
      .catch(() => {
        if (live) setSlack(null);
      });
    return () => {
      live = false;
    };
  }, [client]);
  const headings: Record<Section, string> = {
    yesterday: t("digest.yesterday"),
    today: t("digest.today"),
    blockers: t("digest.blockers"),
    endOfDay: t("digest.endOfDay"),
  };
  const sourceName: Record<DigestSourceId, string> = {
    git: t("digest.sources.git"),
    events: t("digest.sources.events"),
    sessions: t("digest.sources.sessions"),
    meetings: t("digest.sources.meetings"),
  };
  const names = (ids: readonly DigestSourceId[]) => ids.map((id) => sourceName[id]).join(", ");
  /** What the digest could not see; shown above the sections and pasted first by Copy. */
  const notices: string[] = digest
    ? [
        ...(digest.unavailable.length
          ? [t("digest.noticeUnavailable", { sources: names(digest.unavailable) })]
          : []),
        ...(digest.partial.length
          ? [t("digest.noticePartial", { sources: names(digest.partial) })]
          : []),
        ...(digest.unattributed.length
          ? [t("digest.noticeUnattributed", { sources: names(digest.unattributed) })]
          : []),
      ]
    : [];
  async function copyDigest() {
    if (!digest || busy) return;
    setBusy(true);
    setCopied(false);
    try {
      await copy(digestText(digest, { ...headings, none: t("digest.none"), notices }));
      setCopied(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function setSlackEnabled(value: boolean) {
    if (slackBusy) return;
    setSlackBusy(true);
    setSlackError(false);
    setSlackResult(null);
    try {
      setSlack(
        await client.request<DigestSlackStatus>("PUT", "/api/digest/slack", { enabled: value }),
      );
    } catch {
      setSlackError(true);
    } finally {
      setSlackBusy(false);
    }
  }
  async function sendToSlack() {
    if (!digest || slackBusy || !slack?.available) return;
    setSlackBusy(true);
    setSlackError(false);
    setSlackResult(null);
    try {
      const path = day
        ? `/api/digest/${encodeURIComponent(digest.day)}/slack`
        : "/api/digest/slack";
      setSlackResult(await client.request<DigestSlackResult>("POST", path, {}));
    } catch {
      setSlackError(true);
    } finally {
      setSlackBusy(false);
    }
  }
  return (
    <section className="card" aria-labelledby="digest-title">
      <h1 id="digest-title">{t("digest.title")}</h1>
      <p>{t("digest.localNote")}</p>
      <label htmlFor="digest-day">{t("digest.date")}</label>{" "}
      <input
        id="digest-day"
        type="date"
        value={day}
        onChange={(event) => setDay(event.target.value)}
      />
      {error && <p role="alert">{t("digest.error")}</p>}
      {!digest && !error && <p role="status">{t("digest.loading")}</p>}
      {digest && (
        <>
          <p>{digest.day}</p>
          {notices.length > 0 && (
            <ul role="alert" aria-label={t("digest.noticeHeading")}>
              {notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          )}
          {(["yesterday", "today", "blockers", "endOfDay"] as const).map((section) => (
            <section key={section} aria-label={headings[section]}>
              <h2>{headings[section]}</h2>
              {digest[section].length ? (
                <ul>
                  {digest[section].map((line: DigestLine, i) => (
                    <li key={`${line.source.href}:${i}`}>
                      {line.text} <a href={line.source.href}>{t("digest.source")}</a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{notices.length ? t("digest.noneIncomplete") : t("digest.none")}</p>
              )}
            </section>
          ))}
          <button type="button" disabled={busy} onClick={() => void copyDigest()}>
            {t("digest.copy")}
          </button>
          {copied && <span role="status">{t("digest.copied")}</span>}
          <section aria-label={t("digest.slackHeading")}>
            <h2>{t("digest.slackHeading")}</h2>
            <p>{t("digest.slackDisclosure")}</p>
            {slack ? (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={slack.enabled}
                    disabled={slackBusy}
                    onChange={(event) => void setSlackEnabled(event.target.checked)}
                  />{" "}
                  {t("digest.slackOptIn")}
                </label>
                {!slack.available && <p role="status">{t(`digest.slack.${slack.reason}`)}</p>}
                <button
                  type="button"
                  disabled={!slack.available || slackBusy}
                  onClick={() => void sendToSlack()}
                >
                  {t("digest.sendSlack")}
                </button>
              </>
            ) : (
              <p role="status">{t("digest.slackUnavailable")}</p>
            )}
            {slackBusy && <p role="status">{t("digest.slackWaiting")}</p>}
            {slackError && <p role="alert">{t("digest.slackError")}</p>}
            {slackResult && <p role="status">{t("digest.slackSent", { day: slackResult.day })}</p>}
          </section>
        </>
      )}
    </section>
  );
}
