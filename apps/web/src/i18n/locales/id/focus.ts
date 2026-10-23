// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { focus as enFocus } from "../../en/focus";

/** Machine-translated; unreviewed. */
export const focus: Record<keyof typeof enFocus, string> = {
  "focus.title": "Mode fokus",
  "focus.start": "Mulai fokus",
  "focus.stop": "Akhiri fokus",
  "focus.minutes": "Menit (kosongkan jika tanpa batas waktu)",
  "focus.remaining": "Menit tersisa: {count}",
  "focus.active": "Fokus aktif",
  "focus.inactive": "Fokus mati",
  "focus.held": "Notifikasi ditahan: {count}",
  "focus.osDnd": "Jangan Ganggu sistem aktif",
  "focus.osUnknown": "Status Jangan Ganggu tidak tersedia",
  "focus.refresh": "Perbarui status fokus sistem",
  "focus.pomodoro": "Mulai Pomodoro",
  "focus.systemUnavailable":
    "Jangan Ganggu sistem tidak tersedia; mode fokus hanya mengontrol notifikasi Phoenix.",
  "focus.screenshot.title": "Tangkapan layar ke isu",
  "focus.screenshot.capture": "Pilih area layar…",
  "focus.screenshot.permission": "Izin perekaman layar diperlukan.",
  "focus.screenshot.error": "Permintaan gagal: {error}",
  "focus.screenshot.box": "Kotak",
  "focus.screenshot.arrow": "Panah",
  "focus.screenshot.text": "Teks",
  "focus.screenshot.redact": "Tutup permanen",
  "focus.screenshot.annotationText": "Teks anotasi",
  "focus.screenshot.project": "Repositori atau proyek",
  "focus.screenshot.issueTitle": "Judul isu",
  "focus.screenshot.body": "Deskripsi isu",
  "focus.screenshot.preview": "Pratinjau draf",
  "focus.screenshot.create": "Minta persetujuan dan buat isu",
  "focus.screenshot.draft": "Draf isu (belum dibuat)",
  "focus.screenshot.attachment": "Tangkapan dilampirkan jika didukung",
  "focus.screenshot.noAttachment":
    "Pelacak ini tidak mendukung lampiran tangkapan layar; gambar tidak dikirim.",
  "focus.screenshot.created": "Isu dibuat: {url}",
  "focus.screenshot.declined": "Tidak disetujui; tidak ada yang dikirim.",
  "focus.screenshot.tracker": "Pelacak isu",
  "focus.screenshot.tracker.github": "GitHub",
  "focus.screenshot.tracker.linear": "Linear",
  "focus.screenshot.tracker.jira": "Jira",
  "focus.issueDraft.title": "Isu dari gambar yang Anda punya",
  "focus.issueDraft.intro":
    "Letakkan, tempel, atau pilih PNG atau JPEG yang sudah Anda punya, tulis isunya, dan periksa persis apa yang akan dikirim. Phoenix tidak menangkap layar Anda. Isu hanya dibuat di GitHub setelah Anda mengonfirmasi di sini dan sekali lagi di Persetujuan.",
  "focus.issueDraft.unavailable.capability":
    "Integrasi GitHub tidak aktif atau tidak dapat membuat isu, jadi tidak ada yang bisa dibuat.",
  "focus.issueDraft.unavailable.token":
    "Token tulis GitHub belum diatur untuk integrasi GitHub, jadi tidak ada yang bisa dibuat.",
  "focus.issueDraft.dropLabel": "Letakkan gambar untuk isu",
  "focus.issueDraft.dropHint": "Letakkan atau tempel PNG atau JPEG di sini, atau {choose}.",
  "focus.issueDraft.choose": "pilih gambar…",
  "focus.issueDraft.chooseLabel": "Pilih gambar untuk isu",
  "focus.issueDraft.imageAlt": "Gambar untuk isu: {name}",
  "focus.issueDraft.imageRemove": "Hapus gambar",
  "focus.issueDraft.oneImage": "Tambahkan satu gambar sekali waktu.",
  "focus.issueDraft.imageRequired": "Tambahkan gambar terlebih dahulu.",
  "focus.issueDraft.titleRequired": "Tulis judul untuk isu.",
  "focus.issueDraft.titleTooLong": "Judul dapat berisi paling banyak {max} karakter.",
  "focus.issueDraft.bodyTooLong": "Deskripsi dapat berisi paling banyak {max} karakter.",
  "focus.issueDraft.secretInTitle":
    "Judul tampaknya berisi kata sandi, kunci, atau token. Hapus; tidak ada yang dikirim.",
  "focus.issueDraft.secretInBody":
    "Deskripsi tampaknya berisi kata sandi, kunci, atau token. Hapus; tidak ada yang dikirim.",
  "focus.issueDraft.secretInBoth":
    "Judul dan deskripsi tampaknya berisi kata sandi, kunci, atau token. Hapus; tidak ada yang dikirim.",
  "focus.issueDraft.previewRepository": "Repositori: {repository}",
  "focus.issueDraft.previewTitle": "Judul: {title}",
  "focus.issueDraft.previewBody": "Deskripsi, persis seperti yang akan dikirim:",
  "focus.issueDraft.previewNoBody": "Tidak ada deskripsi yang akan dikirim.",
  "focus.issueDraft.imageLocal":
    "Gambar ({name}) TIDAK dikirim. Isu GitHub dibuat hanya dari teks; gambar tetap di perangkat ini dan tidak disimpan. Tambahkan sendiri ke isu jika Anda ingin gambar itu ada di sana.",
  "focus.issueDraft.approval":
    "Belum ada yang dibuat. Setelah Anda menekan tombol, Phoenix meminta persetujuan Anda di Persetujuan sebelum mengirim apa pun ke GitHub.",
  "focus.issueDraft.create": "Minta pembuatan isu",
  "focus.issueDraft.waiting": "Menunggu persetujuan Anda di Persetujuan…",
  "focus.issueDraft.denied": "Anda menolak; tidak ada yang dikirim ke GitHub.",
  "focus.issueDraft.blocked": "Penghentian darurat aktif; tidak ada yang dikirim ke GitHub.",
  "focus.issueDraft.timeout":
    "Permintaan tidak disetujui tepat waktu atau dibatalkan; tidak ada yang dikirim.",
  "focus.issueDraft.failed": "Isu tidak dapat dibuat: {message}",
};
