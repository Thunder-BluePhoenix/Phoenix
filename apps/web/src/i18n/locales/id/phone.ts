// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { phone as enphone } from "../../en/phone";

/** Machine-translated; unreviewed (see ../../README.md). */
export const phone: Record<keyof typeof enphone, string> = {
  "phone.title": "Tautan ponsel",
  "phone.intro":
    "Pasangkan ponsel agar dapat menyetujui atau menolak hal yang ditanyakan Phoenix. Fitur ini mati sampai Anda mengaktifkannya.",
  "phone.unavailable": "Pengaturan tautan ponsel tidak dapat dimuat.",
  "phone.warning.title": "Sebelum mengaktifkan",
  "phone.warning.network":
    "Mengaktifkannya membuka pendengar HTTPS terpisah yang dapat dijangkau perangkat lain di jaringan lokal Anda (bukan internet).",
  "phone.warning.pairing":
    "Hanya ponsel yang Anda pasangkan, lalu konfirmasi di sini, yang dapat menyetujui apa pun. Pemasangan memerlukan kode yang ditampilkan di layar ini.",
  "phone.warning.trust": "Aktifkan hanya di jaringan tepercaya, seperti jaringan rumah Anda.",
  "phone.warning.presence":
    "Phoenix tidak dapat memastikan ada orang di komputer ini: program apa pun di komputer ini yang memegang token sesi Core juga dapat memasangkan ponsel.",
  "phone.enable.label": "Izinkan ponsel di jaringan lokal saya untuk terhubung",
  "phone.saved.on": "Tautan ponsel aktif.",
  "phone.saved.off": "Tautan ponsel mati.",
  "phone.saved.verifyOn":
    "Persetujuan dari ponsel kini meminta verifikasi biometrik atau perangkat.",
  "phone.saved.verifyOff": "Persetujuan dari ponsel tidak lagi meminta verifikasi perangkat.",
  "phone.killSwitch":
    "Sakelar darurat aktif, jadi pendengar ponsel ditutup. Aktifkan kembali tautan ponsel di sini setelah sakelar darurat dilepas.",
  "phone.lockedOut":
    "Pemasangan dikunci sampai {time} karena terlalu banyak kode salah dimasukkan.",
  "phone.notListening": "Tautan ponsel aktif, tetapi pendengar belum berjalan.",
  "phone.addressChanged":
    "Alamat jaringan yang Anda pilih tidak tersedia lagi, jadi tautan ponsel tetap mati. Pilih alamat lagi untuk menyalakannya kembali.",
  "phone.listen.address": "Alamat dan port",
  "phone.listen.fingerprint": "Sidik jari sertifikat (SHA-256)",
  "phone.pair.show": "Tampilkan kode pemasangan",
  "phone.pair.cancel": "Batalkan kode",
  "phone.pair.cancelled": "Kode pemasangan dibatalkan.",
  "phone.pair.expired":
    "Kode pemasangan kedaluwarsa. Tampilkan kode baru untuk memasangkan ponsel.",
  "phone.pair.instruction":
    "Di ponsel, masukkan atau pindai kode ini, dan periksa bahwa sidik jari yang ditampilkan sama dengan yang di bawah. Jika tidak sama, jangan lanjutkan.",
  "phone.pair.codeLabel": "Kode pemasangan",
  "phone.pair.remaining": "Kedaluwarsa dalam {time}",
  "phone.pair.fingerprint": "Sidik jari sertifikat:",
  "phone.pair.link": "Tautan pemasangan (kode QR tidak tersedia):",
  "phone.pair.hiddenActive":
    "Kode pemasangan aktif sampai {time}. Kode tidak ditampilkan lagi; batalkan dan tampilkan yang baru.",
  "phone.pending.question": 'Pasangkan "{name}"?',
  "phone.pending.fingerprint": "Sidik jari kunci",
  "phone.pending.yes": "Ya, pasangkan ponsel ini",
  "phone.pending.no": "Tidak, tolak",
  "phone.pending.waiting": "Menunggu Phoenix meminta konfirmasi Anda.",
  "phone.pending.approved": "Ponsel dipasangkan.",
  "phone.pending.rejected": "Pemasangan ditolak.",
  "phone.verify.label": "Wajibkan verifikasi biometrik atau perangkat pada persetujuan",
  "phone.verify.note":
    "Ponsel melaporkan apakah orangnya terverifikasi (sidik jari, wajah, atau kunci layar). Phoenix sendiri tidak dapat memeriksa laporan itu.",
  "phone.devices.title": "Ponsel terpasang",
  "phone.devices.none": "Tidak ada ponsel yang dipasangkan.",
  "phone.devices.fingerprint": "Sidik jari kunci",
  "phone.devices.created": "Dipasangkan {date}",
  "phone.devices.lastSeen": "terakhir terlihat {when}",
  "phone.devices.neverSeen": "belum pernah terlihat",
  "phone.devices.revoked": "Dicabut {date}",
  "phone.devices.revoke": "Cabut {name}",
  "phone.devices.revokeAsk": 'Cabut "{name}"? Ponsel ini tidak akan bisa menyetujui apa pun lagi.',
  "phone.devices.revokeYes": "Ya, cabut",
  "phone.devices.revokeNo": "Pertahankan",
  "phone.devices.revokedDone": "Ponsel dicabut.",
  "phone.device.unnamed": "Ponsel tanpa nama",
};
