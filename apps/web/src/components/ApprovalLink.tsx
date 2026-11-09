// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, useState } from "react";
import { isApprovalId, parseApprovalLink, TEAMS_VERIFY_PATH } from "../core/approval-link";
import { useClient } from "../core/context";
import { useT } from "../i18n";
import { AgentApprovals } from "./AgentApprovals";
import { Approvals } from "./Approvals";

type Look =
  | { status: "checking" }
  | { status: "found"; list: "confirmation" | "agent"; id: string }
  | { status: "missing" }
  | { status: "unreachable" };

const stillOpen = (expires: unknown): boolean => {
  if (typeof expires !== "string") return true;
  const at = Date.parse(expires);
  return !Number.isFinite(at) || at > Date.now();
};

/**
 * `#/approvals?id=<id>` (and the Teams form): shows ONE approval, and only if Core says it exists
 * and is still pending. The link is untrusted text. For a Teams link Core first verifies the
 * signature; the answer is `{valid, approval_id}` and nothing else. An unknown, expired, tampered
 * or already decided approval all show the same plain "not found" text, so a link cannot be used to
 * probe which ids exist. The page decides nothing: the cards are the ordinary approval cards.
 */
export function ApprovalLinkPage({ route }: { route: string }) {
  const t = useT();
  const client = useClient();
  const link = parseApprovalLink(route);
  const key = link ? (link.kind === "id" ? `id:${link.id}` : `teams:${link.query}`) : "";
  const [look, setLook] = useState<Look>({ status: "checking" });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  useEffect(() => {
    const wanted = parseApprovalLink(route);
    if (!wanted) {
      setLook({ status: "missing" });
      return;
    }
    let cancelled = false;
    setLook({ status: "checking" });
    void (async () => {
      try {
        let id: string | undefined;
        if (wanted.kind === "id") id = wanted.id;
        else {
          const verdict = await client.request<{ valid?: unknown; approval_id?: unknown }>(
            "POST",
            TEAMS_VERIFY_PATH,
            { query: wanted.query },
          );
          if (verdict.valid === true && isApprovalId(verdict.approval_id)) id = verdict.approval_id;
        }
        if (id === undefined) return void (cancelled || setLook({ status: "missing" }));
        const [confirmations, agent] = await Promise.all([
          client.request<{ confirmations?: { id?: unknown; expiresAt?: unknown }[] }>(
            "GET",
            "/api/confirmations",
          ),
          client.request<{ approvals?: { id?: unknown; expires_at?: unknown }[] }>(
            "GET",
            "/api/agent-approvals",
          ),
        ]);
        if (cancelled) return;
        if ((confirmations.confirmations ?? []).some((c) => c.id === id && stillOpen(c.expiresAt)))
          setLook({ status: "found", list: "confirmation", id });
        else if ((agent.approvals ?? []).some((a) => a.id === id && stillOpen(a.expires_at)))
          setLook({ status: "found", list: "agent", id });
        else setLook({ status: "missing" });
      } catch {
        if (!cancelled) setLook({ status: "unreachable" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `key` stands for the parsed link, so the check reruns only when the link itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  return (
    <section aria-labelledby="approval-link-h" className="approval-link">
      <h2 id="approval-link-h" ref={heading} tabIndex={-1}>
        {t("approvalLink.title")}
      </h2>
      {look.status === "checking" && <p role="status">{t("approvalLink.checking")}</p>}
      {look.status === "missing" && <p role="status">{t("approvalLink.notFound")}</p>}
      {look.status === "unreachable" && <p role="alert">{t("approvalLink.unreachable")}</p>}
      {look.status === "found" && (
        <>
          <p className="muted small">{t("approvalLink.note")}</p>
          {look.list === "agent" ? (
            <AgentApprovals filter={(a) => a.id === look.id} />
          ) : (
            <Approvals filter={(c) => c.id === look.id} />
          )}
        </>
      )}
    </section>
  );
}
