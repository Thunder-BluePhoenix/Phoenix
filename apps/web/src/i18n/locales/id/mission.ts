// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mission as enmission } from "../../en/mission";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mission: Record<keyof typeof enmission, string> = {
  "mission.title": "Kontrol misi",
  "mission.nav": "Misi",
  "mission.note":
    "Token dan biaya adalah yang dilaporkan oleh agen itu sendiri. Angka ini tidak diverifikasi dengan tagihan penyedia.",
  "mission.sourceMissing":
    "Beberapa sesi agen tidak dapat dibaca saat ini (fitur agen mati atau tidak merespons), sehingga papan mungkin kekurangan sesi.",
  "mission.refresh": "Segarkan",
  "mission.loadFailed": "Kontrol misi tidak dapat dimuat.",

  "mission.filter.search": "Cari sesi",
  "mission.filter.searchPlaceholder": "Agen, proyek, atau id sesi",
  "mission.filter.agent": "Agen",
  "mission.filter.project": "Proyek",
  "mission.filter.state": "Status",
  "mission.filter.all": "Semua",
  "mission.filter.clear": "Hapus filter",

  "mission.state.working": "Bekerja",
  "mission.state.waiting": "Menunggu Anda",
  "mission.state.finished": "Selesai",
  "mission.state.stuck": "Macet",
  "mission.reason.permission": "Butuh izin Anda",
  "mission.reason.input": "Punya pertanyaan untuk Anda",
  "mission.reason.idle": "Diam di prompt",
  "mission.stuck.noReport": "Tidak ada laporan lebih lama dari batas macet",
  "mission.stuck.safetyStall": "Ditandai macet oleh jaring pengaman",

  "mission.board.title": "Sesi",
  "mission.board.empty": "Tidak ada sesi agen untuk ditampilkan.",
  "mission.board.noMatch": "Tidak ada sesi yang cocok dengan filter.",
  "mission.column.count": "{count, plural, other {# sesi}}",
  "mission.column.empty": "Tidak ada",

  "mission.card.open": "Detail",
  "mission.card.focus": "Lompat ke terminal",
  "mission.card.focused": "Jendela terminal telah dibawa ke depan.",
  "mission.card.unnamedProject": "proyek tidak dikenal",
  "mission.card.tokens": "{input} masuk, {output} keluar",
  "mission.card.noTokens": "Jumlah token tidak dilaporkan",
  "mission.card.cost": "Biaya {cost}",
  "mission.card.costPartial":
    "Biaya {cost} atau lebih (sebagian penggunaan tidak diketahui biayanya)",
  "mission.card.costUnknown": "Biaya tidak diketahui",
  "mission.card.lastSeen": "Terakhir terdengar {ago}",
  "mission.card.steps": "{count, plural, other {# langkah}}",

  "mission.totals.title": "Token dan biaya",
  "mission.totals.window": "{days, plural, other {# hari}} terakhir",
  "mission.totals.input": "Token masukan",
  "mission.totals.output": "Token keluaran",
  "mission.totals.cost": "Biaya",
  "mission.totals.unknown": "tidak diketahui",
  "mission.totals.partial": "{cost} atau lebih",
  "mission.totals.unpriced":
    "Harga belum diatur untuk: {models}. Biayanya tidak diketahui, bukan nol. Tambahkan harga di bawah untuk melihat biaya.",
  "mission.totals.empty": "Tidak ada agen yang melaporkan token atau biaya pada periode ini.",

  "mission.by.day": "Per hari",
  "mission.by.agent": "Per agen",
  "mission.by.project": "Per proyek",
  "mission.by.session": "Per sesi",
  "mission.col.day": "Hari",
  "mission.col.agent": "Agen",
  "mission.col.project": "Proyek",
  "mission.col.session": "Sesi",
  "mission.col.input": "Masukan",
  "mission.col.output": "Keluaran",
  "mission.col.cost": "Biaya",

  "mission.budgets.title": "Anggaran",
  "mission.budgets.note":
    "Peringatan datang sebelum batas tercapai, pada {thresholds} dari batas, sekali per anggaran per hari. Anggaran biaya hanya menghitung penggunaan yang biayanya diketahui.",
  "mission.budgets.none": "Belum ada anggaran.",
  "mission.budgets.line": "{scope}, {metric}{agent}: {used} dari {limit} ({pct}%)",
  "mission.budgets.lineUnknown":
    "{scope}, {metric}{agent}: penggunaan tidak diketahui, batas {limit}",
  "mission.budgets.lineAtLeast":
    "{scope}, {metric}{agent}: setidaknya {used} dari {limit} ({pct}%); sebagian penggunaan tidak punya biaya yang diketahui dan tidak dihitung",
  "mission.ingest.notice":
    "Hari ini Core memotong {clamped, plural, other {# laporan}} ke batas dan menolak {refused, plural, other {# laporan}}, jadi angka di bawah bisa lebih rendah dari yang dilaporkan agen. Agen: {agents}.",
  "mission.budgets.agentSuffix": " ({agent})",
  "mission.budgets.scope": "Berlaku untuk",
  "mission.budgets.scope.daily": "Sepanjang hari",
  "mission.budgets.scope.session": "Setiap sesi",
  "mission.budgets.metric": "Diukur dalam",
  "mission.budgets.metric.tokens": "Token",
  "mission.budgets.metric.cost": "Dolar AS",
  "mission.budgets.limit": "Batas",
  "mission.budgets.agent": "Agen (opsional)",
  "mission.budgets.add": "Tambah anggaran",
  "mission.budgets.remove": "Hapus anggaran {id}",
  "mission.budgets.invalid": "Masukkan batas di atas nol.",

  "mission.prices.title": "Harga",
  "mission.prices.note":
    "Phoenix tidak punya harga bawaan. Masukkan harga Anda sendiri, dalam dolar AS per juta token, dengan nama model yang dilaporkan agen.",
  "mission.prices.aiNote": "Model yang juga punya harga di pengaturan AI: {models}.",
  "mission.prices.none": "Belum ada harga.",
  "mission.prices.model": "Model",
  "mission.prices.input": "Masukan per juta token",
  "mission.prices.output": "Keluaran per juta token",
  "mission.prices.line": "{model}: {input} masuk, {output} keluar per juta token",
  "mission.prices.add": "Simpan harga",
  "mission.prices.remove": "Hapus harga untuk {model}",
  "mission.prices.invalid": "Masukkan nama model dan dua harga sebesar nol atau lebih.",

  "mission.stall.label": "Tandai sesi aktif sebagai macet setelah sekian menit tanpa laporan",
  "mission.stall.save": "Simpan",

  "mission.saved": "Tersimpan",
  "mission.delete.button": "Hapus semua penggunaan agen",
  "mission.delete.warning":
    "Hapus setiap angka token dan biaya yang tersimpan? Anggaran dan harga tetap ada. Tindakan ini tidak dapat dibatalkan.",
  "mission.delete.confirm": "Ya, hapus",
  "mission.delete.done": "{count, plural, other {# catatan dihapus}}",
};
