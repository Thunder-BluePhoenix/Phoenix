// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "Tangkap wilayah untuk isu",
  "screenRegion.intro":
    "Pilih Pilih wilayah layar, konfirmasi di Persetujuan, lalu seret area yang diinginkan dengan pemilih sistem (Esc membatalkan). Hanya macOS. Gambar tetap di halaman ini dan tidak disimpan; isu dibuat hanya sebagai teks, di GitHub, setelah Anda menyetujuinya lagi.",
  "screenRegion.unavailable":
    "Tangkapan wilayah nonaktif. Aktifkan kapabilitas Tangkapan wilayah layar dan izinkan tangkapan layar untuk menggunakannya. Hanya berfungsi di macOS.",
  "screenRegion.cancelled": "Anda membatalkan pemilihan, jadi tidak ada yang ditangkap.",
  "screenRegion.declined": "Anda menolak, jadi tidak ada yang ditangkap.",
  "screenRegion.blocked": "Penghentian darurat aktif, jadi tidak ada yang ditangkap.",
  "screenRegion.timeout":
    "Tidak ada wilayah yang dipilih tepat waktu atau permintaan tidak disetujui; tidak ada yang ditangkap.",
  "screenRegion.failed": "Wilayah tidak dapat ditangkap: {message}",
  "screenRegion.badImage": "Tangkapan bukan gambar PNG yang valid dan dibuang.",
  "screenRegion.tooLarge": "Wilayah yang ditangkap lebih dari 5 MiB dan dibuang.",
  "screenRegion.unsupported": "Tangkapan wilayah hanya didukung di macOS.",
  "screenRegion.expired": "Tangkapan tidak lagi tersedia. Pilih wilayah lagi.",
  "screenRegion.trackerUnsupported":
    "Hanya GitHub yang dapat membuat isu dari sini; Linear dan Jira belum bisa, jadi tidak ada yang dikirim.",
};
