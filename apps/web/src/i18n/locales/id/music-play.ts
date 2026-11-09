// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { musicPlay as enMusicPlay } from "../../en/music-play";

/** Machine-translated; unreviewed (see ../../README.md). */
export const musicPlay: Record<keyof typeof enMusicPlay, string> = {
  "musicPlay.title": "Cari musik",
  "musicPlay.body":
    "Phoenix tidak memutar apa pun dan tidak memilih hasil. Buka halaman pencarian dan pilih sendiri hasilnya.",
  "musicPlay.service": "Situs: {service}",
  "musicPlay.query": "Cari: {query}",
  "musicPlay.open": "Buka halaman pencarian",
  "musicPlay.checking": "Memeriksa bahwa situs ini diizinkan…",
  "musicPlay.off":
    "{service} nonaktif. Aktifkan di Pengaturan, di bagian situs musik, lalu minta lagi.",
  "musicPlay.failed": "Alamat pencarian tidak dapat dibuat.",
  "musicPlay.refused.unknown_service":
    "Hanya SoundCloud, Bandcamp, dan YouTube yang bisa dicari dengan cara ini.",
  "musicPlay.refused.empty_query": "Ucapkan atau ketik apa yang dicari.",
  "musicPlay.refused.too_long": "Pencarian itu lebih dari {max} karakter.",
  "musicPlay.refused.bad_characters": "Pencarian itu berisi karakter yang tidak diizinkan.",
};
