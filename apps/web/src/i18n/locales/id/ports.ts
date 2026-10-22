// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ports as enports } from "../../en/ports";

/** Machine-translated; unreviewed (see ../../README.md). */
export const ports: Record<keyof typeof enports, string> = {
  "ports.title": "Radar port",
  "ports.intro":
    "Menampilkan program apa yang mendengarkan port jaringan di komputer ini, berjalan di proyek mana, dan sudah berapa lama. Pemindaian hanya membaca; tidak ada yang berubah kecuali Anda menghentikan program dan menyetujuinya.",
  "ports.disabled":
    "Radar port mati. Aktifkan kemampuan Radar port dan proses untuk menggunakannya.",
  "ports.scan": "Pindai sekarang",
  "ports.scanning": "Memindai…",
  "ports.notScanned": "Belum ada yang dipindai. Pilih Pindai sekarang.",
  "ports.empty": "Tidak ada program yang mendengarkan port.",
  "ports.loadError": "Port tidak dapat dibaca.",
  "ports.scannedAt": "Dipindai pukul {time}",
  "ports.count": "{count, plural, other {# port mendengarkan}}",
  "ports.table.caption": "Port yang mendengarkan",
  "ports.col.port": "Port",
  "ports.col.process": "Program",
  "ports.col.project": "Proyek",
  "ports.col.age": "Berjalan selama",
  "ports.col.notes": "Catatan",
  "ports.col.actions": "Tindakan",
  "ports.pid": "proses {pid}",
  "ports.age.unknown": "tidak diketahui",
  "ports.age.minutes": "{count, plural, other {# menit}}",
  "ports.age.hours": "{count, plural, other {# jam}}",
  "ports.age.days": "{count, plural, other {# hari}}",
  "ports.project.none": "tanpa proyek",
  "ports.exposure.all": "dapat dijangkau dari jaringan",
  "ports.exposure.loopback": "hanya komputer ini",
  "ports.exposure.interface": "satu alamat jaringan",
  "ports.flag.forgotten": "Mungkin terlupakan",
  "ports.flag.heavy": "Berat",
  "ports.flag.core": "Phoenix sendiri",
  "ports.usage": "CPU {percent}%, memori {mb} MB",
  "ports.help.forgotten":
    "Mungkin terlupakan: berjalan di folder proyek dan sudah berjalan lebih dari {hours, plural, other {# jam}}. Phoenix tidak dapat mengetahui apakah masih ada yang memakainya.",
  "ports.help.heavy":
    "Berat: CPU {cpu}% atau lebih, atau memori {mb} MB atau lebih, menurut ps (rata-rata, bukan bacaan langsung).",
  "ports.open": "Buka di peramban",
  "ports.open.label": "Buka {name} di port {port} di peramban bawaan Anda",
  "ports.openNote":
    "Tautan membuka http://127.0.0.1 di peramban bawaan Anda. Phoenix belum memiliki peramban sendiri.",
  "ports.stop": "Hentikan…",
  "ports.stop.label": "Hentikan {name} di port {port}",
  "ports.refusal.self": "Ini Phoenix sendiri, yang tidak pernah menghentikan dirinya sendiri.",
  "ports.refusal.other_user": "Milik pengguna lain.",
  "ports.refusal.system": "Ini proses sistem.",
  "ports.refusal.not_dev_tool": "Ini bukan alat pengembang yang boleh dihentikan Phoenix.",
  "ports.refusal.unsupported": "Menghentikan tidak tersedia di sistem ini.",
  "ports.refusal.unknown":
    "Phoenix tidak dapat memeriksa proses ini, jadi tidak akan menghentikannya.",
  "ports.confirm.title": "Hentikan {name} di port {port}?",
  "ports.confirm.body":
    "Setelah Anda menyetujui, Phoenix meminta {name} (proses {pid}) untuk keluar. Program dapat kehilangan pekerjaan yang belum disimpan.",
  "ports.confirm.go": "Minta berhenti",
  "ports.confirm.cancel": "Batal",
  "ports.stop.waiting": "Menunggu persetujuan Anda di Persetujuan…",
  "ports.stop.exited": "{name} dihentikan.",
  "ports.stop.stillRunning":
    "{name} sudah diminta keluar dan masih berjalan. Paksa henti mengakhirinya seketika, tidak dapat dibatalkan, dan dapat menghilangkan data.",
  "ports.force": "Paksa henti…",
  "ports.force.label": "Paksa hentikan {name} di port {port}",
  "ports.force.hint":
    "Phoenix menolak paksa henti selama beberapa detik pertama setelah permintaan untuk keluar.",
  "ports.force.confirm": "Paksa henti",
  "ports.restart.note":
    "Memulai ulang tidak tersedia: Phoenix tidak dapat menyusun ulang perintah asli program dengan aman.",
  "ports.watch.label": "Segarkan otomatis selama Phoenix terbuka",
  "ports.watch.help":
    "Mati secara bawaan. Jika aktif, Phoenix membaca daftar port setiap 15 detik, hanya saat ada jendela Phoenix yang terbuka.",
  "ports.noProcessTable":
    "Daftar proses tidak dapat dibaca, sehingga lama berjalan dan penghentian tidak tersedia.",
  "ports.parseWarnings":
    "Beberapa baris daftar proses atau port sistem tidak dipahami dan dilewati (nama program bisa berisi baris baru). Program mungkin hilang atau tidak bisa dihentikan di sini; saat menghentikan, semuanya diperiksa ulang.",
  "ports.windows.note":
    "Di Windows radar hanya menampilkan port dan nama program; lama berjalan, proyek, dan penghentian tidak tersedia.",
};
