// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { chatApprovals as enChatApprovals } from "../../en/chat-approvals";

/** Machine-translated; unreviewed. */
export const chatApprovals: Record<keyof typeof enChatApprovals, string> = {
  "chatApprovals.title": "Persetujuan lewat chat",
  "chatApprovals.notAvailable": "Persetujuan lewat chat tidak tersedia di Phoenix Core ini.",
  "chatApprovals.intro":
    "Jawab persetujuan agen atau Phoenix yang tertunda dari Slack atau Discord, dan dapatkan pemberitahuan di Teams. Semuanya mati sampai Anda mengaktifkannya di sini, per penyedia dan per proyek.",
  "chatApprovals.limits":
    "Belum pernah dipakai dengan ruang kerja Slack, Discord, atau Teams yang nyata: kode hanya diuji dengan callback simulasi. Teams hanya untuk pemberitahuan (tautan ke Phoenix, tidak pernah tombol Izinkan). Penekanan tombol diperiksa dengan tanda tangan penyedia dan daftar penyetuju Anda, dan keputusannya diaudit.",
  "chatApprovals.noDm":
    "Ringkasan dan pemberitahuan hanya dikirim ke kanal yang diatur di bawah. Pesan langsung ke seseorang belum dibuat.",
  "chatApprovals.capabilityOff":
    "Kapabilitas Persetujuan lewat chat mati, jadi tidak ada yang dikirim.",
  "chatApprovals.enable": "Aktifkan kapabilitas",
  "chatApprovals.ready": "Siap: penyedia ini dapat memposting kartu.",
  "chatApprovals.notReady":
    "Belum siap: harus diaktifkan, dengan id ruang kerja, id kanal, dan setidaknya satu penyetuju.",
  "chatApprovals.teamsNote":
    "Teams hanya untuk pemberitahuan. Alamat webhook dan kunci tautannya disimpan di bawah.",
  "chatApprovals.save": "Simpan persetujuan lewat chat",
  "chatApprovals.saved": "Tersimpan.",
  "chatApprovals.provider.slack": "Slack",
  "chatApprovals.provider.discord": "Discord",
  "chatApprovals.provider.teams": "Microsoft Teams",
  "chatApprovals.enabledNamed": "Aktifkan {name}",
  "chatApprovals.notifyNamed": "Kirim pemberitahuan umum di {name}",
  "chatApprovals.digestNamed": "Sertakan {name} dalam ringkasan",
  "chatApprovals.notify": "Beri tahu (tanpa rincian) untuk permintaan yang tidak diaktifkan",
  "chatApprovals.digest.send": "Terima ringkasan",
  "chatApprovals.workspace.slack": "Id ruang kerja (tim) Slack",
  "chatApprovals.workspace.discord": "Id server (guild) Discord",
  "chatApprovals.channel.slack": "Id kanal Slack",
  "chatApprovals.channel.discord": "Id kanal Discord",
  "chatApprovals.approvers.label": "Id pengguna {name} yang boleh memutuskan (satu per baris)",
  "chatApprovals.approvers.hint":
    "Hanya huruf dan angka, maksimal 24 karakter per id, paling banyak 20. Daftar kosong berarti tidak ada yang bisa memutuskan.",
  "chatApprovals.projects.title": "Proyek yang diizinkan",
  "chatApprovals.projects.hint":
    "Hanya persetujuan agen dari proyek ini yang boleh dijawab lewat chat. Kosong: tidak ada.",
  "chatApprovals.projects.label": "Nama proyek (satu per baris)",
  "chatApprovals.digest.title": "Ringkasan terjadwal",
  "chatApprovals.digest.intro":
    "Mati secara bawaan. Mengirim jumlah dan id persetujuan singkat ke kanal di atas, hanya ke penyedia yang menerima ringkasan, tidak pernah di jam tenang dan tidak pernah jika tidak ada kejadian.",
  "chatApprovals.digest.enabled": "Kirim ringkasan terjadwal",
  "chatApprovals.digest.interval": "Menit antar ringkasan",
  "chatApprovals.digest.hint": "Dari {min} (satu jam) sampai {max} menit (satu minggu).",
  "chatApprovals.cred.title": "Kredensial",
  "chatApprovals.cred.writeOnly":
    "Hanya tulis. Yang Anda ketik dikirim ke penyimpanan kredensial Core dan langsung dihapus dari halaman ini. Nilai yang tersimpan tidak pernah ditampilkan lagi.",
  "chatApprovals.cred.save": "Simpan",
  "chatApprovals.cred.stored": "Tersimpan",
  "chatApprovals.cred.notStored": "Tidak tersimpan",
  "chatApprovals.cred.remove": "Hapus",
  "chatApprovals.cred.removeNamed": "Hapus {name} yang tersimpan",
  "chatApprovals.field.slackBot": "Token bot Slack",
  "chatApprovals.field.slackSigning": "Rahasia tanda tangan Slack",
  "chatApprovals.field.discordBot": "Token bot Discord",
  "chatApprovals.field.discordKey": "Kunci publik aplikasi Discord",
  "chatApprovals.field.teamsWebhook": "Alamat webhook Teams",
  "chatApprovals.field.teamsKey": "Kunci tautan Teams",
  "chatApprovals.error.ids":
    "Id ruang kerja dan kanal hanya berisi huruf dan angka, maksimal 24 karakter.",
  "chatApprovals.error.approvers":
    "Id penyetuju hanya berisi huruf dan angka, maksimal 24 karakter per id, paling banyak 20.",
  "chatApprovals.error.projects":
    "Nama proyek harus 1 sampai 120 karakter yang terlihat, paling banyak 200 proyek.",
  "chatApprovals.error.interval":
    "Interval ringkasan harus bilangan bulat dari 60 sampai 10080 menit.",
  "chatApprovals.error.save": "Pengaturan persetujuan lewat chat tidak dapat disimpan.",
  "chatApprovals.error.capability": "Kapabilitas Persetujuan lewat chat tidak dapat diubah.",
  "chatApprovals.error.unavailable":
    "Phoenix Core ini tidak punya penyimpanan kredensial OS, jadi kredensial tidak dapat disimpan.",
  "chatApprovals.error.cred": "Kredensial tidak disimpan atau dihapus.",
  "chatApprovals.error.credShape":
    "Nilai itu tampaknya tidak sesuai untuk kolom ini, jadi tidak dikirim. Periksa dan coba lagi.",
};
