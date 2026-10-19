// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "الصفحة الرئيسية لـ Phoenix",
  "shell.nav.main": "الرئيسية",
  "shell.nav.meetings": "الاجتماعات",
  "shell.nav.provenance": "المصدر والأصل",
  "shell.nav.agents": "الوكلاء",
  "shell.nav.workflows": "سير العمل",
  "shell.nav.recap": "الملخص",
  "shell.nav.settings": "الإعدادات",
  "shell.nav.recording": "يسجّل",
  "shell.app.skipToContent": "انتقل إلى المحتوى",
  "shell.app.tagline": "Phoenix هو المنصة. Fawkes هو الرفيق.",
  "shell.app.noToken": "ليس لهذه الصفحة رمز جلسة. افتح Phoenix من العنوان الذي يطبعه <code>pnpm dev:core</code>.",
  "shell.app.hint": "انقر على Fawkes في الشريط العلوي لترى ما يفعله Phoenix.",
  "shell.language.title": "اللغة",
  "shell.language.label": "لغة الواجهة",
  "shell.language.available": "{count, plural, zero {لا توجد لغات متاحة.} one {تتوفر لغة واحدة.} two {تتوفر لغتان.} few {تتوفر # لغات.} many {تتوفر # لغة.} other {تتوفر # لغة.}}",
  "shell.language.machineNote": "النصوص بغير الإنجليزية مترجمة آليًا ولم يراجعها ناطقون أصليون بعد.",
  "shell.language.saved": "تم تغيير اللغة.",
  "shell.language.failed": "تعذّر حفظ اللغة. حاول مرة أخرى.",
};
