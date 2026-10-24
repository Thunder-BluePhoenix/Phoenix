// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useState } from "react";
import { useAction } from "../core/hooks";
import { TEAM_MEMBERS_PATH, type TeamMember, type TeamStatus } from "../core/team";
import {
  INVITE_LABEL_MAX,
  cleanInviteLabel,
  createInvite,
  keyFingerprint,
  parseInvite,
  type InviteRefusal,
  type TeamInvite,
} from "../core/team-invite";
import { useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

const REFUSAL: Record<InviteRefusal, MessageKey> = {
  empty: "teamInvite.refusal.empty",
  too_long: "teamInvite.refusal.tooLong",
  format: "teamInvite.refusal.format",
  version: "teamInvite.refusal.version",
  checksum: "teamInvite.refusal.checksum",
  content: "teamInvite.refusal.content",
  id: "teamInvite.refusal.id",
  key: "teamInvite.refusal.key",
  label: "teamInvite.refusal.label",
  unsupported: "teamInvite.refusal.unsupported",
};

type Self = { id: string; public_key: string };

/** The fingerprint of a public key, computed once per key; null while it is being computed or when it cannot be. */
function useFingerprint(publicKey: string | null): string | null {
  const [shown, setShown] = useState<{ key: string; fingerprint: string | null } | null>(null);
  useEffect(() => {
    if (publicKey === null) return;
    let current = true;
    void keyFingerprint(publicKey)
      .catch(() => null)
      .then((fingerprint) => {
        if (current) setShown({ key: publicKey, fingerprint });
      });
    return () => {
      current = false;
    };
  }, [publicKey]);
  return shown !== null && shown.key === publicKey ? shown.fingerprint : null;
}

/** "Share my identity": one invite string and the key fingerprint to read out to the teammate. */
export function TeamInviteShare({ self }: { self: Self }) {
  const t = useT();
  const ids = useId();
  const [label, setLabel] = useState("");
  const [made, setMade] = useState<{ for: string; invite: string | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fingerprint = useFingerprint(self.public_key);
  const wanted = `${self.id}|${self.public_key}|${label}`;

  useEffect(() => {
    let current = true;
    void createInvite({ id: self.id, publicKey: self.public_key, label })
      .catch(() => null)
      .then((invite) => {
        if (current) setMade({ for: wanted, invite });
      });
    return () => {
      current = false;
    };
  }, [self.id, self.public_key, label, wanted]);

  const invite = made !== null && made.for === wanted ? made.invite : null;
  const failed = made !== null && made.for === wanted && made.invite === null;

  const copy = async () => {
    if (invite === null) return;
    try {
      await navigator.clipboard.writeText(invite);
      setNote(t("teamInvite.share.copied"));
    } catch {
      setNote(t("teamInvite.share.copyFailed"));
    }
  };

  return (
    <div>
      <h3>{t("teamInvite.share.title")}</h3>
      <p className="small">{t("teamInvite.share.intro")}</p>
      <label className="field" htmlFor={`${ids}-label`}>
        {t("teamInvite.share.label")}
        <input
          id={`${ids}-label`}
          type="text"
          maxLength={INVITE_LABEL_MAX}
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
            setNote(null);
          }}
        />
      </label>
      {failed && <Feedback error={t("teamInvite.share.invalid")} />}
      {invite !== null && (
        <>
          <label className="field" htmlFor={`${ids}-invite`}>
            {t("teamInvite.share.invite")}
            <textarea id={`${ids}-invite`} readOnly rows={4} value={invite} />
          </label>
          <div className="button-row wrap">
            <button type="button" className="btn" onClick={() => void copy()}>
              {t("teamInvite.share.copy")}
            </button>
          </div>
          <Feedback error={null} saved={note} />
        </>
      )}
      {fingerprint !== null && (
        <label className="field" htmlFor={`${ids}-fingerprint`}>
          {t("teamInvite.fingerprint")}
          <input id={`${ids}-fingerprint`} type="text" readOnly value={fingerprint} />
        </label>
      )}
      <p className="small">{t("teamInvite.share.fingerprintHint")}</p>
      <p className="small">{t("teamInvite.checksumNote")}</p>
    </div>
  );
}

type Checked =
  | { text: string; ok: true; invite: TeamInvite }
  | { text: string; ok: false; refusal: InviteRefusal };

/** "Add teammate": a pasted invite, its fingerprint and an explicit comparison before the add request. */
export function TeamInviteAdd({
  self,
  members,
  onStatus,
}: {
  self: Self | null;
  members: readonly TeamMember[];
  onStatus: (status: TeamStatus) => void;
}) {
  const t = useT();
  const ids = useId();
  const { run, busy, error } = useAction();
  const [pasted, setPasted] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let current = true;
    if (pasted.trim() === "") return;
    void parseInvite(pasted)
      .catch((): { ok: false; refusal: InviteRefusal } => ({ ok: false, refusal: "unsupported" }))
      .then((result) => {
        if (current) setChecked({ ...result, text: pasted });
      });
    return () => {
      current = false;
    };
  }, [pasted]);

  const current =
    checked !== null && checked.text === pasted && pasted.trim() !== "" ? checked : null;
  const invite = current?.ok ? current.invite : null;
  const fingerprint = useFingerprint(invite?.publicKey ?? null);

  let problem: MessageKey | null = null;
  if (current !== null && !current.ok) problem = REFUSAL[current.refusal];
  else if (
    invite !== null &&
    self !== null &&
    (invite.id === self.id || invite.publicKey === self.public_key)
  )
    problem = "teamInvite.refusal.own";
  else if (invite !== null && members.some((member) => member.id === invite.id))
    problem = "teamInvite.refusal.duplicate";

  const shownName = cleanInviteLabel(name ?? invite?.label ?? "");
  const ready =
    invite !== null && problem === null && fingerprint !== null && confirmed && shownName !== "";

  const change = (value: string) => {
    setPasted(value);
    setName(null);
    setConfirmed(false);
  };

  const add = async () => {
    if (!ready) return;
    const next = await run<TeamStatus>("POST", TEAM_MEMBERS_PATH, {
      id: invite.id,
      label: shownName,
      public_key: invite.publicKey,
    });
    if (next) {
      onStatus(next);
      change("");
    }
  };

  return (
    <div>
      <h3>{t("teamInvite.add.title")}</h3>
      <label className="field" htmlFor={`${ids}-paste`}>
        {t("teamInvite.add.paste")}
        <textarea
          id={`${ids}-paste`}
          rows={4}
          spellCheck={false}
          value={pasted}
          onChange={(event) => change(event.target.value)}
        />
      </label>
      {problem !== null && <Feedback error={t(problem)} />}
      {invite !== null && problem === null && fingerprint !== null && (
        <>
          <p className="small">{t("teamInvite.add.preview")}</p>
          <label className="field" htmlFor={`${ids}-id`}>
            {t("teamStatus.members.id")}
            <input id={`${ids}-id`} type="text" readOnly value={invite.id} />
          </label>
          <label className="field" htmlFor={`${ids}-fingerprint`}>
            {t("teamInvite.fingerprint")}
            <input id={`${ids}-fingerprint`} type="text" readOnly value={fingerprint} />
          </label>
          <label className="field" htmlFor={`${ids}-name`}>
            {t("teamStatus.members.label")}
            <input
              id={`${ids}-name`}
              type="text"
              maxLength={INVITE_LABEL_MAX}
              value={name ?? invite.label ?? ""}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <p className="small">
            {invite.label === null
              ? t("teamInvite.add.noLabel")
              : t("teamInvite.add.theirLabel", { label: invite.label })}
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            {t("teamInvite.add.confirm")}
          </label>
          <p className="small">{t("teamInvite.checksumNote")}</p>
        </>
      )}
      <div className="button-row wrap">
        <button type="button" className="btn" disabled={busy || !ready} onClick={() => void add()}>
          {t("teamStatus.members.add")}
        </button>
      </div>
      <Feedback error={error} />
    </div>
  );
}
