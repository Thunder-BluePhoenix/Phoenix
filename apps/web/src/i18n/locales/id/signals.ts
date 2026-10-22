// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { signals as ensignals } from "../../en/signals";

/** Machine-translated; unreviewed. */
export const signals: Record<keyof typeof ensignals, string> = {
  "signals.title": "Sinyal rekayasa",
  "signals.intro":
    "Periksa peringatan dependensi, pengujian tidak stabil, tren durasi, dan perbedaan kunci konfigurasi di repositori pilihan Anda. Pembacaan tidak mengubah berkas.",
  "signals.root": "Folder repositori",
  "signals.add": "Pantau folder",
  "signals.remove": "Berhenti memantau",
  "signals.refresh": "Periksa sekarang",
  "signals.empty": "Tidak ada sinyal terkini di repositori yang dipantau.",
  "signals.unconfigured": "Pilih folder repositori untuk mulai memantau.",
  "signals.error": "Sinyal rekayasa tidak dapat dibaca.",
  "signals.advisory": "Peringatan dependensi",
  "signals.flaky_test": "Pengujian tidak stabil",
  "signals.duration_trend": "Durasi meningkat",
  "signals.config_drift": "Kunci konfigurasi hilang",
  "signals.optin":
    "Notifikasi proaktif memerlukan persetujuan tegas serta mengikuti jam tenang dan batas per jam.",
  "signals.privacy": "Hanya nama kunci yang dibandingkan; nilainya tidak pernah ditampilkan.",
  "signals.unknown.advisories":
    "Peringatan dependensi belum dievaluasi (status tidak diketahui, bukan bersih):",
  "signals.unknown.history":
    "Riwayat pengujian dan tren durasi belum dievaluasi (status tidak diketahui, bukan bersih):",
};
