// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "Tangkap wilayah untuk isu",
  "screenRegion.intro":
    "Pilih Pilih area layar, konfirmasi di Persetujuan, lalu seret area yang diinginkan dengan pemilih sistem (Esc membatalkan). Hanya macOS. Gambar tetap di halaman ini dan tidak disimpan. Isu itu sendiri dibuat hanya berupa teks, setelah Anda menyetujuinya. Untuk Linear dan Jira, Anda lalu dapat melampirkan gambar yang sudah disamarkan ke isu itu dalam langkah terpisah dengan konfirmasinya sendiri; GitHub hanya teks.",
  "screenRegion.projectLabel":
    "Repositori GitHub (owner/name), ID tim Linear, atau kunci proyek Jira",
  "screenRegion.linearTeamInvalid":
    "ID tim Linear tampak seperti 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f; tidak ada yang dikirim.",
  "screenRegion.jiraProjectInvalid":
    "Kunci proyek Jira berupa huruf kapital, angka, atau garis bawah, misalnya PROJ; tidak ada yang dikirim.",
  "screenRegion.issuesUnavailable":
    "Kemampuan Pelacak isu nonaktif atau tidak memiliki perintah membuat dan melampirkan, jadi tidak ada yang dikirim. Aktifkan dulu.",
  "screenRegion.issuesNoWriteCredential":
    "Tidak ada kredensial tulis untuk {tracker} di Pelacak isu (kunci polling tidak pernah dipakai untuk menulis), jadi tidak ada yang dikirim.",
  "screenRegion.issueKeyInvalid": "Itu bukan kunci isu yang valid; tidak ada yang dikirim.",
  "focus.screenshot.textOnly":
    "Isu dibuat hanya dengan teks. Tangkapan layar bukan bagian darinya; untuk Linear dan Jira Anda dapat menawarkannya terpisah setelahnya.",
  "focus.screenshot.attach.title": "Lampirkan tangkapan layar (opsional)",
  "focus.screenshot.attach.intro":
    "Isu {key} di {tracker} dibuat tanpa gambar. Sekarang Anda dapat melampirkan tangkapan layar yang sudah disamarkan. Ini unggahan terpisah yang kembali meminta persetujuan Anda lewat Core. GitHub tidak pernah menerima gambar.",
  "focus.screenshot.attach.prepare": "Tampilkan yang akan dilampirkan",
  "focus.screenshot.attach.details": "Yang akan dilampirkan",
  "focus.screenshot.attach.tracker": "Layanan: {tracker}",
  "focus.screenshot.attach.issue": "Isu: {key}",
  "focus.screenshot.attach.file": "Nama berkas: {name}",
  "focus.screenshot.attach.size": "Ukuran: {bytes} byte",
  "focus.screenshot.attach.hash": "Hash isi (SHA-256, 12 karakter pertama): {hash}",
  "focus.screenshot.attach.redacted":
    "Ini gambar seperti yang disamarkan dan diberi anotasi di halaman ini; penyamaran sudah menyatu. Belum ada yang dikirim.",
  "focus.screenshot.attach.confirm": "Ya, unggah gambar ini ke {tracker}",
  "focus.screenshot.attach.send": "Minta persetujuan dan lampirkan",
  "focus.screenshot.attach.done": "Tangkapan layar dilampirkan ke {key}.",
  "focus.screenshot.attach.problem.badImage": "Gambar bukan PNG yang valid dan tidak dikirim.",
  "focus.screenshot.attach.problem.tooLarge": "Gambar lebih besar dari 5 MiB dan tidak dikirim.",
  "focus.screenshot.attach.problem.changed":
    "Gambar berubah setelah Anda meninjaunya; tinjau lagi. Tidak ada yang dikirim.",
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
};
