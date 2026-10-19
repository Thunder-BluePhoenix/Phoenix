// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "Beranda Phoenix",
  "shell.nav.main": "Utama",
  "shell.nav.meetings": "Rapat",
  "shell.nav.provenance": "Asal-usul",
  "shell.nav.agents": "Agen",
  "shell.nav.workflows": "Alur kerja",
  "shell.nav.recap": "Rekap",
  "shell.nav.settings": "Pengaturan",
  "shell.nav.recording": "Merekam",
  "shell.app.skipToContent": "Lompat ke konten",
  "shell.app.tagline": "Phoenix adalah platformnya. Fawkes adalah maskotnya.",
  "shell.app.noToken":
    "Halaman ini tidak memiliki token sesi. Buka Phoenix dari alamat yang dicetak oleh {command}.",
  "shell.app.hint": "Klik Fawkes di bilah atas untuk melihat apa yang sedang dikerjakan Phoenix.",
  "shell.language.title": "Bahasa",
  "shell.language.label": "Bahasa antarmuka",
  "shell.language.available": "{count, plural, other {# bahasa tersedia.}}",
  "shell.language.machineNote":
    "Teks dalam bahasa selain Inggris diterjemahkan oleh mesin dan belum ditinjau oleh penutur asli.",
  "shell.language.saved": "Bahasa diubah.",
  "shell.language.failed": "Bahasa tidak dapat disimpan. Coba lagi.",

  "shell.palette.title": "Palet perintah",
  "shell.palette.inputLabel": "Cari perintah",
  "shell.palette.placeholder": "Ketik perintah…",
  "shell.palette.results": "Perintah",
  "shell.palette.hint":
    "Panah atas dan bawah untuk memilih, Enter untuk menjalankan, Escape untuk menutup.",
  "shell.palette.count": "{count, plural, other {# perintah}}",
  "shell.palette.empty": "Tidak ada perintah yang cocok dengan “{query}”.",

  "shell.cmd.palette.open": "Buka palet perintah",
  "shell.cmd.nav.home": "Buka beranda",
  "shell.cmd.nav.meetings": "Buka Rapat",
  "shell.cmd.nav.provenance": "Buka Asal-usul",
  "shell.cmd.nav.agents": "Buka Agen",
  "shell.cmd.nav.workflows": "Buka Alur kerja",
  "shell.cmd.nav.recap": "Buka Rekap",
  "shell.cmd.nav.settings": "Buka Pengaturan",
  "shell.cmd.settings.language": "Buka Pengaturan: Bahasa",
  "shell.cmd.panel.overview": "Panel Fawkes: Ringkasan",
  "shell.cmd.panel.chat": "Panel Fawkes: Obrolan",
  "shell.cmd.panel.activity": "Panel Fawkes: Aktivitas",
  "shell.cmd.panel.capabilities": "Panel Fawkes: Kemampuan",
  "shell.cmd.panel.memory": "Panel Fawkes: Memori",
  "shell.cmd.panel.wardrobe": "Buka Lemari Pakaian",
  "shell.cmd.demo.start": "Mulai demo",
  "shell.cmd.demo.stop": "Hentikan demo",
  "shell.cmd.mute.toggle": "Bisukan atau aktifkan suara dan notifikasi",

  "shell.shortcuts.title": "Pintasan global",
  "shell.shortcuts.desktopOnly":
    "Pintasan global adalah fitur aplikasi desktop Phoenix. Pintasan ini tidak tersedia di browser.",
  "shell.shortcuts.intro":
    "Pintasan global berfungsi dari aplikasi apa pun selama aplikasi desktop Phoenix berjalan.",
  "shell.shortcuts.loading": "Memuat pintasan…",
  "shell.shortcuts.loadFailed": "Pintasan tidak dapat dibaca dari aplikasi desktop.",
  "shell.shortcuts.enable": "Aktifkan pintasan global",
  "shell.shortcuts.warning":
    "Peringatan: saat pintasan global aktif, setiap pintasan mengambil kombinasi tombolnya dari semua aplikasi lain. Pintasan nonaktif sampai Anda mengaktifkannya. Setiap pintasan memerlukan minimal dua tombol pengubah (Ctrl, Alt, Shift, atau Cmd) agar tidak mengganggu pengetikan biasa.",
  "shell.shortcuts.mute": "Bisukan suara dan notifikasi",
  "shell.shortcuts.muteHelp":
    "Fawkes tetap menampilkan apa yang sedang dilakukannya; hanya suara dan gelembung notifikasinya yang dibisukan.",
  "shell.shortcuts.list": "Aksi pintasan",
  "shell.shortcuts.action.open_chat": "Buka obrolan",
  "shell.shortcuts.action.jump_to_alert": "Lompat ke peringatan",
  "shell.shortcuts.action.jump_to_terminal": "Lompat ke terminal",
  "shell.shortcuts.action.switch_pills": "Ganti pil",
  "shell.shortcuts.action.mute": "Bisukan suara dan notifikasi",
  "shell.shortcuts.action.send_to_desktop": "Kirim Fawkes ke desktop",
  "shell.shortcuts.action.wardrobe": "Buka Lemari Pakaian",
  "shell.shortcuts.binding.none": "Belum diatur",
  "shell.shortcuts.default": "Bawaan: {keys}",
  "shell.shortcuts.state.active": "Aktif",
  "shell.shortcuts.state.off": "Tidak aktif: pintasan global dinonaktifkan",
  "shell.shortcuts.state.unbound": "Tidak aktif: belum ada kombinasi tombol yang diatur",
  "shell.shortcuts.state.rejected": "Tidak aktif: kombinasi tombol ini tidak diizinkan",
  "shell.shortcuts.state.unavailable":
    "Tidak aktif: aplikasi lain mungkin sudah memakai kombinasi tombol ini, atau sistem tidak mengizinkannya",
  "shell.shortcuts.changeFor": "Ubah pintasan untuk {action}",
  "shell.shortcuts.capture": "Tekan kombinasi tombol baru",
  "shell.shortcuts.captureFor": "Kombinasi tombol baru untuk {action}",
  "shell.shortcuts.captureHelp": "Tekan tombol secara bersamaan. Escape membatalkan.",
  "shell.shortcuts.resetFor": "Setel ulang pintasan {action} ke bawaan",
  "shell.shortcuts.resetAll": "Setel ulang semua pintasan",
  "shell.shortcuts.saved": "Pintasan untuk {action} sekarang {keys}.",
  "shell.shortcuts.resetDone": "Pintasan untuk {action} telah disetel ulang.",
  "shell.shortcuts.resetAllDone": "Semua pintasan telah disetel ulang.",
  "shell.shortcuts.reason.invalid": "Itu bukan pintasan yang valid.",
  "shell.shortcuts.reason.unsupportedKey":
    "Tombol itu tidak dapat dipakai. Gunakan huruf, angka, tombol F, atau tombol panah bersama tombol pengubah.",
  "shell.shortcuts.reason.needs_modifiers":
    "Pintasan memerlukan minimal dua tombol pengubah (Ctrl, Alt, Shift, atau Cmd) agar tidak mengambil alih pengetikan biasa.",
  "shell.shortcuts.reason.needs_third_modifier":
    "Ctrl+Alt dan Alt+Shift dengan huruf atau angka mengetik simbol di banyak keyboard (AltGr atau Option). Tambahkan tombol pengubah ketiga.",
  "shell.shortcuts.reason.reserved": "Sistem sudah memakai kombinasi tombol itu.",
  "shell.shortcuts.reason.dictation_chord":
    "Kombinasi tombol itu dipakai oleh dikte (tempel lagi).",
  "shell.shortcuts.reason.conflict": "Pintasan Phoenix lain sudah memakai kombinasi tombol itu.",
  "shell.shortcuts.reason.unavailable":
    "Sistem tidak mendaftarkan kombinasi tombol itu. Aplikasi lain mungkin sudah memakainya.",
  "shell.shortcuts.reason.forbidden": "Jendela ini tidak dapat mengubah pintasan.",
  "shell.shortcuts.reason.unknown_action": "Itu bukan aksi pintasan.",
  "shell.shortcuts.reason.unknown": "Pintasan tidak dapat diubah.",
};
