// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserAssist as enBrowserAssist } from "../../en/browser-assist";

/** Machine-translated; unreviewed. */
export const browserAssist: Record<keyof typeof enBrowserAssist, string> = {
  "browser.assist.open": "Minta Fawkes membantu di halaman ini",
  "browser.assist.title": "Minta Fawkes membantu di halaman ini",
  "browser.assist.goalLabel": "Apa yang ingin Anda lakukan di halaman ini?",
  "browser.assist.goalPlaceholder": "Contoh: tambahkan yang biru ke keranjang",
  "browser.assist.propose": "Usulkan langkah",
  "browser.assist.proposing": "Bertanya ke model lokal…",
  "browser.assist.close": "Tutup asisten",
  "browser.assist.goalTooLong": "Tujuan paling banyak {max} karakter.",
  "browser.assist.goalControl": "Tujuan tidak boleh berisi karakter kontrol.",
  "browser.assist.goalHidden": "Tujuan tidak boleh berisi karakter arah teks atau lebar nol.",
  "browser.assist.requestFailed": "Asisten tidak dapat dihubungi. Tidak ada yang dijalankan.",
  "browser.assist.noLocalModel":
    "Tidak ada model di perangkat, jadi Fawkes tidak membaca halaman ini. Teks halaman tidak pernah dikirim ke layanan cloud.",
  "browser.assist.localModelFailed":
    "Model di perangkat gagal. Tidak ada yang dijalankan dan tidak ada yang dikirim ke tempat lain.",
  "browser.assist.noBrowser": "Aplikasi Phoenix ini tidak punya browser untuk membaca halaman.",
  "browser.assist.inert":
    "Diusulkan oleh model lokal yang membaca halaman ini. Belum ada yang dijalankan. Langkah ini hanya teks biasa dan mungkin salah.",
  "browser.assist.forPage": "Untuk halaman: {url}",
  "browser.assist.dropped": "{count, plural, other {# saran model ditolak dan tidak ditampilkan.}}",
  "browser.assist.noSteps": "Model tidak mengusulkan langkah untuk halaman ini.",
  "browser.assist.kind.click": "Klik",
  "browser.assist.kind.type": "Ketik di",
  "browser.assist.kind.submit": "Kirim formulir",
  "browser.assist.typeText": "teks: {text}",
  "browser.assist.modelWritten": "ditulis oleh model lokal, bukan oleh Anda",
  "browser.assist.run": "Jalankan langkah ini",
  "browser.assist.step.running": "Menunggu persetujuan Anda…",
  "browser.assist.step.done": "Selesai. Tidak ada yang lain dijalankan.",
  "browser.assist.refused.noTab": "Tidak ada tab aktif untuk menjalankan langkah ini.",
  "browser.assist.refused.moved":
    "Tab tidak lagi berada di halaman yang menjadi dasar langkah ini. Tanyakan lagi.",
  "browser.assist.failed.denied": "Anda menolak langkah ini.",
  "browser.assist.failed.blocked":
    "Phoenix menolak langkah ini (halaman atau kontrol tidak diizinkan).",
  "browser.assist.failed.unavailable": "Browser tidak dapat dihubungi.",
  "browser.assist.failed.timeout": "Langkah habis waktu. Mungkin sudah berjalan, mungkin belum.",
  "browser.assist.failed.failed": "Langkah tidak dijalankan.",
};
