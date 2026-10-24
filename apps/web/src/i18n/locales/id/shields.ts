// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shields as enShields } from "../../en/shields";

/** Machine-translated; unreviewed. */
export const shields: Record<keyof typeof enShields, string> = {
  "shields.title": "Pemblokiran iklan dan pelacak",
  "shields.intro":
    "Pengaturan ini berlaku di peramban Phoenix saat dirilis. Phoenix belum punya jendela peramban, jadi saat ini tidak ada yang diblokir di halaman mana pun. Dengan cara ini hanya permintaan jaringan yang dapat diblokir: menyembunyikan elemen halaman tidak didukung, dan ini bukan salinan perlindungan peramban lain.",
  "shields.unavailable":
    "Pengaturan pemblokiran iklan dan pelacak tidak tersedia dari Phoenix Core.",
  "shields.loadFailed": "Pengaturan pemblokiran tidak dapat dibaca dari Phoenix Core.",
  "shields.global.label": "Blokir iklan dan pelacak",
  "shields.global.hint":
    "Jika mati, tidak ada daftar yang diterapkan ke situs mana pun. Jika menyala dan belum ada daftar yang diunduh, dipakai daftar singkat bawaan berisi host iklan dan analitik yang dikenal.",
  "shields.lists.title": "Daftar filter",
  "shields.lists.note":
    "Daftar tidak disertakan dengan Phoenix dan tidak pernah diunduh sendiri. Menekan Perbarui menghubungi easylist.to satu kali untuk mengunduh daftar itu. Tidak ada data tentang Anda atau halaman Anda yang dikirim.",
  "shields.list.purpose.ads": "Memblokir iklan",
  "shields.list.purpose.trackers": "Memblokir pelacakan",
  "shields.list.never": "Belum pernah diunduh.",
  "shields.list.damaged":
    "Salinan tersimpan rusak dan tidak dipakai. Tekan Perbarui untuk mengunduhnya lagi.",
  "shields.list.status":
    "Diunduh {date} · {rules} aturan pemblokiran · {cosmetic} aturan elemen halaman diabaikan",
  "shields.list.version": "Versi daftar {version}",
  "shields.list.due":
    "Daftar menyarankan mencari versi baru setelah {date}. Phoenix tidak pernah memeriksa sendiri.",
  "shields.list.licence": "Lisensi: {licence}. Kredit: {attribution}.",
  "shields.list.source": "Pembaruan menghubungi {source}",
  "shields.list.enable": "Gunakan {name}",
  "shields.list.enableNeedsDownload": "Unduh daftar sebelum menyalakannya.",
  "shields.list.update": "Perbarui",
  "shields.list.updateFirst": "Unduh",
  "shields.list.updating": "Mengunduh…",
  "shields.list.updated": "{name} diperbarui.",
  "shields.list.remove": "Hapus salinan yang diunduh",
  "shields.list.removed": "Salinan {name} yang diunduh dihapus.",
  "shields.sites.title": "Situs dengan pemblokiran dimatikan",
  "shields.sites.empty": "Tidak ada situs dengan pemblokiran dimatikan.",
  "shields.sites.add.label": "Nama situs, misalnya example.com",
  "shields.sites.add.submit": "Matikan pemblokiran untuk situs ini",
  "shields.sites.remove": "Nyalakan lagi pemblokiran untuk {site}",
  "shields.sites.hint":
    "Ketik nama situs saja, bukan alamat. Situs dan subdomainnya termasuk. Iklan YouTube sendiri dibiarkan selama situs musik YouTube diizinkan, dan itu diatur di situs musik, bukan di sini.",
};
