// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { handoff as enhandoff } from "../../en/handoff";

/** Machine-translated; unreviewed (see ../../README.md). */
export const handoff: Record<keyof typeof enhandoff, string> = {
  "handoff.title": "Catatan serah terima",
  "handoff.intro":
    "Catatan serah terima adalah ringkasan singkat yang disusun Phoenix dengan aturan tetap, tanpa model, dari apa yang dilaporkan agen pemrograman selama sesi: tujuan (hanya jika agen melaporkan judul tugas), berkas yang diubah beserta jumlah barisnya, perintah yang dijalankan (rahasia sudah dihapus), dan pertanyaan yang masih terbuka. Phoenix tidak memeriksa satu pun dari itu, jadi anggap sebagai apa yang dikatakan agen, bukan bukti. Catatan disimpan di komputer ini, di folder data Phoenix, hanya dapat dibaca oleh Anda; 50 catatan terbaru disimpan, dan “Hapus semua” untuk “handoff” di Privasi akan menghapusnya.",

  "handoff.settings.legend": "Pengaturan serah terima",
  "handoff.settings.auto": "Tulis catatan saat sesi agen berakhir",
  "handoff.settings.allowCloud":
    "Izinkan model cloud menulis ringkasan opsional (nonaktif: hanya model di perangkat ini)",
  "handoff.settings.cloudWarning":
    "Jika Anda mengaktifkannya, teks catatan (perintah yang sudah disamarkan dan nama berkas) dapat keluar dari komputer ini ke model cloud saat Anda meminta ringkasan. Izin cloud di pengaturan AI tetap berlaku di atas pilihan ini.",
  "handoff.settings.saved": "Pengaturan disimpan.",
  "handoff.settings.unavailable": "Pengaturan serah terima tidak dapat dimuat.",
  "handoff.notes.unavailable": "Catatan serah terima tidak dapat dimuat.",
  "handoff.guard.unavailable": "Hasil penjaga rahasia tidak dapat dimuat.",
  "handoff.notes.title": "Catatan tersimpan",
  "handoff.notes.listLabel": "Catatan serah terima",
  "handoff.notes.empty": "Belum ada catatan serah terima yang ditulis.",
  "handoff.notes.open": "{date} {time} · {agent}",
  "handoff.notes.meta": "{project} · {files} · {lines}",
  "handoff.notes.files": "{count, plural, other {# berkas}}",
  "handoff.notes.lines": "+{added} −{removed}",
  "handoff.notes.noProject": "tanpa proyek",
  "handoff.notes.hasSummary": "Ringkasan model",
  "handoff.notes.detailLabel": "Catatan terpilih",
  "handoff.notes.loading": "Memuat catatan…",
  "handoff.notes.trigger.auto": "Ditulis otomatis",
  "handoff.notes.trigger.user": "Atas permintaan Anda",
  "handoff.notes.textLabel": "Teks catatan",

  "handoff.summary.title": "Ringkasan model",
  "handoff.summary.processedBy": "Ditulis oleh: {by}",
  "handoff.summary.warning":
    "Sebuah model menulis ringkasan ini dan bisa saja keliru. Periksa dulu sebelum Anda mengandalkannya.",
  "handoff.summary.add": "Tambah ringkasan model",
  "handoff.summary.note":
    "Phoenix hanya memakai model di perangkat ini, kecuali Anda mengizinkan model cloud di atas.",
  "handoff.summary.added": "Ringkasan ditambahkan.",

  "handoff.delete.button": "Hapus catatan",
  "handoff.delete.done": "Catatan dihapus.",

  "handoff.generate.title": "Tulis catatan untuk sebuah sesi",
  "handoff.generate.sessionLabel": "Sesi",
  "handoff.generate.choose": "Pilih sesi",
  "handoff.generate.option": "{agent} · {repository} · {time}",
  "handoff.generate.none":
    "Belum ada sesi agen pemrograman yang diketahui, jadi tidak ada yang bisa dicatat.",
  "handoff.generate.button": "Tulis catatan",
  "handoff.generate.done": "Catatan ditulis.",

  "handoff.attach.title": "Gunakan catatan ini",
  "handoff.attach.targetLabel": "Tujuannya",
  "handoff.attach.target.commit_message": "Pesan commit",
  "handoff.attach.target.pr_description": "Deskripsi pull request",
  "handoff.attach.target.task": "Issue GitHub",
  "handoff.attach.repositoryLabel": "Repositori GitHub (owner/name)",
  "handoff.attach.repositoryInvalid": "Masukkan repositori sebagai owner/name, misalnya acme/app.",
  "handoff.attach.preview": "Pratinjau",
  "handoff.attach.previewAgain": "Pratinjau lagi",
  "handoff.attach.confirm": "Konfirmasi",
  "handoff.attach.previewLabel": "Pratinjau apa yang akan dilampirkan",
  "handoff.attach.issueTitle": "Judul issue: {title}",
  "handoff.attach.textLabel": "Persis teks ini",
  "handoff.attach.delivery.copy":
    "Phoenix tidak menulis ini ke mana pun: konfirmasi untuk menyalinnya, lalu tempel sendiri.",
  "handoff.attach.delivery.copyPr":
    "Phoenix belum punya perintah yang mengubah deskripsi pull request: hanya salin. Konfirmasi untuk menyalinnya, lalu tempel sendiri.",
  "handoff.attach.delivery.issue":
    "Phoenix akan membuat issue GitHub di {repository} dengan kapabilitas github. Anda akan diminta mengonfirmasi sekali lagi, dan token tulis diperlukan.",
  "handoff.attach.stale":
    "Catatan berubah setelah pratinjau ini, jadi tidak ada yang dilampirkan. Buat pratinjau lagi.",
  "handoff.attach.copied": "Disalin ke papan klip. Tempel di tempat yang Anda perlukan.",
  "handoff.attach.copyByHand":
    "Phoenix tidak dapat memakai papan klip. Pilih teks di bawah dan salin secara manual.",
  "handoff.attach.issueCreated": "Issue #{number} dibuat di {repository}.",
  "handoff.attach.issueExisting": "Issue #{number} di {repository} sudah ada.",
  "handoff.attach.issueAddress": "Alamat: {url}",

  "handoff.guard.title": "Penjaga rahasia",
  "handoff.guard.intro":
    "Penjaga rahasia dipasang bersama pemasang hook agen di atas: ini bagian dari hook yang ditambahkan Phoenix ke Claude Code dan Codex. Penjaga ini memblokir panggilan alat, git commit, atau git push yang input atau perubahan staging-nya berisi rahasia yang dikenali detektor Phoenix, dan memberi tahu agen jenis rahasia apa yang ditemukan dan di mana, tidak pernah rahasianya.",
  "handoff.guard.override":
    "Anda hanya dapat membatalkan satu blokir lewat kartu persetujuan; agen tidak dapat membatalkannya.",
  "handoff.guard.heuristic":
    "Detektor ini heuristik, bukan janji bahwa tidak ada yang bocor: rahasia yang tidak dikenalinya tidak akan tertangkap.",
  "handoff.guard.failOpen":
    "Jika Phoenix Core atau hook tidak dapat berjalan, pekerjaan agen tetap berlanjut (penjaga gagal terbuka), kecuali rahasia yang ditemukan selalu diblokir.",
  "handoff.guard.countsLabel": "Hasil penjaga rahasia",
  "handoff.guard.allowed": "Diizinkan setelah pemeriksaan: {count}",
  "handoff.guard.blocked": "Diblokir: {count}",
  "handoff.guard.overridden": "Diizinkan setelah Anda menyetujui: {count}",
  "handoff.guard.since": "Dihitung sejak {date} {time}",
  "handoff.guard.noResults": "Belum ada hasil.",
  "handoff.guard.recentLabel": "Hasil penjaga rahasia terbaru",
  "handoff.guard.row": "{date} {time} · {agent} · {tool}",
  "handoff.guard.outcome.blocked": "diblokir",
  "handoff.guard.outcome.overridden": "diizinkan setelah Anda menyetujui",
  "handoff.guard.finding": "{kind} di {location}",
};
