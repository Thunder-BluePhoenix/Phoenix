// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamSettingsSection } from "../src/components/TeamSettings";
import type { TeamLink, TeamStatus } from "../src/core/team";
import {
  createInvite,
  INVITE_MAX_CHARS,
  INVITE_VERSION_PREFIX,
  keyFingerprint,
  parseInvite,
  type InviteRefusal,
} from "../src/core/team-invite";
import { mountWith } from "./ai-fixtures";
import type { FakeApi } from "./fake-api";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

const bytesToB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const b64ToBytes = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const utf8 = (text: string) => new TextEncoder().encode(text);
const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** SHA-256 written out here, so the app's Web Crypto digest is checked against an independent one. */
function sha256(message: Uint8Array): Uint8Array {
  const k = new Uint32Array(64);
  for (let i = 2, n = 0; n < 64; i += 1) {
    let prime = true;
    for (let d = 2; d * d <= i; d += 1) if (i % d === 0) prime = false;
    if (prime) {
      k[n] = Math.floor((i ** (1 / 3) % 1) * 2 ** 32);
      n += 1;
    }
  }
  const h = new Uint32Array(8);
  for (let i = 2, n = 0; n < 8; i += 1) {
    let prime = true;
    for (let d = 2; d * d <= i; d += 1) if (i % d === 0) prime = false;
    if (prime) {
      h[n] = Math.floor((i ** (1 / 2) % 1) * 2 ** 32);
      n += 1;
    }
  }
  const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((message.length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (message.length * 8) >>> 0);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i += 1) {
      const t1 =
        (hh! +
          (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) +
          ((e! & f!) ^ (~e! & g!)) +
          k[i]! +
          w[i]!) >>>
        0;
      const t2 =
        ((rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d! + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i]! + v!) >>> 0));
  }
  const out = new Uint8Array(32);
  h.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
  return out;
}

/** A real key pair made at test time, like Core's; its private half never reaches the code under test. */
async function identity(namedCurve: "P-256" | "P-384" = "P-256") {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve }, true, [
    "sign",
    "verify",
  ]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: bytesToB64(spki), privateDer: bytesToB64(pkcs8), privateScalar: jwk.d ?? "" };
}

const me = await identity();
const teammate = await identity();
const ME = { id: "tm_0123456789ab", public_key: me.publicKey };
const MATE = { id: "tm_abcdefabcdef", public_key: teammate.publicKey };

const b64url = (data: string | Uint8Array) =>
  bytesToB64(typeof data === "string" ? utf8(data) : data)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (text: string) =>
  new TextDecoder().decode(b64ToBytes(text.replace(/-/g, "+").replace(/_/g, "/")));
const checksum = (signed: string) => toHex(sha256(utf8(signed))).slice(0, 8);
/** An invite with a correct checksum around any payload, to test what the parser does after the checksum. */
const sealed = (payload: string | Uint8Array) => {
  const signed = `${INVITE_VERSION_PREFIX}${b64url(payload)}`;
  return `${signed}.${checksum(signed)}`;
};
const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id: MATE.id, public_key: MATE.public_key, ...extra });

/** The same grouping as the app, from an independent SHA-256: first 16 bytes, 8 groups of 4 hex digits. */
const expectedFingerprint = (publicKey: string) =>
  toHex(sha256(b64ToBytes(publicKey)))
    .slice(0, 32)
    .match(/.{4}/g)!
    .join(" ");

describe("team invite codec", () => {
  it("round-trips an invite with and without a name, in the documented compact shape", async () => {
    const plain = await createInvite({ id: MATE.id, publicKey: MATE.public_key });
    expect(plain).toMatch(/^phoenix-team:v1:[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
    expect(await parseInvite(plain)).toEqual({
      ok: true,
      invite: { id: MATE.id, publicKey: MATE.public_key, label: null },
    });
    const named = await createInvite({ id: MATE.id, publicKey: MATE.public_key, label: "Ada" });
    expect(await parseInvite(`  ${named}\n`)).toEqual({
      ok: true,
      invite: { id: MATE.id, publicKey: MATE.public_key, label: "Ada" },
    });
    expect(named.length).toBeLessThan(INVITE_MAX_CHARS);
    // The payload is exactly the three public fields.
    const payload = named.slice(INVITE_VERSION_PREFIX.length, named.lastIndexOf("."));
    expect(JSON.parse(fromB64url(payload))).toEqual({
      id: MATE.id,
      public_key: MATE.public_key,
      label: "Ada",
    });
  });

  it("cleans the name it puts in an invite and keeps it within 40 characters", async () => {
    const invite = await createInvite({
      id: MATE.id,
      publicKey: MATE.public_key,
      label: `  A\u202Eb\u200Bc\n\td  ${"x".repeat(60)}`,
    });
    const parsed = await parseInvite(invite);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.invite.label).toBe(`Abcd ${"x".repeat(35)}`);
    expect(parsed.invite.label).toHaveLength(40);
    const unnamed = await createInvite({
      id: MATE.id,
      publicKey: MATE.public_key,
      label: " \u202E ",
    });
    const unnamedPayload = unnamed.slice(INVITE_VERSION_PREFIX.length, unnamed.lastIndexOf("."));
    expect(JSON.parse(fromB64url(unnamedPayload))).toEqual({
      id: MATE.id,
      public_key: MATE.public_key,
    });
  });

  it("refuses to make an invite from an id or key Core would refuse", async () => {
    await expect(createInvite({ id: "tm_nothex", publicKey: MATE.public_key })).rejects.toThrow();
    await expect(
      createInvite({ id: MATE.id, publicKey: ["c2VsZi1w", "dWJsaWMt", "a2V5"].join("") }),
    ).rejects.toThrow();
  });

  it("catches a flipped character anywhere in the payload or the checksum", async () => {
    const invite = await createInvite({ id: MATE.id, publicKey: MATE.public_key, label: "Ada" });
    const start = INVITE_VERSION_PREFIX.length;
    for (let i = start; i < invite.length; i += 1) {
      if (invite[i] === ".") continue;
      const inChecksum = i > invite.lastIndexOf(".");
      const swap = inChecksum ? (invite[i] === "0" ? "1" : "0") : invite[i] === "A" ? "B" : "A";
      const damaged = invite.slice(0, i) + swap + invite.slice(i + 1);
      expect(await parseInvite(damaged), `position ${i}`).toEqual({
        ok: false,
        refusal: "checksum",
      });
    }
  });

  it("refuses everything else strictly", async () => {
    const cases: [string, string, InviteRefusal][] = [
      ["empty", "", "empty"],
      ["blank", "  \n ", "empty"],
      ["no prefix", "hello", "format"],
      ["bare payload", sealed(body()).slice(INVITE_VERSION_PREFIX.length), "format"],
      ["other scheme", sealed(body()).replace("phoenix-team", "phoenix-other"), "format"],
      ["no version", sealed(body()).replace("v1:", ""), "format"],
      ["future version", sealed(body()).replace("v1:", "v2:"), "version"],
      ["version zero", sealed(body()).replace("v1:", "v0:"), "version"],
      ["no checksum", sealed(body()).split(".")[0]!, "format"],
      ["short checksum", sealed(body()).slice(0, -2), "format"],
      [
        "upper-case checksum",
        sealed(body()).toUpperCase().replace("PHOENIX-TEAM:V1:", INVITE_VERSION_PREFIX),
        "format",
      ],
      ["padded payload", `${INVITE_VERSION_PREFIX}${b64url(body())}=.00000000`, "format"],
      ["space inside", sealed(body()).replace("phoenix-team:", "phoenix-team: "), "format"],
      ["not json", sealed("not json"), "content"],
      ["json array", sealed("[]"), "content"],
      ["json null", sealed("null"), "content"],
      ["json string", sealed('"x"'), "content"],
      ["invalid utf-8", sealed(new Uint8Array([0x7b, 0xff, 0x7d])), "content"],
      ["extra field", sealed(body({ admin: true })), "content"],
      ["missing key", sealed(JSON.stringify({ id: MATE.id })), "content"],
      ["missing id", sealed(JSON.stringify({ public_key: MATE.public_key })), "content"],
      ["private key field", sealed(body({ private_key: "x" })), "content"],
      [
        "other key order",
        sealed(JSON.stringify({ public_key: MATE.public_key, id: MATE.id })),
        "content",
      ],
      [
        "spaced json",
        sealed(JSON.stringify({ id: MATE.id, public_key: MATE.public_key }, null, 1)),
        "content",
      ],
      [
        "duplicate keys",
        sealed(`{"id":"${MATE.id}","id":"${ME.id}","public_key":"${MATE.public_key}"}`),
        "content",
      ],
      ["escaped json", sealed(body().replace("tm_", "\\u0074m_")), "content"],
      ["id wrong prefix", sealed(body({ id: "xx_abcdefabcdef" })), "id"],
      [
        "id upper case",
        sealed(JSON.stringify({ id: "tm_ABCDEFABCDEF", public_key: MATE.public_key })),
        "id",
      ],
      ["id too short", sealed(JSON.stringify({ id: "tm_abc", public_key: MATE.public_key })), "id"],
      ["id a number", sealed(JSON.stringify({ id: 5, public_key: MATE.public_key })), "id"],
      ["key not base64", sealed(JSON.stringify({ id: MATE.id, public_key: "!!!" })), "key"],
      ["key not a key", sealed(JSON.stringify({ id: MATE.id, public_key: "bm90LWEta2V5" })), "key"],
      ["key a number", sealed(JSON.stringify({ id: MATE.id, public_key: 7 })), "key"],
      [
        "key on another curve",
        sealed(JSON.stringify({ id: MATE.id, public_key: (await identity("P-384")).publicKey })),
        "key",
      ],
      [
        "key with trailing junk",
        sealed(JSON.stringify({ id: MATE.id, public_key: `${MATE.public_key}AAAA` })),
        "key",
      ],
      ["key too long", sealed(JSON.stringify({ id: MATE.id, public_key: "A".repeat(300) })), "key"],
      ["empty name", sealed(body({ label: "" })), "label"],
      ["41-character name", sealed(body({ label: "x".repeat(41) })), "label"],
      ["name with bidi override", sealed(body({ label: "ab\u202Ecd" })), "label"],
      ["name with a newline", sealed(body({ label: "ab\ncd" })), "label"],
      ["name a number", sealed(body({ label: 5 })), "label"],
      ["name null", sealed(body({ label: null })), "label"],
      ["oversize", `${INVITE_VERSION_PREFIX}${"A".repeat(INVITE_MAX_CHARS)}.00000000`, "too_long"],
    ];
    const bad = [];
    for (const [name, text, refusal] of cases) {
      const got = await parseInvite(text);
      if (got.ok || got.refusal !== refusal) bad.push([name, got]);
    }
    expect(bad).toEqual([]);
  });

  it("makes a stable fingerprint that is the grouped SHA-256 of the key bytes", async () => {
    const first = await keyFingerprint(MATE.public_key);
    expect(first).toBe(await keyFingerprint(MATE.public_key));
    expect(first).toBe(expectedFingerprint(MATE.public_key));
    expect(first).toMatch(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/);
    expect(await keyFingerprint(ME.public_key)).not.toBe(first);
    expect(await keyFingerprint("not base64!")).toBeNull();
  });

  it("carries no private key material", async () => {
    const invite = await createInvite({ id: ME.id, publicKey: me.publicKey, label: "Me" });
    const text = [invite, fromB64url(invite.split(":")[2]!.split(".")[0]!)];
    const scalarStd = me.privateScalar.replace(/-/g, "+").replace(/_/g, "/");
    for (const haystack of text) {
      expect(haystack).not.toContain("PRIVATE");
      expect(haystack.length).toBeGreaterThan(0);
      expect(haystack).not.toContain(me.privateDer);
      expect(haystack).not.toContain(scalarStd);
      expect(haystack).not.toContain(me.privateScalar);
    }
  });
});

const OFF_STATUS: TeamStatus = {
  sharing: {
    enabled: false,
    consent: { deploying: false, agent_run: false, meeting: false },
    outgoing: { sharing: false, items: [] },
  },
  members: [{ id: "tm_aaaaaaaaaaaa", label: "Ada" }],
  presence: { members: [], counts: { deploying: 0, agent_run: 0, meeting: 0 } },
};
const ON: TeamLink = {
  enabled: true,
  connected: true,
  url: "https://relay.example.com",
  route: "a".repeat(32),
  self: ME,
  last_error: null,
};

/** A fake Core that records the add and puts the teammate on the roster, like Core does. */
function open(extra: Parameters<typeof mountWith>[1] = {}) {
  const world = { status: OFF_STATUS };
  return {
    world,
    ...mountWith(<TeamSettingsSection />, {
      "GET /api/team/link": () => ON,
      "GET /api/team/status": () => world.status,
      "POST /api/team/members": (sent) => {
        const added = sent as { id: string; label: string };
        world.status = {
          ...world.status,
          members: [...world.status.members, { id: added.id, label: added.label }],
        };
        return world.status;
      },
      ...extra,
    }),
  };
}

const writes = (api: FakeApi) => api.calls.filter((c) => c.method !== "GET");

async function part(name: string) {
  const heading = await screen.findByRole("heading", { name });
  return within(heading.parentElement!);
}

const paste = async (text: string) => {
  const add = await part("Add a teammate");
  fireEvent.change(add.getByLabelText("Paste a teammate's invite"), { target: { value: text } });
  return add;
};

const CONFIRM =
  "I compared this fingerprint with my teammate by voice or in another chat, and it matches.";

describe("team invite in Settings", () => {
  it("shows one invite for my identity with a fingerprint, and copies exactly that invite", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { api, container } = open();
    const share = await part("Share my identity");
    const box = (await share.findByLabelText("Your invite")) as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    expect(await parseInvite(box.value)).toEqual({
      ok: true,
      invite: { id: ME.id, publicKey: me.publicKey, label: null },
    });
    await waitFor(() =>
      expect((share.getByLabelText("Key fingerprint") as HTMLInputElement).value).toBe(
        expectedFingerprint(me.publicKey),
      ),
    );
    expect(share.getByText(/does not prove who made the invite/)).toBeTruthy();

    fireEvent.change(share.getByLabelText("Name to put in the invite (optional)"), {
      target: { value: "Ana" },
    });
    await waitFor(async () =>
      expect(
        await parseInvite((share.getByLabelText("Your invite") as HTMLTextAreaElement).value),
      ).toMatchObject({
        ok: true,
        invite: { label: "Ana" },
      }),
    );
    fireEvent.click(share.getByRole("button", { name: "Copy invite" }));
    await share.findByText("Invite copied to the clipboard.");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      (share.getByLabelText("Your invite") as HTMLTextAreaElement).value,
    );

    // Sharing reads only public values and sends nothing to Core.
    expect(writes(api)).toEqual([]);
    const shown = [...container.querySelectorAll("input,textarea")]
      .map((el) => (el as HTMLInputElement).value)
      .join("\n");
    const scalarStd = me.privateScalar.replace(/-/g, "+").replace(/_/g, "/");
    for (const haystack of [shown, container.textContent ?? ""]) {
      expect(haystack).not.toContain(scalarStd);
      expect(haystack).not.toContain(me.privateScalar);
    }
  });

  it("offers neither the invite nor the form to share before the team has an identity", async () => {
    mountWith(<TeamSettingsSection />, {
      "GET /api/team/link": () => ({ ...ON, enabled: false, connected: false, self: null }),
    });
    await screen.findByRole("heading", { name: "Team presence" });
    expect(screen.queryByRole("heading", { name: "Share my identity" })).toBeNull();
  });

  it("shows the label and fingerprint, and asks for a comparison before sending anything", async () => {
    const { api } = open();
    const invite = await createInvite({ id: MATE.id, publicKey: MATE.public_key, label: "Linus" });
    const add = await paste(invite);

    await waitFor(() =>
      expect((add.getByLabelText("Key fingerprint") as HTMLInputElement).value).toBe(
        expectedFingerprint(MATE.public_key),
      ),
    );
    expect((add.getByLabelText("Teammate's team id") as HTMLInputElement).value).toBe(MATE.id);
    expect((add.getByLabelText("Name to show") as HTMLInputElement).value).toBe("Linus");
    expect(add.getByText("The invite says the name is: Linus")).toBeTruthy();

    const button = add.getByRole("button", { name: "Add teammate" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(writes(api)).toEqual([]);

    const box = add.getByRole("checkbox", { name: CONFIRM }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(writes(api)).toEqual([]);

    fireEvent.click(button);
    await screen.findByRole("button", { name: "Remove Linus" });
    expect(writes(api)).toEqual([
      {
        method: "POST",
        path: "/api/team/members",
        body: { id: MATE.id, label: "Linus", public_key: MATE.public_key },
      },
    ]);
    // The form is cleared once the teammate is on the roster.
    expect((add.getByLabelText("Paste a teammate's invite") as HTMLTextAreaElement).value).toBe("");
  });

  it("sends the name the person chose when the invite has none, and needs one", async () => {
    const { api } = open();
    const add = await paste(await createInvite({ id: MATE.id, publicKey: MATE.public_key }));
    await add.findByText("The invite has no name; type one to show.");
    fireEvent.click(add.getByRole("checkbox", { name: CONFIRM }));
    const button = add.getByRole("button", { name: "Add teammate" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(add.getByLabelText("Name to show"), { target: { value: "  Grace  " } });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await screen.findByRole("button", { name: "Remove Grace" });
    expect(writes(api)).toEqual([
      {
        method: "POST",
        path: "/api/team/members",
        body: { id: MATE.id, label: "Grace", public_key: MATE.public_key },
      },
    ]);
  });

  it("forgets the comparison when the pasted invite changes", async () => {
    open();
    const first = await createInvite({ id: MATE.id, publicKey: MATE.public_key, label: "Linus" });
    const other = await identity();
    const second = await createInvite({
      id: "tm_121212121212",
      publicKey: other.publicKey,
      label: "Eve",
    });
    const add = await paste(first);
    fireEvent.click(await add.findByRole("checkbox", { name: CONFIRM }));
    fireEvent.change(add.getByLabelText("Paste a teammate's invite"), {
      target: { value: second },
    });
    const box = (await add.findByRole("checkbox", { name: CONFIRM })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect((add.getByRole("button", { name: "Add teammate" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await waitFor(() =>
      expect((add.getByLabelText("Key fingerprint") as HTMLInputElement).value).toBe(
        expectedFingerprint(other.publicKey),
      ),
    );
  });

  it("refuses my own identity, by id or by key, and a teammate already on the roster", async () => {
    const { api } = open();
    let add = await paste(
      await createInvite({ id: ME.id, publicKey: MATE.public_key, label: "Me" }),
    );
    await add.findByText("That invite is your own identity.");
    add = await paste(await createInvite({ id: "tm_999999999999", publicKey: me.publicKey }));
    await add.findByText("That invite is your own identity.");
    expect(add.queryByRole("checkbox")).toBeNull();
    expect((add.getByRole("button", { name: "Add teammate" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    add = await paste(
      await createInvite({ id: "tm_aaaaaaaaaaaa", publicKey: MATE.public_key, label: "Ada" }),
    );
    await add.findByText(
      "That teammate is already on your list. Remove them first to change their key.",
    );
    expect(add.queryByRole("checkbox")).toBeNull();
    expect(writes(api)).toEqual([]);
  });

  it("explains each way an invite can be refused, and sends nothing", async () => {
    const { api } = open();
    const good = await createInvite({ id: MATE.id, publicKey: MATE.public_key, label: "Linus" });
    const flipped = good.slice(0, 40) + (good[40] === "A" ? "B" : "A") + good.slice(41);
    const table: [string, string][] = [
      ["not an invite", "That is not a Phoenix team invite."],
      [
        good.replace("v1:", "v9:"),
        "This invite is from a different version of Phoenix that this one cannot read.",
      ],
      [
        flipped,
        "The invite was changed or copied incorrectly. Ask your teammate to send it again.",
      ],
      [sealed(body({ extra: 1 })), "The invite is damaged or has unexpected contents."],
      [
        sealed(JSON.stringify({ id: "tm_x", public_key: MATE.public_key })),
        "The invite has an invalid team id.",
      ],
      [
        sealed(JSON.stringify({ id: MATE.id, public_key: "AAAA" })),
        "The invite has an invalid public key.",
      ],
      [sealed(body({ label: "a\u202Eb" })), "The invite has an invalid name."],
      [
        `${INVITE_VERSION_PREFIX}${"A".repeat(INVITE_MAX_CHARS)}.00000000`,
        "That is too long to be a team invite.",
      ],
    ];
    for (const [text, message] of table) {
      const add = await paste(text);
      const alert = await add.findByText(message);
      expect(alert.getAttribute("role")).toBe("alert");
      expect(add.queryByRole("checkbox")).toBeNull();
      expect(
        (add.getByRole("button", { name: "Add teammate" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    expect(writes(api)).toEqual([]);
  });

  it("shows Core's refusal and keeps the invite so the person can retry", async () => {
    const { api } = open({
      "POST /api/team/members": () =>
        new Response(
          JSON.stringify({ code: "BAD_REQUEST", message: "Turn the team link on first" }),
          {
            status: 400,
          },
        ),
    });
    const add = await paste(
      await createInvite({ id: MATE.id, publicKey: MATE.public_key, label: "Linus" }),
    );
    fireEvent.click(await add.findByRole("checkbox", { name: CONFIRM }));
    fireEvent.click(add.getByRole("button", { name: "Add teammate" }));
    expect((await add.findByText("Turn the team link on first")).getAttribute("role")).toBe(
      "alert",
    );
    expect(
      (add.getByLabelText("Paste a teammate's invite") as HTMLTextAreaElement).value,
    ).toContain("phoenix-team:v1:");
    expect(writes(api)).toHaveLength(1);
  });

  it("renders a hostile name as inert text", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const { api, container } = open();
    const add = await paste(
      await createInvite({ id: MATE.id, publicKey: MATE.public_key, label: hostile }),
    );
    await add.findByText(`The invite says the name is: ${hostile}`);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect((add.getByLabelText("Name to show") as HTMLInputElement).value).toBe(hostile);
    fireEvent.click(add.getByRole("checkbox", { name: CONFIRM }));
    fireEvent.click(add.getByRole("button", { name: "Add teammate" }));
    await screen.findByRole("button", { name: `Remove ${hostile}` });
    expect(container.querySelector("img")).toBeNull();
    expect(writes(api)[0]?.body).toEqual({
      id: MATE.id,
      label: hostile,
      public_key: MATE.public_key,
    });
  });
});
