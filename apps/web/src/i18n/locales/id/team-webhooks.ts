// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamWebhooks as enTeamWebhooks } from "../../en/team-webhooks";

/** Machine-translated; unreviewed. */
export const teamWebhooks: Record<keyof typeof enTeamWebhooks, string> = {
  "teamWebhooks.title": "Webhook masuk",
  "teamWebhooks.intro":
    "Webhook masuk nonaktif secara default. Sebuah sumber memberi alat lain alamat dan rahasianya sendiri; saat alat itu mengirim pesan yang ditandatangani dengan benar, Phoenix mengubahnya menjadi event lokal. Tidak ada yang dikirim ke mana pun, dan apa yang dikirim sumber diperlakukan sebagai teks yang tidak tepercaya.",
  "teamWebhooks.notAvailable":
    "Webhook masuk tidak tersedia: Phoenix Core ini tidak memiliki penyimpanan rahasia sistem operasi untuk menyimpan rahasia sumber.",
  "teamWebhooks.loadFailed": "Webhook masuk tidak dapat dimuat.",
  "teamWebhooks.master": "Terima webhook masuk",
  "teamWebhooks.secret.title": "Rahasia untuk {id}",
  "teamWebhooks.secret.warning":
    "Rahasia ini hanya ditampilkan sekali. Salin sekarang dan simpan di alat pengirim. Phoenix hanya menyimpannya di penyimpanan rahasia sistem operasi dan tidak dapat menampilkannya lagi; jika hilang, hapus sumber dan buat yang baru.",
  "teamWebhooks.secret.path": "Alamat tujuan pengiriman (di Core ini)",
  "teamWebhooks.secret.label": "Rahasia penandatanganan",
  "teamWebhooks.secret.copy": "Salin rahasia",
  "teamWebhooks.secret.copied": "Disalin ke papan klip.",
  "teamWebhooks.secret.copyFailed":
    "Phoenix tidak dapat memakai papan klip. Pilih rahasia di atas dan salin secara manual sebelum menutup.",
  "teamWebhooks.secret.done": "Sudah saya simpan, tutup",
  "teamWebhooks.sources.title": "Sumber",
  "teamWebhooks.sources.none": "Anda belum membuat sumber webhook apa pun.",
  "teamWebhooks.row.path": "Alamat: {path}",
  "teamWebhooks.row.types": "Jenis event: {types}",
  "teamWebhooks.row.never": "Belum ada yang diterima.",
  "teamWebhooks.row.last": "Terakhir diterima: {time}",
  "teamWebhooks.delete.label": "Hapus sumber {id}",
  "teamWebhooks.delete.ask":
    "Hapus {id}? Rahasianya langsung berhenti berfungsi dan alat pengirim harus diubah.",
  "teamWebhooks.create.title": "Buat sumber",
  "teamWebhooks.create.id": "Nama sumber",
  "teamWebhooks.create.idHint":
    "3 sampai 32 karakter: huruf kecil, angka, - atau _, diawali huruf.",
  "teamWebhooks.create.types": "Jenis event yang boleh dikirim",
  "teamWebhooks.create.typesHint":
    "Pisahkan dengan koma, misalnya ci.finished. Setiap jenis diawali salah satu dari: {namespaces}.",
  "teamWebhooks.create.typesTooMany": "Cantumkan paling banyak {max} jenis event.",
  "teamWebhooks.create.typesInvalid":
    "Jenis event adalah kata huruf kecil yang dihubungkan titik, seperti ci.finished.",
  "teamWebhooks.create.typesNamespace": "Jenis event harus diawali salah satu dari: {namespaces}.",
  "teamWebhooks.create.limit": "Anda mencapai batas {max} sumber. Hapus satu dulu.",
  "teamWebhooks.create.submit": "Buat sumber",
  "teamWebhooks.row.disabledNote":
    "Sumber ini dinonaktifkan: Phoenix menolak semua yang dikirim kepadanya.",
  "teamWebhooks.toggle.enable": "Aktifkan",
  "teamWebhooks.toggle.disable": "Nonaktifkan",
  "teamWebhooks.toggle.enableLabel": "Aktifkan sumber {id}",
  "teamWebhooks.toggle.disableLabel": "Nonaktifkan sumber {id}",
  "teamWebhooks.rotate.button": "Putar rahasia",
  "teamWebhooks.rotate.label": "Putar rahasia sumber {id}",
  "teamWebhooks.rotate.ask":
    "Putar rahasia {id}? Rahasia lama langsung berhenti berfungsi, sehingga alat pengirim ditolak sampai Anda memberinya rahasia baru.",
  "teamWebhooks.secret.rotatedNote":
    "Ini rahasia baru. Rahasia lama sudah berhenti berfungsi; perbarui alat pengirim dengan yang ini.",
};
