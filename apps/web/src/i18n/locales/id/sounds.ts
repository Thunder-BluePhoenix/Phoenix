// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { sounds as ensounds } from "../../en/sounds";

/** Machine-translated; unreviewed (see ../../README.md). */
export const sounds: Record<keyof typeof ensounds, string> = {
  "sounds.title": "Suara Fawkes",
  "sounds.intro":
    "Nada singkat yang dibunyikan Fawkes saat sesuatu terjadi. Nonaktif secara bawaan. Nada ini dibuat oleh Phoenix sendiri dan tidak pernah berbunyi dalam mode senyap, jam senyap, saat dibisukan, saat penghentian darurat, atau di demo.",
  "sounds.enabled": "Izinkan Fawkes mengeluarkan suara",
  "sounds.volume": "Volume",
  "sounds.volumeValue": "{percent} persen",
  "sounds.event.launch": "Halo",
  "sounds.event.poke": "Colek",
  "sounds.event.dizzy": "Pusing",
  "sounds.event.recover": "Pulih",
  "sounds.event.completion": "Tugas selesai",
  "sounds.event.needsYou": "Butuh Anda",
  "sounds.event.failure": "Ada yang gagal",
  "sounds.preview.legend": "Dengarkan suara",
  "sounds.preview.play": "Putar: {name}",
  "sounds.preview.hint":
    "Pratinjau diputar pada volume di atas walau suara nonaktif, dan hanya setelah Anda memakai halaman ini.",
  "sounds.preview.muted": "Fawkes dibisukan, jadi tidak ada yang diputar.",
  "sounds.preview.silentVolume": "Volume 0, jadi tidak ada yang diputar.",
  "sounds.preview.quiet":
    "Mode senyap, jam senyap, penghentian darurat, atau demo sedang aktif, jadi tidak ada yang diputar.",
  "sounds.preview.noGesture": "Klik atau tekan tombol di halaman dulu, lalu coba lagi.",
  "sounds.preview.failed": "Suara tidak dapat diputar di perangkat ini.",
  "sounds.saveFailed": "Pengaturan suara tidak dapat disimpan.",
  "sounds.loadFailed": "Pengaturan suara tidak dapat dimuat.",
  "sounds.note":
    "Folder suara Anda sendiri belum tersedia; hanya nada bawaan Phoenix yang dipakai.",
};
