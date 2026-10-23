// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { awakeSettings as enAwakeSettings } from "../../en/awake-settings";

/** Machine-translated; unreviewed. */
export const awakeSettings: Record<keyof typeof enAwakeSettings, string> = {
  "awakeSettings.title": "Tetap menyala",
  "awakeSettings.intro":
    "Mencegah komputer ini tidur selama waktu tertentu, misalnya saat build atau agen berjalan. Sesi selalu punya akhir: dari 1 menit sampai 7 hari.",
  "awakeSettings.approval":
    "Memulai, memperpanjang, dan mengakhiri sesi masing-masing meminta persetujuan Anda lebih dulu di Persetujuan. Tidak ada yang berubah sebelum Anda menyetujui.",
  "awakeSettings.off": "“Tetap menyala” dimatikan, jadi tidak ada sesi yang bisa dimulai.",
  "awakeSettings.enable": "Aktifkan Tetap menyala",
  "awakeSettings.status.title": "Sesi saat ini",
  "awakeSettings.status.idle": "Tidak ada sesi yang berjalan. Komputer tidur seperti biasa.",
  "awakeSettings.status.unreadable": "Status Tetap menyala tidak dapat dibaca.",
  "awakeSettings.status.mode.timed": "(berwaktu)",
  "awakeSettings.status.mode.agents_grace": "(selama agen bekerja)",
  "awakeSettings.status.label": "Label: {label}",
  "awakeSettings.end.button": "Akhiri sesi",
  "awakeSettings.start.title": "Mulai sesi",
  "awakeSettings.start.durations": "Durasi preset",
  "awakeSettings.start.minutes": "Menit",
  "awakeSettings.start.label": "Label (opsional)",
  "awakeSettings.start.labelInvalid":
    "Label harus 1 sampai {max} karakter, tanpa karakter kontrol atau karakter tak terlihat.",
  "awakeSettings.start.submit": "Minta mulai",
  "awakeSettings.outcome.waiting": "Menunggu persetujuan Anda di Persetujuan…",
  "awakeSettings.outcome.succeeded.start": "Disetujui: sesi telah dimulai.",
  "awakeSettings.outcome.succeeded.extend": "Disetujui: waktu ditambahkan ke sesi.",
  "awakeSettings.outcome.succeeded.end": "Disetujui: sesi telah berakhir.",
  "awakeSettings.outcome.denied": "Anda menolak, jadi tidak ada yang diubah.",
  "awakeSettings.outcome.blocked": "Penghentian darurat aktif, jadi tidak ada yang diubah.",
  "awakeSettings.outcome.timeout":
    "Permintaan tidak disetujui tepat waktu atau dibatalkan, jadi tidak ada yang diubah.",
  "awakeSettings.outcome.failed": "Tetap menyala tidak dapat melakukannya: {message}",
};
