// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browser as enBrowser } from "../../en/browser";

/** Machine-translated; unreviewed. */
export const browser: Record<keyof typeof enBrowser, string> = {
  "browser.tabs.label": "Tab",
  "browser.tab.untitled": "Tab baru",
  "browser.tab.loading": "Memuat",
  "browser.tab.close": "Tutup tab {title}",
  "browser.tab.new": "Tab baru",
  "browser.nav.back": "Kembali",
  "browser.nav.forward": "Maju",
  "browser.nav.reload": "Muat ulang",
  "browser.address.label": "Alamat atau pencarian",
  "browser.address.placeholder": "Cari atau ketik alamat",
  "browser.address.go": "Buka",
  "browser.address.blocked": "Tidak dibuka: {text}",
  "browser.deny.unparseable": "Itu bukan alamat web yang valid.",
  "browser.deny.scheme_not_allowed": "Hanya alamat web aman (https) yang dapat dibuka.",
  "browser.deny.dangerous_scheme":
    "Alamat yang menjalankan kode atau memuat halaman itu sendiri tidak dapat dibuka.",
  "browser.deny.file_blocked": "File di komputer ini tidak dapat dibuka di sini.",
  "browser.deny.credentials_in_url": "Alamat yang berisi nama pengguna atau kata sandi ditolak.",
  "browser.deny.private_network":
    "Alamat di komputer ini atau jaringan lokal Anda tidak dapat diketik di sini. Buka halaman program dari radar port.",
  "browser.deny.bad_port": "Port itu diblokir karena milik layanan non-web.",
  "browser.deny.insecure_blocked": "Alamat http biasa tidak dibuka.",
  "browser.deny.site_denied": "Situs ini ada dalam daftar blokir.",
  "browser.deny.dns_private":
    "Nama itu mengarah ke alamat di komputer ini atau jaringan lokal Anda.",
  "browser.deny.port_radar_invalid":
    "Permintaan dari radar port bukan halaman biasa di komputer ini, jadi diabaikan.",
  "browser.deny.unknown": "Alamat itu ditolak.",
  "browser.zoom.label": "Zoom",
  "browser.zoom.out": "Perkecil",
  "browser.zoom.in": "Perbesar",
  "browser.zoom.reset": "Setel ulang zoom ke {percent}",
  "browser.shields.label": "Blokir iklan dan pelacak di {site}",
  "browser.shields.saveFailed":
    "Pilihan diterapkan di sini tetapi tidak dapat disimpan di Phoenix Core.",
  "browser.shields.blocked": "{count, plural, other {# permintaan diblokir}}",
  "browser.empty": "Tidak ada tab yang terbuka. Ketik alamat atau pencarian di atas.",
  "browser.noShell":
    "Halaman ini adalah bilah alat peramban Phoenix. Hanya berfungsi di dalam aplikasi desktop Phoenix.",
  "browser.radar.title": "Buka program dari komputer ini?",
  "browser.radar.body":
    "Radar port meminta untuk membuka alamat ini. Ini program yang berjalan di komputer ini, bukan situs web, dan tidak dienkripsi.",
  "browser.radar.url": "Alamat: {url}",
  "browser.radar.open": "Buka",
  "browser.radar.cancel": "Batal",
  "browser.error.action": "Peramban tidak dapat melakukannya.",
  "browser.profile.label": "Tab baru dibuka di",
  "browser.profile.private": "Pribadi (tidak ada yang disimpan)",
  "browser.tab.profile": "Profil: {name}",
  "browser.deny.profile_invalid": "Profil itu tidak valid, jadi tidak ada yang dibuka.",
  "browser.deny.profile_unsupported": "Profil tersimpan tidak tersedia di versi browser ini.",
  "browser.deny.profile_busy": "Profil itu sedang dihapus atau sibuk. Coba lagi sebentar lagi.",
  "browser.deny.profile_failed": "Penyimpanan web profil tidak dapat dibuka.",
  "browser.purge.running": "Menghapus data web tersimpan dari profil yang dihapus…",
  "browser.purge.failed":
    "Data web tersimpan dari profil yang dihapus belum dapat dihapus. Phoenix akan mencoba lagi.",
};
