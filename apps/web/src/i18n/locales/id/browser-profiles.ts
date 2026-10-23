// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserProfiles as enBrowserProfiles } from "../../en/browser-profiles";

/** Machine-translated; unreviewed. */
export const browserProfiles: Record<keyof typeof enBrowserProfiles, string> = {
  "browserProfiles.title": "Profil browser",
  "browserProfiles.intro":
    "Phoenix belum memiliki browser sendiri, jadi tidak ada halaman yang dibuka di sini: profil hanyalah catatan bookmark, pilihan sinkronisasi, dan ekstensi.",
  "browserProfiles.unavailable":
    "Profil browser tidak tersedia: Phoenix Core tidak memiliki penyimpanan rahasia sistem operasi untuk menyimpannya dengan aman.",
  "browserProfiles.loadFailed": "Profil browser tidak dapat dibaca dari Phoenix Core.",
  "browserProfiles.empty": "Belum ada profil.",
  "browserProfiles.list": "Profil",
  "browserProfiles.create.name": "Nama profil",
  "browserProfiles.create.submit": "Buat profil",
  "browserProfiles.counts": "Bookmark: {bookmarks} · Riwayat: {history} · Ekstensi: {extensions}",
  "browserProfiles.sync.label": "Sinkronkan profil ini di semua perangkat saya",
  "browserProfiles.sync.hint":
    "Sinkronisasi hanya berjalan jika sinkronisasi akun juga diatur di Pengaturan → Sinkronisasi.",
  "browserProfiles.import.label": "Bookmark yang akan diimpor (file HTML yang diekspor browser)",
  "browserProfiles.import.hint":
    "Tempel isi file. Maksimal 256 KiB sekali impor; bagi ekspor yang lebih besar menjadi beberapa bagian.",
  "browserProfiles.import.submit": "Impor bookmark",
  "browserProfiles.import.result": "{imported} diimpor, {skipped} dilewati.",
  "browserProfiles.publish.submit": "Terbitkan ke perangkat saya yang lain",
  "browserProfiles.publish.done": "Diterbitkan.",
  "browserProfiles.remove.start": "Hapus profil",
  "browserProfiles.remove.ask":
    "Hapus “{name}”? Ini menghapus bookmark, riwayat, ekstensi, dan kredensial tersimpannya, dan tidak dapat dibatalkan.",
  "browserProfiles.remove.done":
    "Profil dihapus. Bookmark, riwayat, ekstensi, dan kredensial tersimpannya telah dihapus. Penyimpanan web terisolasi bernama {partition} belum dapat dibersihkan oleh Phoenix Core.",
  "browserProfiles.devices.heading": "Perangkat lain",
  "browserProfiles.devices.check": "Periksa profil dari perangkat saya yang lain",
  "browserProfiles.devices.none": "Tidak ada profil baru dari perangkat Anda yang lain.",
  "browserProfiles.devices.found": "Profil dari perangkat Anda yang lain",
  "browserProfiles.devices.adopt": "Adopsi",
  "browserProfiles.devices.adoptLabel": "Adopsi {name} ke perangkat ini",
  "browserProfiles.devices.adopted": "Profil diadopsi.",
  "browserProfiles.ext.heading": "Ekstensi",
  "browserProfiles.ext.admin": "Ekstensi dipasang oleh administrator Anda.",
  "browserProfiles.ext.none": "Tidak ada ekstensi.",
  "browserProfiles.ext.loadFailed": "Ekstensi tidak dapat dibaca.",
  "browserProfiles.ext.version": "Versi {version}",
  "browserProfiles.ext.origins": "Situs: {origins}",
  "browserProfiles.ext.permissions": "Izin: {permissions}",
  "browserProfiles.ext.noneListed": "tidak ada",
  "browserProfiles.ext.approved": "Disetujui",
  "browserProfiles.ext.notApproved": "Belum disetujui",
  "browserProfiles.ext.revoked": "Dicabut",
  "browserProfiles.ext.untrusted": "Penanda tangan tidak tepercaya",
  "browserProfiles.ext.approve": "Setujui",
  "browserProfiles.ext.approveLabel": "Setujui ekstensi {id}",
  "browserProfiles.ext.withdraw": "Tarik persetujuan",
  "browserProfiles.ext.withdrawLabel": "Tarik persetujuan ekstensi {id}",
  "browserProfiles.ext.remove": "Hapus",
  "browserProfiles.ext.removeLabel": "Hapus ekstensi {id}",
  "browserProfiles.ext.waiting": "Menunggu jawaban Anda atas pertanyaan persetujuan…",
  "browserProfiles.music.title": "Situs musik",
  "browserProfiles.music.intro":
    "Phoenix tidak memutar musik. Mengaktifkan situs hanya memungkinkan Phoenix membuat alamat pencarian untuknya, yang Anda buka sendiri. Setiap situs nonaktif sampai Anda mengaktifkannya.",
  "browserProfiles.music.unavailable": "Situs musik tidak tersedia di Phoenix Core ini.",
  "browserProfiles.music.loadFailed": "Situs musik tidak dapat dibaca dari Phoenix Core.",
  "browserProfiles.music.list": "Situs musik",
  "browserProfiles.music.hosts": "Alamat yang digunakan: {hosts}",
  "browserProfiles.music.adBlocking":
    "Saat YouTube aktif, pemblokiran iklan tidak berlaku untuk pemutarnya sendiri.",
  "browserProfiles.music.site.youtube": "YouTube",
  "browserProfiles.music.site.soundcloud": "SoundCloud",
  "browserProfiles.music.site.bandcamp": "Bandcamp",
  "browserProfiles.music.site.spotify-web": "Spotify Web",
  "browserProfiles.music.site.other": "Situs musik {site}",
  "browserProfiles.music.search.label": "Cari di {site}",
  "browserProfiles.music.search.submit": "Cari",
  "browserProfiles.music.search.open": "Alamat pencarian (dibuka di tab baru):",
  "browserProfiles.music.search.badAddress":
    "Phoenix Core mengembalikan alamat yang tidak dapat dibuka.",
};
