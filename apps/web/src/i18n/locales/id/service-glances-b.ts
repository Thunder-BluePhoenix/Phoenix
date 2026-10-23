// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlancesB as enServiceGlancesB } from "../../en/service-glances-b";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlancesB: Record<keyof typeof enServiceGlancesB, string> = {
  "services.glance.resend.notConfigured":
    "Tambahkan kunci API Resend di rahasia kapabilitas Resend untuk melihat status pengiriman di sini.",
  "services.glance.resend.empty": "Tidak ada email yang baru dikirim untuk dihitung.",
  "services.glance.resend.summary": "{count, plural, other {# email terbaru}}",
  "services.glance.resend.newest": "Terbaru: {time}",
  "services.glance.resend.privacy":
    "Hanya jumlah. Subjek dan penerima tidak pernah ditampilkan di sini.",
  "services.glance.resend.state.delivered": "Terkirim",
  "services.glance.resend.state.inFlight": "Dalam perjalanan",
  "services.glance.resend.state.delayed": "Tertunda",
  "services.glance.resend.state.bounced": "Terpental",
  "services.glance.resend.state.complained": "Ditandai sebagai spam",
  "services.glance.resend.state.failed": "Gagal",
  "services.glance.resend.state.other": "Lainnya",

  "services.glance.notion.notConfigured":
    "Tambahkan token integrasi Notion di rahasia kapabilitas Notion untuk melihat halaman yang Anda pantau di sini.",
  "services.glance.notion.empty":
    "Tidak ada halaman atau basis data yang dipantau untuk ditampilkan. Daftarkan dengan id di pengaturan kapabilitas Notion.",
  "services.glance.notion.summary": "{count, plural, other {# item dipantau}}",
  "services.glance.notion.privacy":
    "Hanya judul dan waktu pengeditan. Isi halaman tidak pernah dibaca.",
  "services.glance.notion.untitled": "Tanpa judul",
  "services.glance.notion.kind.page": "Halaman",
  "services.glance.notion.kind.database": "Basis data",
  "services.glance.notion.kind.archived": "Diarsipkan",
  "services.glance.notion.edited": "Diedit {time}",
  "services.glance.notion.open": "Buka di Notion",
  "services.glance.notion.openNamed": "Buka {title} di Notion",

  "services.glance.calcom.notConfigured":
    "Tambahkan kunci API Cal.com di rahasia kapabilitas Cal.com untuk melihat pemesanan Anda di sini.",
  "services.glance.calcom.empty": "Tidak ada pemesanan mendatang.",
  "services.glance.calcom.summary": "{count, plural, other {# pemesanan mendatang}}",
  "services.glance.calcom.privacy":
    "Hanya waktu dan jumlah peserta. Nama dan alamat email tidak pernah ditampilkan di sini.",
  "services.glance.calcom.booking": "Pemesanan",
  "services.glance.calcom.status.accepted": "Dikonfirmasi",
  "services.glance.calcom.status.pending": "Menunggu konfirmasi",
  "services.glance.calcom.status.other": "Lainnya",
  "services.glance.calcom.attendees": "{count, plural, other {# peserta}}",
  "services.glance.calcom.more": "{count, plural, other {# pemesanan lagi}}",
};
