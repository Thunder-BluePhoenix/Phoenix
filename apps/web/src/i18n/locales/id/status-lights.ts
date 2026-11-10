// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { statusLights as enStatusLights } from "../../en/status-lights";

/** Machine-translated; unreviewed. */
export const statusLights: Record<keyof typeof enStatusLights, string> = {
  "statusLights.limits":
    "Hanya warna tetap yang dikirim, tidak pernah teks apa pun. Kredensial (kunci aplikasi Hue, token Luxafor) bersifat hanya-tulis: setelah disimpan, kredensial tidak akan ditampilkan lagi. Nama dan id yang dilaporkan lampu ditampilkan sebagai teks biasa.",
  "statusLights.line.luxafor": "Aplikasi Luxafor di {address}",
  "statusLights.line.hue": "Lampu Hue pada bridge {bridge}",

  "statusLights.error.unavailable":
    "Phoenix Core ini tidak memiliki penyimpanan kredensial OS, sehingga kredensial tidak dapat disimpan.",
  "statusLights.error.save": "Daftar lampu tidak dapat disimpan. Periksa nama dan alamatnya.",
  "statusLights.error.capability": "Pengaturan Lampu status tidak dapat diubah.",
  "statusLights.error.hueName":
    "Beri bridge nama berisi huruf, angka, dan . _ : - (maksimal 160 karakter).",
  "statusLights.error.hueInspect":
    "Bridge tidak menjawab di alamat tersebut. Gunakan alamat IPv4-nya di jaringan Anda sendiri.",
  "statusLights.error.huePair":
    "Pemasangan gagal. Tekan tombol tautan bundar pada bridge, lalu coba lagi.",
  "statusLights.error.hueRemove": "Bridge tidak dapat dihapus.",
  "statusLights.error.hueLights": "Lampu pada bridge ini tidak dapat didaftar.",
  "statusLights.error.luxaforToken":
    "Token tidak disimpan. Token harus terdiri dari 1 sampai 128 karakter yang dapat dicetak tanpa spasi.",
  "statusLights.error.lifx": "Penemuan LIFX tidak selesai. Tunggu beberapa detik lalu coba lagi.",
  "statusLights.error.quietInvalid":
    "Masukkan dua waktu dan zona waktu yang valid, misalnya Europe/Paris.",

  "statusLights.hue.title": "Philips Hue",
  "statusLights.hue.notAvailable":
    "Hue tidak tersedia: Phoenix Core ini tidak memiliki penyimpanan kredensial OS.",
  "statusLights.hue.loadFailed": "Bridge Hue tidak dapat dimuat.",
  "statusLights.hue.intro":
    "Bridge yang dipasangkan hanya dipercaya selama ia menyajikan sertifikat yang sidik jari SHA-256-nya telah Anda konfirmasi. Kunci aplikasinya disimpan di penyimpanan kredensial OS Anda dan tidak pernah ditampilkan.",
  "statusLights.hue.empty": "Belum ada bridge yang dipasangkan.",
  "statusLights.hue.bridgeLine": "di {address}:{port}",
  "statusLights.hue.fingerprint": "Sidik jari SHA-256:",
  "statusLights.hue.find": "Tampilkan lampu",
  "statusLights.hue.findNamed": "Tampilkan lampu pada bridge {name}",
  "statusLights.hue.remove": "Hapus bridge",
  "statusLights.hue.removeNamed": "Hapus bridge {name}",
  "statusLights.hue.removeNote":
    "Menghapus bridge akan menghapus kunci yang tersimpan. Lampu yang menggunakannya tidak lagi dihubungi.",
  "statusLights.hue.noLights": "Bridge ini tidak melaporkan lampu apa pun.",
  "statusLights.hue.alreadyAdded": "Ditambahkan",
  "statusLights.hue.add": "Tambah",
  "statusLights.hue.addNamed": "Tambah lampu Hue {name}",
  "statusLights.hue.pairTitle": "Pasangkan bridge",
  "statusLights.hue.name": "Nama untuk bridge ini",
  "statusLights.hue.address": "Alamat bridge di jaringan Anda (misalnya 192.168.1.2)",
  "statusLights.hue.lookup": "Baca sertifikat bridge",
  "statusLights.hue.confirmGroup": "Konfirmasi sertifikat bridge",
  "statusLights.hue.found": "Sebuah bridge menjawab di {address}:{port}.",
  "statusLights.hue.certName": "Subjek sertifikat: {name}",
  "statusLights.hue.linkStep":
    "Tekan tombol tautan bundar di bagian atas bridge sekarang, lalu konfirmasi di bawah. Pemasangan ditolak kecuali tombol ditekan dalam sekitar 30 detik terakhir.",
  "statusLights.hue.confirm":
    "Saya telah membandingkan sidik jari ini dengan yang ada di bridge saya, dan saya mempercayai bridge ini.",
  "statusLights.hue.pair": "Pasangkan dan sematkan sidik jari ini",
  "statusLights.hue.cancel": "Batal",

  "statusLights.luxafor.title": "Luxafor",
  "statusLights.luxafor.intro":
    "Phoenix hanya berkomunikasi dengan webhook lokal aplikasi Luxafor, melalui HTTP biasa di jaringan Anda sendiri. Aplikasi selalu menjawab berhasil apa pun tokennya, sehingga token yang tersimpan tidak membuktikan bahwa lampu berubah.",
  "statusLights.luxafor.name": "Nama lampu Luxafor ini",
  "statusLights.luxafor.address": "Alamat komputer yang menjalankan aplikasi Luxafor",
  "statusLights.luxafor.add": "Tambah lampu Luxafor",
  "statusLights.luxafor.token": "Token webhook",
  "statusLights.luxafor.tokenNamed": "Token webhook untuk {name}",
  "statusLights.luxafor.save": "Atur atau ganti token",
  "statusLights.luxafor.saved": "Token disimpan.",
  "statusLights.luxafor.writeOnly":
    "Token tidak akan ditampilkan lagi. Untuk menghapusnya, hapus lampu ini.",

  "statusLights.lifx.title": "LIFX",
  "statusLights.lifx.intro":
    "Penemuan mengirim satu siaran di jaringan Anda dan mendaftar lampu yang menjawab. Tidak ada yang ditambahkan dan tidak ada warna yang dikirim sampai Anda mengaktifkan sebuah lampu.",
  "statusLights.lifx.discover": "Temukan lampu LIFX",
  "statusLights.lifx.none": "Tidak ada lampu LIFX yang menjawab.",
  "statusLights.lifx.line": "Lampu LIFX {serial} di {address}",
  "statusLights.lifx.added": "Ditambahkan",
  "statusLights.lifx.enable": "Tambah lampu ini",
  "statusLights.lifx.enableNamed": "Tambah lampu LIFX {serial}",

  "statusLights.quiet.title": "Jam tenang",
  "statusLights.quiet.intro":
    "Lampu tetap mati di antara waktu-waktu ini, dalam zona waktu yang Anda pilih.",
  "statusLights.quiet.off": "Jam tenang nonaktif.",
  "statusLights.quiet.on": "Lampu mati dari {start} sampai {end} ({timezone}).",
  "statusLights.quiet.start": "Dari",
  "statusLights.quiet.end": "Sampai",
  "statusLights.quiet.timezone": "Zona waktu",
  "statusLights.quiet.save": "Simpan jam tenang",
  "statusLights.quiet.clear": "Matikan jam tenang",
};
