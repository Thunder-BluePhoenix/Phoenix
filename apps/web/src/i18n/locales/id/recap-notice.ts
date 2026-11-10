// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { recapNotice as enrecapNotice } from "../../en/recap-notice";

/** Machine-translated; unreviewed. */
export const recapNotice: Record<keyof typeof enrecapNotice, string> = {
  "recapNotice.title": "Pemberitahuan rekap mingguan",
  "recapNotice.intro":
    "Setiap Senin pukul 09:00 waktu setempat, tampilkan satu pemberitahuan di daftar notifikasi Phoenix sendiri berisi jumlah minggu lalu. Mati secara bawaan. Teksnya tetap dan hanya berisi angka (tanpa nama, jalur, atau judul), tidak memanggil model dan tidak membuat permintaan jaringan, serta dilewati selama jam tenang Proaktif, dalam mode tenang notifikasi, dan saat penghentian darurat. Paling banyak satu per minggu; jika Phoenix tidak berjalan pada hari Senin, pemberitahuan ditampilkan sekali lagi di minggu yang sama.",
  "recapNotice.enable": "Tampilkan pemberitahuan rekap mingguan pada hari Senin",
  "recapNotice.last": "Pemberitahuan terakhir untuk minggu {week}.",
  "recapNotice.never": "Belum ada pemberitahuan rekap mingguan yang ditampilkan.",
  "recapNotice.error": "Tidak dapat memuat atau menyimpan pengaturan pemberitahuan rekap mingguan.",
  "recapNotice.midweek": "Jika diaktifkan di tengah minggu, menunggu Senin berikutnya.",
};
