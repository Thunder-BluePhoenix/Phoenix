// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Runs INSIDE the Linux container (see run-in-container.sh). Drives the production
// KeychainSecretStore("linux") (bundled by esbuild as store.cjs) against the real `secret-tool`.
// `secret-tool` is reached through a recording wrapper first in PATH (wrapper.sh) that logs argv,
// the wrapper's own /proc cmdline, the real process's /proc cmdline while it runs, and the exit code.
// Fake values are made at run time from random bytes; the output carries lengths and SHA-256
// prefixes only, never a value. Usage: node probe.cjs <session|nodbus|locked>
const { createHash, randomBytes } = require("node:crypto");
const { readFileSync, existsSync } = require("node:fs");
const { KeychainSecretStore, SecretTooLongError, secretRef } = require("./store.cjs");

const mode = process.argv[2] || "session";
const LOG = "/tmp/wlog.jsonl";
const sha = (t) => createHash("sha256").update(t).digest("hex").slice(0, 12);
const fp = (t) =>
  t === undefined ? null : { chars: t.length, bytes: Buffer.byteLength(t), sha256_prefix: sha(t) };
const hexValue = (n) =>
  randomBytes(Math.ceil(n / 2))
    .toString("hex")
    .slice(0, n);
const fake = (n) => `fake-${hexValue(n)}`.slice(0, n);
const OP_TIMEOUT_MS = mode === "locked" ? 25_000 : 60_000;

const store = new KeychainSecretStore("linux");
const secrets = [];
const entries = () =>
  existsSync(LOG)
    ? readFileSync(LOG, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const redact = (text, value) => (value ? String(text).split(value).join("<VALUE>") : String(text));

async function timed(fn) {
  const t0 = Date.now();
  let timer;
  const timeout = new Promise((r) => {
    timer = setTimeout(() => r({ timedOut: true }), OP_TIMEOUT_MS);
  });
  try {
    const out = await Promise.race([fn().then((v) => ({ value: v })), timeout]);
    return { ...out, ms: Date.now() - t0 };
  } catch (e) {
    return { error: e, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/** One store operation; returns a value-free record. */
async function op(name, ref, value) {
  const before = entries().length;
  const r = await timed(() =>
    name === "set" ? store.set(ref, value) : name === "get" ? store.get(ref) : store.delete(ref),
  );
  const calls = entries().slice(before);
  const rec = {
    op: name,
    ref,
    ms: r.ms,
    timedOut: r.timedOut === true,
    threw: r.error
      ? { type: r.error.constructor.name, message: redact(r.error.message, value) }
      : null,
    messageContainsValue: r.error && value ? r.error.message.includes(value) : false,
    tool_calls: calls.map((c) => ({ argv: c.argv.map((a) => redact(a, value)), exit: c.exit })),
  };
  if (name === "get" && "value" in r) rec.got = fp(r.value);
  if (value !== undefined) rec.input = fp(value);
  if (name === "get" && "value" in r && value !== undefined)
    rec.exact_roundtrip = r.value === value;
  return rec;
}

function argvLeakCheck(values) {
  const text = existsSync(LOG) ? readFileSync(LOG, "utf8") : "";
  // The log holds argv, the wrapper's /proc cmdline and the real process's /proc cmdline.
  return {
    values_checked: values.length,
    log_bytes: text.length,
    values_found_in_log: values.filter((v) => v.length >= 8 && text.includes(v)).length,
    real_process_cmdline_samples: entries().filter(
      (e) => e.real_cmdline && e.real_exe === "/usr/bin/secret-tool",
    ).length,
    sample_cmdlines: entries()
      .filter((e) => e.real_cmdline)
      .slice(0, 3)
      .map((e) => e.real_cmdline.replace(/\u0000/g, " ").slice(0, 200)),
  };
}

async function sessionRun(out) {
  // Ref format Core uses for provider keys.
  const refs = ["openai", "anthropic", "kc-local-abc123"].map((p) => secretRef(p));
  out.ref_format = { examples: refs, function: "core/runtime/src/ai.ts secretRef" };
  const ref0 = refs[0];

  out.roundtrip = [];
  const v0 = fake(40);
  secrets.push(v0);
  out.roundtrip.push(
    await op("set", ref0, v0),
    await op("get", ref0),
    await op("delete", ref0),
    await op("get", ref0),
  );
  const got = out.roundtrip[1].got;
  out.roundtrip_ok = got && got.sha256_prefix === sha(v0) && out.roundtrip[3].got === null;

  // Replace: set twice with different values, one item remains, get returns the second.
  const a = fake(30);
  const b = fake(31);
  secrets.push(a, b);
  await store.set(ref0, a);
  await store.set(ref0, b);
  out.replace = { get: fp(await store.get(ref0)), expected: fp(b) };
  await store.delete(ref0);

  const special = {
    double_quote: 'ab"cd"ef',
    single_quote: "ab'cd'ef",
    spaces: "  lead and  inner  trail  ",
    backslash: "a\\b\\\\c\\n\\t",
    dollar: "pre$HOME${PATH}$(id)`id`post",
    unicode: "p\u00e9\u00f1\u65e5\u672c\u8a9e\u{1f600}\u0434\u0430",
    mixed: `q"s'b\\d$ \u00e9-${fake(20)}`,
    tab_inside: "a\tb",
    cr_inside: "a\rb",
    percent_and_glob: "100%*?[x]",
    leading_dash: "--label=x -h",
    only_space: " ",
    one_char: "x",
  };
  out.special = [];
  for (const [name, value] of Object.entries(special)) {
    secrets.push(value);
    const ref = `phoenix.ai.probe-special-${name}_api_key`;
    const s = await op("set", ref, value);
    const g = await op("get", ref);
    await op("delete", ref);
    out.special.push({
      case: name,
      set_threw: s.threw,
      set_exit: s.tool_calls.map((c) => c.exit),
      get_exact_roundtrip: g.got
        ? g.got.sha256_prefix === sha(value) && g.got.bytes === Buffer.byteLength(value)
        : false,
      input: fp(value),
      got: g.got,
    });
  }

  out.sizes = [];
  for (const n of [
    64, 127, 128, 129, 200, 1000, 2000, 4093, 4094, 4096, 8192, 16384, 65536, 262144, 1048576,
  ]) {
    const v = fake(n);
    if (n <= 8192) secrets.push(v);
    const ref = `phoenix.ai.probe-size${n}_api_key`;
    const s = await op("set", ref, v);
    const g = await op("get", ref);
    await op("delete", ref);
    out.sizes.push({
      size: n,
      set_threw: s.threw,
      set_timedOut: s.timedOut,
      set_ms: s.ms,
      set_exit: s.tool_calls.map((c) => c.exit),
      get_len: g.got ? g.got.chars : null,
      exact_roundtrip: g.got ? g.got.sha256_prefix === sha(v) && g.got.chars === n : false,
    });
  }

  // Newline: production refuses before any tool call.
  const nl = `${fake(20)}\n${fake(20)}`;
  secrets.push(nl);
  out.newline = await op("set", "phoenix.ai.probe-newline_api_key", nl);
  out.newline.refused_before_tool = out.newline.tool_calls.length === 0;
  out.trailing_newline = await op("set", "phoenix.ai.probe-trailing_api_key", `${fake(20)}\n`);

  // Empty value.
  out.empty_value = {
    set: await op("set", "phoenix.ai.probe-empty_api_key", ""),
    get: await op("get", "phoenix.ai.probe-empty_api_key"),
  };
  out.empty_value.delete = await op("delete", "phoenix.ai.probe-empty_api_key");

  // Missing ref.
  out.missing = {
    get: await op("get", "phoenix.ai.probe-missing_api_key"),
    delete: await op("delete", "phoenix.ai.probe-missing_api_key"),
  };

  // A ref that is not simple text.
  const oddRef = 'phoenix.ai.odd ref "q" $x\u00e9_api_key';
  const ov = fake(24);
  secrets.push(ov);
  out.odd_ref = [await op("set", oddRef, ov), await op("get", oddRef), await op("delete", oddRef)];

  // Concurrent sets on distinct refs.
  const refsN = Array.from({ length: 8 }, (_, i) => `phoenix.ai.probe-par${i}_api_key`);
  const vals = refsN.map(() => fake(48));
  secrets.push(...vals);
  const t0 = Date.now();
  await Promise.all(refsN.map((r, i) => store.set(r, vals[i])));
  const got8 = await Promise.all(refsN.map((r) => store.get(r)));
  out.concurrent = { n: 8, ms: Date.now() - t0, all_exact: got8.every((g, i) => g === vals[i]) };
  await Promise.all(refsN.map((r) => store.delete(r)));

  out.argv_leak = argvLeakCheck(secrets.filter((v) => !v.includes("\n")));
}

async function failureRun(out) {
  const v = fake(48);
  secrets.push(v);
  const ref = secretRef("probe-nodbus");
  out.set = await op("set", ref, v);
  out.get = await op("get", ref);
  out.delete = await op("delete", ref);
  out.value_in_any_error = [out.set, out.get, out.delete].some((r) => r.messageContainsValue);
  out.argv_leak = argvLeakCheck(secrets);
}

(async () => {
  const out = { mode, node: process.version, tool_error_class: SecretTooLongError.name };
  try {
    if (mode === "session") await sessionRun(out);
    else await failureRun(out);
  } catch (e) {
    out.probe_error = redact(e && e.message, secrets[0]);
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
})();
