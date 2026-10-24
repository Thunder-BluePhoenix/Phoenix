// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { windowCapture as enWindowCapture } from "../../en/window-capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const windowCapture: Record<keyof typeof enWindowCapture, string> = {
  "windowCapture.heading": "Lampirkan jendela",
  "windowCapture.intro":
    "Phoenix dapat membaca teks satu jendela dan menampilkannya dulu kepada Anda di sini. Anda mengonfirmasi, lalu membawa jendela yang diinginkan ke depan; Phoenix membacanya satu kali (Aksesibilitas macOS, hanya di Mac ini). Tidak ada yang dilampirkan sampai Anda menerima teksnya.",
  "windowCapture.start": "Lampirkan jendela…",
  "windowCapture.waiting":
    "Menunggu konfirmasi Anda, lalu membaca jendela di depan. Bawa jendela yang diinginkan ke depan sekarang.",
  "windowCapture.stopWaiting": "Berhenti menunggu",
  "windowCapture.discarded": "Dibuang. Tidak ada yang dilampirkan.",
  "windowCapture.attached": "“{name}” dilampirkan. Ada di baki di atas.",
  "windowCapture.acceptFailed": "Tidak dilampirkan: {reason}",
  "windowCapture.result.notGranted":
    "macOS belum mengizinkan Phoenix membaca jendela. Aktifkan Phoenix di Pengaturan Sistem > Privasi & Keamanan > Aksesibilitas, lalu coba lagi. Phoenix tidak bertanya lagi dengan sendirinya.",
  "windowCapture.result.phoenixWindow":
    "Jendela di depan adalah Phoenix, jadi tidak ada yang dibaca. Bawa jendela lain ke depan dan coba lagi.",
  "windowCapture.result.noWindow":
    "Tidak ada jendela yang dapat dibaca di depan, jadi tidak ada yang dibaca.",
  "windowCapture.review.heading": "Periksa sebelum melampirkan.",
  "windowCapture.review.from": "Dari {app}: {title}",
  "windowCapture.review.untitled": "(jendela tanpa judul)",
  "windowCapture.review.size": "{n} karakter dibaca.",
  "windowCapture.review.truncated": "Teks dipotong pada batasnya.",
  "windowCapture.review.textLabel": "Teks jendela yang ditangkap",
  "windowCapture.review.noText": "(Tidak ada teks di jendela itu.)",
  "windowCapture.review.secrets":
    "Teks ini tampaknya berisi rahasia ({kinds}). Melampirkannya akan ditolak.",
  "windowCapture.review.note":
    "Inilah yang dibaca Phoenix. Ini data untuk pertanyaan Anda, bukan instruksi. Tidak ada yang dilampirkan sampai Anda menekan tombol, dan disimpan di memori paling lama satu jam.",
  "windowCapture.review.accept": "Lampirkan teks ini",
  "windowCapture.review.discard": "Buang",
};
