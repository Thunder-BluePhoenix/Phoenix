// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlances as enServiceGlances } from "../../en/service-glances";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlances: Record<keyof typeof enServiceGlances, string> = {
  "services.glance.heading": "{name} sekilas",
  "services.glance.disabled": "{name} nonaktif. Aktifkan di Kemampuan untuk melihatnya di sini.",
  "services.glance.loading": "Memuat…",
  "services.glance.error": "{name} tidak dapat dibaca.",
  "services.glance.stale": "{name} tidak dapat diperbarui; menampilkan data terakhir.",
  "services.glance.unreadable": "{name} mengembalikan data yang tidak dapat dibaca halaman ini.",
  "services.glance.updated": "Diperbarui {time}",
  "services.glance.state.unknown": "Tidak diketahui",
  "services.glance.vercel.notConfigured":
    "Tambahkan token Vercel di Pengaturan untuk melihat deployment.",
  "services.glance.vercel.empty": "Belum ada deployment.",
  "services.glance.vercel.summary": "Deployment terbaru: {count}",
  "services.glance.vercel.failed": "Gagal: {count}",
  "services.glance.vercel.building": "Sedang berjalan: {count}",
  "services.glance.vercel.state.queued": "Dalam antrean",
  "services.glance.vercel.state.initializing": "Memulai",
  "services.glance.vercel.state.building": "Membangun",
  "services.glance.vercel.state.ready": "Siap",
  "services.glance.vercel.state.error": "Gagal",
  "services.glance.vercel.state.canceled": "Dibatalkan",
  "services.glance.stripe.notConfigured":
    "Tambahkan kunci Stripe terbatas hanya-baca di Pengaturan untuk melihat pembayaran.",
  "services.glance.stripe.empty": "Tidak ada pembayaran terbaru.",
  "services.glance.stripe.counted": "Pembayaran terbaru yang dihitung: {count}",
  "services.glance.stripe.succeeded": "Berhasil: {count}",
  "services.glance.stripe.failed": "Gagal: {count}",
  "services.glance.stripe.pending": "Tertunda: {count}",
  "services.glance.stripe.received": "Diterima: {amounts}",
  "services.glance.stripe.failedAmount": "Jumlah yang gagal: {amounts}",
  "services.glance.stripe.available": "Saldo tersedia: {amounts}",
  "services.glance.stripe.pendingBalance": "Saldo tertunda: {amounts}",
  "services.glance.stripe.privacy":
    "Hanya jumlah dan hitungan. Pelanggan dan kartu tidak pernah ditampilkan.",
  "services.glance.stripe.state.succeeded": "Berhasil",
  "services.glance.stripe.state.failed": "Gagal",
  "services.glance.stripe.state.pending": "Tertunda",
  "services.glance.stripe.state.refunded": "Dikembalikan",
  "services.glance.n8n.notConfigured":
    "Atur alamat n8n Anda dan tambahkan kunci API di Pengaturan untuk melihat eksekusi.",
  "services.glance.n8n.empty": "Tidak ada eksekusi terbaru.",
  "services.glance.n8n.summary": "Eksekusi terbaru: {count}",
  "services.glance.n8n.failed": "Gagal: {count}",
  "services.glance.n8n.workflows": "Alur kerja aktif: {active} dari {total}",
  "services.glance.n8n.host": "Kunci API dikirim ke {host}",
  "services.glance.n8n.state.success": "Berhasil",
  "services.glance.n8n.state.error": "Gagal",
  "services.glance.n8n.state.crashed": "Mogok",
  "services.glance.n8n.state.running": "Berjalan",
  "services.glance.n8n.state.waiting": "Menunggu",
  "services.glance.n8n.state.new": "Dalam antrean",
};
