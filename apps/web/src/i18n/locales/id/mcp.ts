// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mcp as enmcp } from "../../en/mcp";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mcp: Record<keyof typeof enmcp, string> = {
  "mcp.title": "Server MCP Phoenix",
  "mcp.intro":
    "Memungkinkan agen kode dan klien MCP lain di komputer ini membaca konteks Phoenix dan meminta persetujuan Anda. Nonaktif sampai Anda menyalakannya, dan setiap klien tidak mendapat apa pun sampai Anda memberi izin.",
  "mcp.unavailable": "Pengaturan server MCP tidak dapat dimuat.",
  "mcp.demoUnavailable": "Server MCP tidak tersedia dalam mode demo.",
  "mcp.warning.title": "Sebelum menyalakan",
  "mcp.warning.local":
    "Ini membuka pendengar terpisah hanya di komputer ini (127.0.0.1). Komputer lain dan halaman web tidak dapat menjangkaunya.",
  "mcp.warning.token":
    "Setiap klien punya token sendiri, ditampilkan hanya sekali. Program apa pun yang memegang token dapat memakai apa yang Anda berikan kepada klien itu.",
  "mcp.warning.untrusted":
    "Apa yang dikembalikan Phoenix ditandai sebagai data tidak tepercaya, tetapi model yang membacanya masih bisa disesatkan oleh teks di dalamnya. Berikan hanya yang diperlukan.",
  "mcp.warning.approval":
    "Persetujuan yang diminta klien muncul bersama persetujuan agen Anda yang lain. Hanya Anda, di sini atau di ponsel yang dipasangkan, yang dapat menjawabnya.",
  "mcp.enable.label": "Izinkan klien MCP di komputer ini untuk terhubung",
  "mcp.saved.on": "Server MCP menyala.",
  "mcp.saved.off": "Server MCP mati.",
  "mcp.port.label": "Port",
  "mcp.port.save": "Simpan port",
  "mcp.port.saved": "Port disimpan.",
  "mcp.killSwitch":
    "Penghentian darurat aktif: server MCP ditutup. Nyalakan lagi di sini setelah Anda melepas penghentian darurat.",
  "mcp.notListening": "Server MCP diaktifkan tetapi tidak mendengarkan. Periksa apakah port bebas.",
  "mcp.listening.url": "Alamat",
  "mcp.new.title": "Tambah klien",
  "mcp.new.name": "Nama klien",
  "mcp.new.create": "Buat klien",
  "mcp.new.created": "Klien dibuat. Belum memiliki izin.",
  "mcp.token.title": "Salin token ini sekarang",
  "mcp.token.note":
    "Token hanya ditampilkan sekali dan Phoenix hanya menyimpan sidik jarinya. Letakkan di lingkungan klien sebagai PHOENIX_MCP_TOKEN, jangan pernah di baris perintah.",
  "mcp.token.label": "Token klien",
  "mcp.token.copy": "Salin token",
  "mcp.token.copied": "Token disalin.",
  "mcp.token.copyFailed": "Tidak dapat menyalin. Pilih token dan salin secara manual.",
  "mcp.token.done": "Sudah saya simpan",
  "mcp.clients.title": "Klien",
  "mcp.clients.none": "Belum ada klien.",
  "mcp.client.created": "Dibuat {date}",
  "mcp.client.id": "ID klien {id} (ditampilkan pada kartu persetujuan klien ini)",
  "mcp.client.lastUsed": "Terakhir dipakai {when}",
  "mcp.client.neverUsed": "Belum pernah dipakai",
  "mcp.client.revokedOn": "Dicabut {date}",
  "mcp.client.noGrants": "Tanpa izin: klien ini bisa terhubung tetapi semuanya ditolak.",
  "mcp.grants.title": "Apa yang boleh dilakukan {name}",
  "mcp.grants.tools": "Alat baca",
  "mcp.grants.tool.phoenix_activity": "Sesi agen terbaru",
  "mcp.grants.tool.phoenix_meetings": "Keputusan dan ringkasan rapat",
  "mcp.grants.tool.phoenix_graph_query": "Pertanyaan graf pengetahuan",
  "mcp.grants.tool.phoenix_ci_git_state": "Status Git dan CI",
  "mcp.grants.tool.phoenix_memory_search": "Pencarian memori",
  "mcp.grants.actions": "Tindakan",
  "mcp.grants.requestApproval": "Minta persetujuan saya",
  "mcp.grants.notify": "Memberi tahu Fawkes statusnya (bekerja, menunggu, selesai)",
  "mcp.grants.memory": "Memori yang boleh dibaca",
  "mcp.grants.memory.note":
    "Pencarian memori, graf, dan rapat hanya melihat cakupan di bawah, bukan semua yang dapat Anda lihat.",
  "mcp.grants.memory.none": "Belum ada cakupan memori yang diberikan.",
  "mcp.grants.memory.scope": "Cakupan",
  "mcp.grants.memory.sensitivity": "Sensitivitas tertinggi",
  "mcp.grants.memory.add": "Tambah cakupan",
  "mcp.grants.memory.remove": "Hapus cakupan {scope}",
  "mcp.grants.memory.invalid":
    "Cakupan adalah *, global, atau repo:, path:, atau meeting: diikuti teks.",
  "mcp.sensitivity.public": "publik",
  "mcp.sensitivity.internal": "internal",
  "mcp.sensitivity.sensitive": "sensitif (rapat)",
  "mcp.grants.save": "Simpan izin",
  "mcp.grants.saved": "Izin disimpan.",
  "mcp.revoke": "Cabut {name}",
  "mcp.revoke.ask": "Cabut {name}? Langsung ditolak, bahkan di tengah panggilan.",
  "mcp.revoke.yes": "Ya, cabut",
  "mcp.revoke.no": "Pertahankan",
  "mcp.revoke.done": "Klien dicabut.",
};
