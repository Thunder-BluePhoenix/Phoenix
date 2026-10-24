// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamStatus as enTeamStatus } from "../../en/team-status";

/** Machine-translated; unreviewed. */
export const teamStatus: Record<keyof typeof enTeamStatus, string> = {
  "teamStatus.title": "Kehadiran tim",
  "teamStatus.intro":
    "Kehadiran tim nonaktif secara default. Setelah Anda mengaktifkannya, Phoenix hanya mengirim jenis status yang Anda centang (men-deploy, menjalankan agen, dalam rapat) sebagai frame terenkripsi ke rekan tim yang Anda tambahkan, dan tidak pernah menyebut repositori, branch, atau orang.",
  "teamStatus.notAvailable":
    "Kehadiran tim tidak tersedia: Phoenix Core ini tidak memiliki penyimpanan rahasia sistem operasi untuk menyimpan kunci Anda.",
  "teamStatus.loadFailed": "Kehadiran tim tidak dapat dimuat.",
  "teamStatus.listSeparator": ", ",
  "teamStatus.kind.deploying": "men-deploy",
  "teamStatus.kind.agentRun": "menjalankan agen",
  "teamStatus.kind.meeting": "dalam rapat",
  "teamStatus.relay.label": "Alamat relay",
  "teamStatus.route.label": "Rute (opsional)",
  "teamStatus.route.hint":
    "Biarkan rute kosong untuk memulai tim baru. Tempel rute di sini untuk bergabung dengan tim yang sama dengan rekan tim.",
  "teamStatus.route.shown": "Rute relay",
  "teamStatus.turnOn": "Aktifkan",
  "teamStatus.resume": "Aktifkan kembali",
  "teamStatus.pause": "Jeda",
  "teamStatus.leave": "Keluar dari tim",
  "teamStatus.leave.ask": "Keluar dari tim dan lupakan semua orang?",
  "teamStatus.state.line": "Koneksi: {state}",
  "teamStatus.state.connected": "terhubung",
  "teamStatus.state.connecting": "menghubungkan",
  "teamStatus.state.paused": "dijeda",
  "teamStatus.lastError": "Kesalahan terakhir: {error}",
  "teamStatus.self.id": "ID tim Anda",
  "teamStatus.self.publicKey": "Kunci publik Anda",
  "teamStatus.self.hint":
    "Berikan keduanya kepada rekan tim agar mereka dapat menambahkan Anda. Kunci privat Anda tidak pernah meninggalkan komputer ini.",
  "teamStatus.sharing.title": "Yang saya bagikan",
  "teamStatus.sharing.master": "Bagikan status saya dengan tim saya",
  "teamStatus.sharing.deploying": "Men-deploy",
  "teamStatus.sharing.agentRun": "Menjalankan agen dalam waktu lama",
  "teamStatus.sharing.meeting": "Dalam rapat",
  "teamStatus.outgoing.now": "Rekan tim melihat saat ini: {kinds}.",
  "teamStatus.outgoing.none": "Rekan tim tidak melihat apa pun dari Anda saat ini.",
  "teamStatus.members.title": "Rekan tim",
  "teamStatus.members.none": "Anda belum menambahkan rekan tim.",
  "teamStatus.members.removeLabel": "Hapus {label}",
  "teamStatus.members.id": "ID tim rekan tim",
  "teamStatus.members.label": "Nama yang ditampilkan",
  "teamStatus.members.add": "Tambah rekan tim",
  "teamStatus.presence.title": "Siapa yang ada",
  "teamStatus.presence.none": "Tidak ada rekan tim untuk ditampilkan.",
  "teamStatus.presence.nothing": "tidak ada yang dibagikan",
};
