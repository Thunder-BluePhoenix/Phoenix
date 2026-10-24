// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { calendar as enCalendar } from "../../en/calendar";

/** Machine-translated; unreviewed. */
export const calendar: Record<keyof typeof enCalendar, string> = {
  "calendar.title": "Persiapan rapat",
  "calendar.disabled": "Kalender nonaktif. Aktifkan kalender untuk melihat rapat mendatang.",
  "calendar.empty": "Tidak ada rapat mendatang.",
  "calendar.loading": "Membaca rapat…",
  "calendar.error": "Kalender tidak dapat dibaca.",
  "calendar.refresh": "Perbarui rapat",
  "calendar.prep": "Persiapan",
  "calendar.decisions": "Keputusan sebelumnya",
  "calendar.actions": "Tugas terbuka",
  "calendar.noPrep": "Tidak ada keputusan ditinjau atau tugas terbuka yang relevan.",
  "calendar.notetaker": "Mulai pencatat",
  "calendar.notetakerInfo":
    "Perekaman hanya dimulai setelah Anda memilih memulai dan memberikan izin.",
  "calendar.freeze": "Pembekuan penerapan",
  "calendar.busy": "Acara pribadi",
  "calendar.source": "Dari {meeting}",
  "calendar.unconfigured":
    "Tidak ada penyedia kalender yang terhubung. Hubungkan Google, Microsoft, atau CalDAV untuk melihat rapat.",
  "calendar.unavailable":
    "Umpan kalender tidak tersedia. Rapat mendatang dan pembekuan deployment tidak dapat ditampilkan.",
  "calendar.stale":
    "Umpan kalender sudah usang. Rapat mendatang dan pembekuan deployment tidak dapat dipercaya sampai diperbarui.",
  "calendar.lastChecked": "Pembacaan berhasil terakhir: {time}",
  "calendar.prepIncomplete": "Persiapan belum lengkap untuk beberapa rapat.",
};
