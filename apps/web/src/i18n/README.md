# Phoenix interface languages

**All non-English text in this folder is machine-generated and needs native-speaker review before
release.** English is the source text; every other language was produced by machine translation and
has not been read by a person who speaks it. Do not describe any of them as "supported" or
"translated" in release notes until its status below changes.

| Code | Language (native name) | Direction | Review status |
| ---- | ---------------------- | --------- | ------------- |
| en   | English                | ltr       | source text   |
| zh   | 中文                   | ltr       | unreviewed    |
| hi   | हिन्दी                 | ltr       | unreviewed    |
| es   | Español                | ltr       | unreviewed    |
| ar   | العربية                | rtl       | unreviewed    |
| fr   | Français               | ltr       | unreviewed    |
| bn   | বাংলা                  | ltr       | unreviewed    |
| pt   | Português              | ltr       | unreviewed    |
| ru   | Русский                | ltr       | unreviewed    |
| id   | Bahasa Indonesia       | ltr       | unreviewed    |

When a reviewer signs a language off, change its row to `reviewed (name, date)`.

## Layout

- `en/<namespace>.ts` — one file per namespace, each `export const <namespace> = { "<namespace>.<dotted.key>": "English text", ... } as const`. `en/index.ts` merges them into `en`; `MessageKey = keyof typeof en`.
- `locales/<code>/<namespace>.ts` — the same namespace in one language, typed `Record<keyof typeof enNamespace, string>`, so a **missing or misspelt key is a compile error**. `locales/<code>/index.ts` merges the namespaces and default-exports them.
- `supported.ts` — the ten codes, native names, writing direction (`rtl` for `ar` only).
- `icu.ts` — the message format: `{name}` and `{count, plural, zero {..} one {..} two {..} few {..} many {..} other {..}}` (also `=0 {..}` and `#`). Variable values are never re-parsed.
- `store.ts` / `I18nProvider.tsx` — the active language, lazy loading (each language is its own chunk; English is bundled) and per-key fallback to English.
- `pseudo.ts` — the pseudo-locale `en-XA` (accented, +30% length, bracketed). Dev and test builds only; not in the picker, not accepted from Core.

## Using it

```tsx
const t = useT();
t("common.button.save");
t("shell.language.available", { count: 10 });
t.rich("shell.app.noToken", { command: <code>pnpm dev:core</code> });
```

Add a message: add the key to `en/<namespace>.ts`, then to the same file of **all nine** other
locales (TypeScript fails until you do), and replace the hard-coded string in the component.
`apps/web/test/i18n-coverage.test.ts` fails on any hard-coded text in a component that is not in
the allow-list (`apps/web/test/i18n-allowlist.json`, each entry with a reason).
