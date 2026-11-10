// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { pageNotes as enPageNotes } from "../../en/page-notes";

/** Machine-translated; unreviewed (see ../../README.md). */
export const pageNotes: Record<keyof typeof enPageNotes, string> = {
  "pageNotes.title": "Halaman yang dikirim dari browser Anda",
  "pageNotes.intro":
    "Halaman yang Anda pilih untuk dikirim dengan ekstensi browser Phoenix. Alamat, judul, dan teks terpilih ditulis oleh situs web, jadi ditampilkan sebagai teks biasa. Phoenix tidak membuka, membaca, atau mengirimnya ke AI; hapus yang tidak ingin Anda simpan.",
  "pageNotes.loading": "Memuat halaman…",
  "pageNotes.loadFailed": "Daftar halaman tidak dapat dimuat.",
  "pageNotes.empty": "Belum ada halaman yang dikirim.",
  "pageNotes.list": "Halaman yang dikirim dari browser Anda",
  "pageNotes.untitled": "(tanpa judul)",
  "pageNotes.received": "Diterima {time}",
  "pageNotes.selection": "Teks terpilih",
  "pageNotes.delete": "Hapus",
  "pageNotes.deleteLabel": "Hapus halaman {title}",
};
