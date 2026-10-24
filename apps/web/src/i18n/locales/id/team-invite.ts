// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamInvite as enTeamInvite } from "../../en/team-invite";

/** Machine-translated; unreviewed. */
export const teamInvite: Record<keyof typeof enTeamInvite, string> = {
  "teamInvite.share.title": "Bagikan identitas saya",
  "teamInvite.share.intro":
    "Kirim undangan ini ke rekan tim lewat obrolan atau email. Isinya hanya id tim Anda, kunci publik Anda, dan nama yang Anda ketik di bawah. Tidak ada rahasia di dalamnya, dan kunci privat Anda tidak pernah meninggalkan komputer ini.",
  "teamInvite.share.label": "Nama untuk undangan (opsional)",
  "teamInvite.share.invalid": "Undangan tidak dapat dibuat dari identitas ini.",
  "teamInvite.share.invite": "Undangan Anda",
  "teamInvite.share.copy": "Salin undangan",
  "teamInvite.share.copied": "Undangan disalin ke papan klip.",
  "teamInvite.share.copyFailed":
    "Phoenix tidak dapat memakai papan klip. Pilih undangan di atas dan salin secara manual.",
  "teamInvite.share.fingerprintHint":
    "Bacakan sidik jari kepada rekan tim lewat suara atau di obrolan lain, agar mereka bisa memeriksa bahwa undangan yang diterima adalah milik Anda.",
  "teamInvite.fingerprint": "Sidik jari kunci",
  "teamInvite.checksumNote":
    "Kode pendek di akhir undangan hanya menangkap kesalahan penyalinan. Kode itu tidak membuktikan siapa pembuat undangan; hanya membandingkan sidik jari yang membuktikannya.",
  "teamInvite.refusal.empty": "Tempel undangan terlebih dahulu.",
  "teamInvite.refusal.tooLong": "Ini terlalu panjang untuk undangan tim.",
  "teamInvite.refusal.format": "Ini bukan undangan tim Phoenix.",
  "teamInvite.refusal.version":
    "Undangan ini dari versi Phoenix lain yang tidak dapat dibaca versi ini.",
  "teamInvite.refusal.checksum":
    "Undangan berubah atau disalin dengan salah. Minta rekan tim mengirimnya lagi.",
  "teamInvite.refusal.content": "Undangan rusak atau berisi hal yang tidak terduga.",
  "teamInvite.refusal.id": "Undangan memiliki id tim yang tidak valid.",
  "teamInvite.refusal.key": "Undangan memiliki kunci publik yang tidak valid.",
  "teamInvite.refusal.label": "Undangan memiliki nama yang tidak valid.",
  "teamInvite.refusal.unsupported": "Peramban ini tidak dapat memeriksa undangan.",
  "teamInvite.refusal.own": "Undangan itu adalah identitas Anda sendiri.",
  "teamInvite.refusal.duplicate":
    "Rekan tim itu sudah ada di daftar Anda. Hapus dulu untuk mengganti kuncinya.",
  "teamInvite.add.title": "Tambah rekan tim",
  "teamInvite.add.paste": "Tempel undangan rekan tim",
  "teamInvite.add.preview": "Periksa rincian ini sebelum menambahkan rekan tim ini.",
  "teamInvite.add.noLabel": "Undangan tidak memiliki nama; ketik satu untuk ditampilkan.",
  "teamInvite.add.theirLabel": "Nama dalam undangan: {label}",
  "teamInvite.add.confirm":
    "Saya sudah membandingkan sidik jari ini dengan rekan tim lewat suara atau di obrolan lain, dan cocok.",
};
