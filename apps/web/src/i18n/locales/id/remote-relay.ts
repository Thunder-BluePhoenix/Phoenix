// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { remoteRelay as enRemoteRelay } from "../../en/remote-relay";

/** Machine-translated; unreviewed. */
export const remoteRelay: Record<keyof typeof enRemoteRelay, string> = {
  "relay.title": "Relay jarak jauh",
  "relay.intro":
    "Relay memungkinkan ponsel yang dipasangkan menjawab persetujuan Phoenix yang tertunda saat ponsel itu tidak berada di jaringan rumah Anda. Relay nonaktif secara default dan Anda yang memilih alamat relay. Tidak ada yang dikirim sampai Anda mengaktifkannya.",
  "relay.notAvailable":
    "Relay jarak jauh tidak tersedia: Phoenix Core ini tidak memiliki penyimpanan rahasia sistem operasi untuk menyimpan kunci relay.",
  "relay.loadFailed": "Status relay jarak jauh tidak dapat dimuat.",

  "relay.privacy.title": "Apa yang dapat dan tidak dapat dilihat relay",
  "relay.privacy.cannot":
    "Relay tidak dapat membaca, mengubah, memalsukan, atau memutar ulang apa pun. Setiap pesan dienkripsi end-to-end antara Phoenix dan perangkat yang dipasangkan, dan keputusan dari perangkat ditandatangani serta diperiksa oleh Phoenix sebelum dianggap sah.",
  "relay.privacy.sees":
    "Relay dapat melihat id rute acak, alamat tujuan pesan (komputer ini atau sebuah perangkat), serta ukuran dan waktu setiap pesan. Relay juga dapat membuang, menunda, atau mengulang pesan, atau berhenti berfungsi.",
  "relay.privacy.tls":
    "Koneksi aman (https) ke relay menyembunyikan informasi perutean itu dari orang lain di jaringan. Perlindungan pesan itu sendiri tidak bergantung padanya.",

  "relay.status.title": "Status",
  "relay.status.off": "Nonaktif",
  "relay.status.connected": "Aktif dan terhubung ke relay",
  "relay.status.connecting": "Aktif, tetapi saat ini tidak terhubung ke relay",
  "relay.status.url": "Alamat relay",
  "relay.status.route": "Rute",
  "relay.status.lastError": "Masalah terakhir yang dilaporkan: {message}",

  "relay.enable.label": "Alamat relay",
  "relay.enable.hint":
    "Gunakan alamat https:// dari relay yang Anda jalankan sendiri atau Anda percayai. http:// biasa hanya diterima untuk komputer ini.",
  "relay.enable.note":
    "Mengaktifkannya akan membuat rute acak baru dan kunci relay baru untuk komputer ini. Kunci privat tetap berada di penyimpanan rahasia sistem operasi dan tidak pernah ditampilkan.",
  "relay.enable.button": "Aktifkan",
  "relay.url.empty": "Masukkan alamat relay.",
  "relay.url.tooLong": "Alamat relay terlalu panjang.",
  "relay.url.notUrl": "Itu bukan alamat web.",
  "relay.url.https": "Alamat relay harus diawali dengan https://.",
  "relay.url.credentials":
    "Alamat relay tidak boleh berisi nama pengguna, kata sandi, kueri, atau fragmen.",
  "relay.saved.on": "Relay jarak jauh diaktifkan.",
  "relay.saved.off": "Relay jarak jauh dinonaktifkan. Rute dan kunci relay telah dibuang.",

  "relay.disable.button": "Nonaktifkan",
  "relay.disable.ask":
    "Nonaktifkan relay jarak jauh? Ini membuang rute dan kunci privat relay komputer ini. Perangkat yang telah menyematkannya berhenti berfungsi, dan setelah Anda mengaktifkan relay lagi, perangkat tersebut harus diberi detail yang baru.",
  "relay.disable.yes": "Ya, nonaktifkan dan buang",
  "relay.disable.no": "Biarkan aktif",

  "relay.details.show": "Tampilkan detail relay untuk sebuah perangkat",
  "relay.details.hide": "Sembunyikan detail",
  "relay.details.title": "Detail untuk diberikan ke perangkat",
  "relay.details.intro":
    "Perangkat menyematkan data ini saat dipasangkan. Pemasangan itu sendiri adalah pemasangan tautan ponsel. Phoenix tidak memiliki kode atau tautan pemasangan untuk relay, jadi berikan nilai-nilai ini kepada perangkat dengan cara yang Anda percayai.",
  "relay.details.url": "Alamat relay",
  "relay.details.route": "Id rute",
  "relay.details.key": "Kunci publik relay komputer ini",
  "relay.details.warn":
    "Id rute adalah alamat, bukan kata sandi. Detail ini disembunyikan lagi saat Anda menutup panel ini, menonaktifkan relay, atau rute berubah.",

  "relay.devices.title": "Perangkat yang dipasangkan",
  "relay.devices.none":
    "Belum ada perangkat yang dipasangkan. Pasangkan satu di bagian tautan ponsel.",
  "relay.devices.note":
    "Ini adalah perangkat yang dipasangkan melalui tautan ponsel. Mencabut satu perangkat di sana akan menghentikannya di relay pada pesan berikutnya.",
  "relay.devices.loadFailed": "Perangkat yang dipasangkan tidak dapat dimuat.",
  "relay.devices.unnamed": "Perangkat tanpa nama",
  "relay.devices.fingerprint": "Sidik jari kunci",
  "relay.devices.revoked": "Dicabut {date}",
  "relay.devices.push": "Kirim persetujuan ke {name}",
  "relay.devices.pushed": "Persetujuan yang tertunda telah dikirim ke {name}.",
};
