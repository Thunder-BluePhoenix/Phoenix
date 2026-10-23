// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { digest as endigest } from "../../en/digest";

/** Machine-translated; unreviewed. */
export const digest: Record<keyof typeof endigest, string> = {
  "digest.title": "Ringkasan harian",
  "digest.yesterday": "Kemarin",
  "digest.today": "Hari ini (rencana terkonfirmasi)",
  "digest.blockers": "Hambatan",
  "digest.endOfDay": "Akhir hari",
  "digest.source": "Sumber",
  "digest.none": "Tidak ada aktivitas tertaut",
  "digest.date": "Tanggal",
  "digest.localNote": "Dibuat secara lokal dari aktivitas tertaut. Tidak menggunakan model cloud.",
  "digest.error": "Gagal memuat atau menyalin ringkasan.",
  "digest.loading": "Memuat ringkasan…",
  "digest.copy": "Salin dengan sumber",
  "digest.copied": "Disalin",
  "digest.slackHeading": "Kirim ke Slack",
  "digest.slackDisclosure":
    "Pengiriman membagikan ringkasan ini, aktivitas yang dikutip, klaim peristiwa yang belum diverifikasi, dan kemungkinan konten turunan rapat ke kanal Slack yang dikonfigurasi. Core meminta konfirmasi sebelum setiap pengiriman.",
  "digest.slackOptIn": "Izinkan pengiriman ringkasan harian ke Slack",
  "digest.sendSlack": "Kirim ke Slack",
  "digest.slack.disabled": "Pengiriman ringkasan harian ke Slack dimatikan.",
  "digest.slack.chat_unavailable": "Aktifkan Persetujuan chat terlebih dahulu.",
  "digest.slack.slack_unconfigured":
    "Konfigurasikan dan aktifkan Slack di Persetujuan chat terlebih dahulu.",
  "digest.slack.missing_token": "Token bot Slack yang dikonfigurasi tidak tersedia.",
  "digest.slack.emergency_stop": "Pengiriman diblokir oleh penghentian darurat.",
  "digest.slack.ready": "Pengiriman Slack siap.",
  "digest.slackUnavailable": "Pengiriman ringkasan harian ke Slack tidak tersedia.",
  "digest.slackWaiting": "Menunggu konfirmasi Core Anda…",
  "digest.slackError":
    "Pengiriman Slack tidak dapat diselesaikan. Tidak ada percobaan ulang otomatis.",
  "digest.slackSent": "Ringkasan harian untuk {day} dikirim ke Slack.",
  "digest.sendUnavailable":
    "Pengiriman ke Slack dan Teams tidak tersedia hingga integrasi yang disetujui tersambung.",
  "digest.back": "Kembali ke ringkasan",
  "digest.eventTitle": "Bukti peristiwa",
  "digest.eventMissing": "Peristiwa ini tidak lagi tersedia.",
  "digest.unverified":
    "Belum diverifikasi: ini klaim peristiwa yang disimpan lokal, bukan bukti terverifikasi penyedia.",
  "digest.commitTitle": "Commit",
  "digest.commitMissing": "Commit ini tidak ada di repositori yang dipantau.",
  "digest.noneIncomplete": "Tidak ada yang ditemukan di sumber yang dapat dibaca.",
  "digest.noticeHeading": "Ringkasan tidak lengkap",
  "digest.noticeUnavailable":
    "Tidak dapat dibaca, sehingga ringkasan mungkin kekurangan aktivitas: {sources}.",
  "digest.noticePartial":
    "Hanya catatan terbaru yang dibaca, aktivitas lama mungkin hilang: {sources}.",
  "digest.noticeUnattributed":
    "Identitas git (user.email) belum diatur, jadi commit dikecualikan alih-alih ditampilkan sebagai milik Anda: {sources}.",
  "digest.sources.git": "repositori git",
  "digest.sources.events": "riwayat peristiwa",
  "digest.sources.sessions": "sesi agen",
  "digest.sources.meetings": "rapat",
};
