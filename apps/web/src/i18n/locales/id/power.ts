// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { power as enpower } from "../../en/power";

/** Machine-translated; unreviewed (see ../../README.md). */
export const power: Record<keyof typeof enpower, string> = {
  "power.awake.duration.minutes": "{minutes, plural, other {# menit}}",
  "power.awake.duration.hours": "{hours, plural, other {# jam}}",
  "power.awake.heading": "Tetap menyala",
  "power.awake.disabled": "“Tetap menyala” dimatikan. Aktifkan kapabilitasnya untuk memakainya.",
  "power.awake.waiting": "Menunggu persetujuan Anda…",
  "power.awake.idle": "Komputer tidur seperti biasa. Mulai sesi berwaktu agar tetap menyala.",
  "power.awake.start.heading": "Tetap menyala selama",
  "power.awake.custom.label": "Menit",
  "power.awake.reason.label": "Alasan (opsional)",
  "power.awake.custom.start": "Mulai",
  "power.awake.custom.invalid": "Masukkan bilangan bulat menit antara {min} dan {max}.",
  "power.awake.agents.start": "Selama agen bekerja",
  "power.awake.agents.help":
    "Tetap menyala selama ada agen koding yang bekerja, dan berakhir beberapa menit setelah yang terakhir selesai (memakai menit di atas).",
  "power.awake.agents.working": "{count, plural, other {# agen bekerja}}",
  "power.awake.agents.grace":
    "Berakhir {minutes, plural, other {# menit}} setelah agen terakhir selesai.",
  "power.awake.running": "Menjaga komputer tetap menyala",
  "power.awake.remaining": "Sisa waktu: {time}",
  "power.awake.endsAt": "Berakhir pukul {time}",
  "power.awake.extend.label": "Tambah waktu",
  "power.awake.extend.button": "+{duration}",
  "power.awake.end.hold": "Tahan untuk mengakhiri",
  "power.awake.end.holding": "Terus tahan…",
  "power.awake.end.hint":
    "Tahan tombol selama 1,5 detik (atau tahan Spasi atau Enter) untuk mengakhiri sesi.",
  "power.awake.battery":
    "Sesi juga berakhir jika baterai turun di bawah {percent}% saat tidak dicolokkan.",
  "power.awake.lid":
    "Menutup layar tetap membuat komputer tidur; tetap menyala dengan layar tertutup memerlukan mode layar tertutup yang terpisah.",
  "power.awake.indicator": "Menyala {time}",
  "power.recovery.heading": "Mode layar tertutup dan pemulihan",
  "power.recovery.waiting": "Menunggu persetujuan Anda…",
  "power.recovery.unreadable": "Status pemulihan tidak dapat dibaca.",
  "power.recovery.journal.clean": "Tidak ada yang menunggu untuk dibatalkan.",
  "power.recovery.journal.pending":
    "Phoenix tidak dapat memulihkan {count, plural, other {# perubahan sistem}}. Pengaturan tidur mungkin masih berubah.",
  "power.recovery.journal.kind.disablesleep": "Tidak tidur saat layar tertutup",
  "power.recovery.journal.kind.lowpowermode": "Mode Daya Rendah",
  "power.recovery.journal.kind.other": "Perubahan lain",
  "power.recovery.journal.at": "sejak {time}",
  "power.recovery.journal.undo": "Batalkan sekarang",
  "power.recovery.journal.untrusted":
    "{count, plural, other {# baris jurnal tidak terbaca}} diabaikan dan tidak dipercaya.",
  "power.recovery.journal.cannotQuit": "Keluar dari Phoenix ditolak sampai ini dibatalkan.",
  "power.recovery.lid.open": "Layar terbuka.",
  "power.recovery.lid.closed": "Layar tertutup.",
  "power.recovery.lid.unknown": "Status layar tidak diketahui.",
  "power.recovery.lid.unsupported":
    "Komputer ini tidak punya sensor layar, jadi mode layar tertutup tidak tersedia.",
  "power.recovery.helper.installed": "Pembantu berhak istimewa terpasang",
  "power.recovery.helper.missing":
    "Pembantu berhak istimewa belum terpasang (mode layar tertutup tidak tersedia). Lihat docs/awake-helper.md.",
  "power.recovery.helper.unknown": "Tidak diketahui apakah pembantu berhak istimewa terpasang.",
  "power.recovery.floors.off": "Batas bawah nonaktif",
  "power.recovery.floors.rule":
    "Mode Daya Rendah di bawah {low} %, akhiri sesi di bawah {end} %; panas: Mode Daya Rendah pada {heatLow}, akhiri pada {heatEnd}.",
  "power.recovery.floors.lowPowerActive": "Mode Daya Rendah aktif",
  "power.recovery.floors.battery.none": "Baterai: tidak ada",
  "power.recovery.floors.battery.unknown": "Baterai: tidak diketahui",
  "power.recovery.floors.battery.level": "Baterai {percent} %",
  "power.recovery.floors.battery.unplugged": "Baterai {percent} %, tidak dicolokkan",
  "power.recovery.floors.battery.plugged": "Baterai {percent} %, dicolokkan",
  "power.recovery.floors.thermal.nominal": "normal",
  "power.recovery.floors.thermal.fair": "hangat",
  "power.recovery.floors.thermal.serious": "panas",
  "power.recovery.floors.thermal.critical": "kritis",
  "power.recovery.floors.thermal.level": "Panas: {level}",
  "power.recovery.floors.thermal.unsupported": "Panas: tidak dilaporkan",
  "power.recovery.floors.thermal.unknown": "Panas: tidak diketahui",
  "power.recovery.safety.warning":
    "Jangan pernah membawa komputer di dalam tas, casing, atau ruang tertutup lain saat mode layar tertutup aktif: komputer bisa terlalu panas. Biarkan ventilasi tetap terbuka.",
  "power.recovery.safety.understand": "Saya mengerti",
  "power.recovery.safety.acknowledge": "Akui",
  "power.recovery.safety.done": "Anda telah mengakui peringatan keselamatan layar tertutup.",
  "power.recovery.start": "Mulai mode layar tertutup",
  "power.recovery.end": "Akhiri mode layar tertutup",
  "power.recovery.engaged": "Mode layar tertutup aktif.",
  "power.recovery.engagedSince": "Mode layar tertutup aktif sejak {time}.",
  "power.recovery.needsSession":
    "Mulai dulu sesi tetap menyala; mode layar tertutup membutuhkannya.",
  "power.continuity.heading": "Kelangsungan agen",
  "power.continuity.intro":
    "Fitur tambahan untuk proses agen yang berjalan lama. Setiap fitur nonaktif sampai Anda mengaktifkannya, dan tidak ada satu pun yang memilihkan jaringan, terminal, atau program untuk Anda.",
  "power.continuity.needsAwake":
    "Pengaturan ini hanya berlaku saat kemampuan Keep awake diaktifkan.",
  "power.continuity.saved": "Tersimpan. Perubahan berlaku saat Keep awake dimulai berikutnya.",
  "power.continuity.applyNote":
    "Perubahan disimpan ke kemampuan Keep awake dan berlaku saat kemampuan itu diaktifkan berikutnya.",
  "power.continuity.network.title": "Pemantauan jaringan",
  "power.continuity.network.help":
    "Memeriksa setiap beberapa detik apakah komputer yang Anda sebutkan dapat dijangkau, dan memberi tahu Phoenix saat jaringan terputus dan saat tersambung kembali. Fitur ini hanya menyambung; tidak mengirim maupun membaca apa pun.",
  "power.continuity.hosts.label": "Host yang diperiksa (nama atau nama:port)",
  "power.continuity.hotspot.title": "Failover hotspot",
  "power.continuity.hotspot.help":
    "Saat Wi-Fi terputus selagi sesi keep-awake berjalan, sambungkan ke hotspot iPhone yang Anda sebutkan. Memerlukan pemantauan jaringan di atas dan daftar host. Hanya berfungsi di macOS dan belum diuji pada Mac sungguhan.",
  "power.continuity.hotspot.ssid": "Nama hotspot (SSID)",
  "power.continuity.hotspot.disclosure":
    "Sebelum Anda mengaktifkan ini: macOS dapat menyambung ke jaringan yang sudah dikenalnya tanpa kata sandi di baris perintah, jadi sambungkan hotspot Anda secara manual satu kali terlebih dahulu. Hanya jika Anda juga mengizinkan kata sandi tersimpan di bawah, Phoenix akan meneruskannya ke alat networksetup milik macOS, dan selama beberapa detik proses penyambungan berlangsung, setiap program di Mac ini dapat membacanya pada baris perintah tersebut. Tidak ada cara bawaan yang lebih aman untuk melakukan ini tanpa meminta kata sandi Anda. Tolak jika hal itu tidak dapat diterima.",
  "power.continuity.hotspot.allowPassword":
    "Saya menerima ini: gunakan kata sandi hotspot yang tersimpan pada baris perintah",
  "power.continuity.hotspot.passwordSaved": "Kata sandi hotspot tersimpan di keychain.",
  "power.continuity.hotspot.passwordMissing":
    "Tidak ada kata sandi hotspot yang tersimpan. Simpan satu sebagai rahasia “hotspot_password” pada kemampuan Keep awake, atau biarkan kotak ini nonaktif dan sambungkan hotspot secara manual satu kali.",
  "power.continuity.hotspot.join": "Sambungkan ke hotspot sekarang",
  "power.continuity.hotspot.rejoin": "Sambungkan kembali ke jaringan saya sebelumnya",
  "power.continuity.hotspot.confirmNote":
    "Menyambung ke jaringan mengubah Wi-Fi yang digunakan Mac ini. Phoenix meminta konfirmasi Anda setiap kali.",
  "power.continuity.hotspot.joined": "Tersambung.",
  "power.continuity.nudge.title": "Colek agen",
  "power.continuity.nudge.help":
    "Jika tidak ada jaringan selama waktu di bawah, ketik “continue” ke terminal yang Anda daftarkan. Tidak ada yang diketik saat rapat atau dikte berlangsung, dan setiap terminal menerimanya paling banyak satu kali per gangguan.",
  "power.continuity.nudge.after": "Detik tanpa jaringan sebelum mencolek (30 sampai 3600)",
  "power.continuity.nudge.panes": "Pane tmux (misalnya %12)",
  "power.continuity.nudge.sessions": "Sesi agen Phoenix (ph- dan 16 digit heksadesimal)",
  "power.continuity.nudge.sessionsNote":
    "Belum tersedia: Phoenix belum punya cara aman untuk mengetik ke sesi yang dilacak, jadi sesi yang terdaftar dilewati dan dilaporkan. Hanya pane tmux yang dicolek.",
  "power.continuity.nudge.commands": "Program yang mungkin berjalan di pane (misalnya claude)",
  "power.continuity.nudge.commandsNote":
    "Phoenix memeriksa bahwa pane masih ada dan menjalankan salah satu program ini sebelum mengetik. Jika daftar kosong, tidak ada yang pernah diketik.",
  "power.continuity.nudge.enter": "Tekan juga Enter",
  "power.continuity.nudge.enterHelp":
    "Nonaktif secara default. Tanpa ini “continue” diketik tetapi tidak dikirim, sehingga Anda menekan Enter sendiri.",
  "power.continuity.throttle.title": "Pemeriksaan pembatasan browser",
  "power.continuity.throttle.help":
    "Chrome, Arc, Comet, Edge, dan Brave memperlambat tab latar belakang, yang dapat membuat halaman web agen macet. Ini mencantumkan browser yang berjalan seperti itu. Browser tidak akan pernah diubah kecuali Anda memilih Luncurkan ulang dan mengonfirmasi.",
  "power.continuity.throttle.unsupported": "Pemeriksaan browser hanya berfungsi di macOS.",
  "power.continuity.throttle.notRunning": "tidak berjalan",
  "power.continuity.throttle.throttled": "berjalan dengan pembatasan latar belakang",
  "power.continuity.throttle.fine": "berjalan tanpa pembatasan",
  "power.continuity.throttle.relaunch": "Luncurkan ulang {name} tanpa pembatasan",
  "power.continuity.throttle.confirm":
    "Luncurkan ulang {name} tanpa pembatasan latar belakang? {name} akan ditutup dan dibuka kembali, tab-nya akan dimuat ulang, dan apa pun yang belum disimpan di halaman dapat hilang. Ini ditolak saat rapat atau dikte berlangsung.",
  "power.continuity.throttle.confirmYes": "Tutup dan luncurkan ulang",
  "power.continuity.throttle.relaunched": "{name} telah diluncurkan ulang.",
  "power.continuity.outage.title": "Gangguan jaringan terakhir",
  "power.continuity.outage.none": "Belum ada gangguan jaringan yang terlihat.",
  "power.continuity.outage.down": "Jaringan terputus sejak {time}.",
  "power.continuity.outage.ended": "Jaringan terputus dari {from} sampai {to}.",
  "power.continuity.outage.nudged": "{count, plural, other {# terminal dicolek}}",
  "power.continuity.outage.hotspot.joined": "Hotspot tersambung",
  "power.continuity.outage.hotspot.failed": "Gagal menyambung ke hotspot",
  "power.continuity.outage.hotspot.skipped":
    "Hotspot tidak dicoba (nonaktif, atau tidak ada sesi yang berjalan)",
  "power.continuity.outage.hotspot.notTried": "Hotspot belum dicoba",
  "power.continuity.list.empty": "Tidak ada yang terdaftar.",
  "power.continuity.list.remove": "Hapus {item}",
  "power.continuity.invalid.host":
    "Gunakan nama host atau alamat, dengan :port opsional (1 sampai 65535).",
  "power.continuity.invalid.pane":
    "Gunakan id pane tmux seperti %12: tanda persen dan hingga enam digit.",
  "power.continuity.invalid.session": "Gunakan id sesi seperti ph-0123456789abcdef.",
  "power.continuity.invalid.command":
    "Gunakan nama program seperti claude: hanya huruf, angka, dan . _ + -",
  "power.continuity.invalid.ssid":
    "Gunakan 1 sampai 32 byte teks yang terlihat dan tidak diawali tanda hubung.",
  "power.continuity.invalid.seconds": "Masukkan bilangan bulat detik dari {min} sampai {max}.",
  "power.continuity.problem.duplicate": "Entri itu sudah ada dalam daftar.",
  "power.continuity.problem.full": "Daftar sudah penuh (paling banyak {max} entri).",
  "power.continuity.reason.unsupported_platform": "Ini hanya berfungsi di macOS.",
  "power.continuity.reason.no_wifi_device":
    "Phoenix tidak dapat menemukan perangkat Wi-Fi Mac ini.",
  "power.continuity.reason.no_hotspot_configured":
    "Tidak ada hotspot atau jaringan sebelumnya yang dapat digunakan untuk disambungi.",
  "power.continuity.reason.bad_password":
    "Kata sandi yang tersimpan tidak dapat digunakan. Periksa di keychain.",
  "power.continuity.reason.join_failed": "macOS tidak dapat menyambung ke jaringan.",
  "power.continuity.reason.unknown_browser": "Browser itu bukan salah satu yang dikelola Phoenix.",
  "power.continuity.reason.protected": "Tidak sekarang: rapat atau dikte sedang berlangsung.",
  "power.continuity.reason.not_running": "Browser itu tidak berjalan.",
  "power.continuity.reason.already_unthrottled":
    "Browser itu sudah berjalan tanpa pembatasan latar belakang.",
  "power.continuity.reason.unavailable": "Ini tidak tersedia saat ini.",
  "power.continuity.reason.quit_failed": "Browser tidak menerima permintaan untuk keluar.",
  "power.continuity.reason.still_running":
    "Browser masih terbuka, jadi tidak dibuka kembali. Tutup sendiri, lalu coba lagi.",
  "power.continuity.reason.open_failed": "Browser keluar tetapi tidak dapat dibuka kembali.",
  "power.continuity.reason.other": "Itu tidak berhasil.",
  "power.lid.heading": "Tindakan saat penutup ditutup",
  "power.lid.intro":
    "Saat sesi tetap aktif berjalan dan Anda menutup penutup laptop, Phoenix dapat menghemat daya dan menenangkan komputer ini. Semuanya dibatalkan saat penutup dibuka, saat sesi berakhir, dan saat Phoenix dimulai lagi setelah crash.",
  "power.lid.needsAwake": "Tindakan ini hanya berjalan saat kemampuan Tetap aktif diaktifkan.",
  "power.lid.master.title": "Jalankan tindakan saat penutup ditutup",
  "power.lid.master.help": "Sakelar utama. Jika mati, tidak ada yang di bawah ini berjalan.",
  "power.lid.display.title": "Matikan layar",
  "power.lid.display.help":
    "Menidurkan layar. Kecerahan disimpan dan dipulihkan jika alat kecerahan gratis terpasang.",
  "power.lid.freeze.title": "Bekukan aplikasi obrolan",
  "power.lid.freeze.help":
    "Menjeda aplikasi obrolan yang dipilih agar tidak memakai daya, lalu melanjutkannya. Tidak pernah saat Anda rapat, merekam, atau mendikte, dan tidak pernah untuk terminal, editor, atau agen pengodean yang berjalan.",
  "power.lid.freeze.apps": "Aplikasi yang dibekukan",
  "power.lid.mute.title": "Bisukan suara",
  "power.lid.mute.help":
    "Membisukan keluaran suara dan memulihkannya persis seperti semula, meskipun Anda berganti keluaran di antaranya.",
  "power.lid.lowPower.title": "Mode Daya Rendah",
  "power.lid.lowPower.help":
    "Mengaktifkan Mode Daya Rendah. Perlu pembantu berhak istimewa opsional; tanpa itu, dilewati.",
  "power.lid.docker.title": "Bekukan Docker Desktop",
  "power.lid.docker.help":
    "Menjeda Docker Desktop selama tidak ada kontainer berjalan. Tidak pernah jika ada kontainer berjalan atau status Docker tidak diketahui.",
  "power.lid.nap.title": "Jauhkan aplikasi agen dari App Nap",
  "power.lid.nap.help":
    "Mencegah macOS memperlambat aplikasi yang Anda daftarkan. Pengaturan sebelumnya disimpan dan dikembalikan persis.",
  "power.lid.nap.apps": "Aplikasi (bundle id, misalnya com.example.App)",
  "power.lid.protected.title": "Tidak pernah dibekukan",
  "power.lid.protected.help":
    "Ini selalu dibiarkan. Anda dapat menambah daftar, tetapi perlindungan bawaan tidak dapat dihapus.",
  "power.lid.protected.builtIn": "Bawaan",
  "power.lid.protected.extra": "Tambahkan nama program atau aplikasi",
  "power.lid.list.empty": "Belum ada yang ditambahkan.",
  "power.lid.list.remove": "Hapus {item}",
  "power.lid.list.duplicate": "Sudah ada dalam daftar.",
  "power.lid.list.full": "Daftar penuh ({max} entri).",
  "power.lid.invalid.bundle":
    "Gunakan bundle id seperti com.example.App: huruf, angka, dan tanda hubung, dengan minimal satu titik.",
  "power.lid.invalid.name":
    "Gunakan nama program atau aplikasi biasa: huruf, angka, spasi, dan . _ + -",
  "power.lid.unsupported": "Tidak tersedia di sini: {reason}",
  "power.lid.gapNote":
    "Sebagian hanya berfungsi sebagian di komputer ini. Lihat README-lid.md untuk apa yang didukung dan tidak.",
  "power.lid.last.title": "Peristiwa penutup terakhir",
  "power.lid.last.closed": "Penutup ditutup pada {time}.",
  "power.lid.last.opened": "Penutup dibuka pada {time}.",
  "power.lid.last.none": "Belum ada yang terjadi.",
  "power.lid.last.mismatched":
    "{count, plural, other {# proses tidak dilanjutkan karena tidak lagi cocok dengan yang dibekukan Phoenix.}}",
  "power.lid.last.stillClosed": "Penutup sedang tertutup dan tindakan di atas diterapkan.",
  "power.lid.outcome.applied": "Selesai",
  "power.lid.outcome.skipped": "Dilewati",
  "power.lid.outcome.failed": "Gagal",
  "power.lid.outcome.undone": "Dibatalkan",
  "power.lid.outcome.undo_failed": "Tidak dapat dibatalkan (Phoenix akan mencoba lagi)",
  "power.lid.reason.unsupported_platform": "Hanya didukung di Mac.",
  "power.lid.reason.helper_unavailable": "Pembantu berhak istimewa belum terpasang.",
  "power.lid.reason.tool_missing": "Alat yang dibutuhkan belum terpasang.",
  "power.lid.reason.already_on": "Sudah aktif karena alasan lain.",
  "power.lid.reason.state_unknown":
    "Phoenix tidak dapat mengetahui apakah Anda sedang rapat, jadi tidak melakukan apa pun.",
  "power.lid.reason.protected_state": "Rapat, perekaman, atau dikte sedang berlangsung.",
  "power.lid.reason.docker_busy": "Ada kontainer yang berjalan.",
  "power.lid.reason.docker_unknown": "Status Docker tidak diketahui.",
  "power.lid.reason.process_list_unavailable": "Daftar program yang berjalan tidak dapat dibaca.",
  "power.lid.reason.audio_unavailable": "Keluaran suara tidak dapat dibaca.",
  "power.lid.reason.no_targets": "Tidak ada yang perlu diubah.",
  "power.lid.reason.nothing_to_do": "Tidak ada yang perlu diubah.",
  "power.lid.reason.journal_unwritable":
    "Jurnal pemulihan tidak dapat ditulis, jadi tidak ada yang diubah.",
  "power.lid.reason.not_applied": "Tidak ada yang diubah.",
  "power.lid.reason.apply_failed": "Perubahan tidak dapat dilakukan.",
  "power.lid.reason.undo_failed": "Perubahan tidak dapat dibatalkan.",
  "power.lid.reason.assertions_unknown":
    "Phoenix tidak dapat mengetahui apakah sebuah app sedang dalam panggilan, jadi tidak ada yang dibekukan.",
  "power.lid.reason.holds_assertion":
    "Semua app obrolan sedang dipakai (panggilan atau pemutaran), jadi tidak ada yang dibekukan.",
  "power.lid.reason.output_changed":
    "Keluaran suara diganti saat penutup tertutup, jadi Phoenix tidak menyentuh keluaran baru. Keluaran yang dibisukannya tetap bisu sampai menjadi default lagi.",
  "power.lid.reason.retry_or_alert":
    "App yang dibekukan tampaknya dimulai ulang, jadi Phoenix tidak melanjutkannya. Pastikan app obrolan Anda berjalan normal.",
  "power.lid.reason.not_ours":
    "Beberapa proses tidak dapat dilanjutkan karena bukan wewenang Phoenix.",
  "power.lid.limit.output_identity_unknown":
    "Phoenix tidak dapat membaca nama keluaran suara, jadi tidak tahu apakah keluaran berubah.",
  "power.lid.limit.brightness_tool_untrusted":
    "File alat kecerahan tidak aman dijalankan (pemilik salah, atau dapat ditulis orang lain), jadi tidak dipakai.",
  "power.lid.reason.other": "Itu tidak berhasil.",
  "power.lid.limit.brightness_tool_missing":
    "Alat kecerahan gratis belum terpasang, jadi hanya tidur layar yang dipakai dan kecerahan tidak diubah.",
  "power.lid.limit.keyboard_backlight_unsupported":
    "Lampu keyboard tidak dapat dikendalikan tanpa perangkat lunak pihak ketiga.",
  "power.lid.limit.default_output_only": "Hanya keluaran default saat ini yang dapat dibisukan.",
  "power.lid.applyNote":
    "Perubahan berlaku saat sesi berikutnya melihat penutup ditutup. Semuanya dicatat di jurnal sebelum dilakukan.",
  "power.lid.saved": "Tersimpan.",
  "power.lid.glance.closed": "Penutup tertutup: tindakan penutupan diterapkan.",
  "power.lid.glance.failed":
    "Satu tindakan penutupan tidak dapat dibatalkan. Buka Tetap aktif untuk detailnya.",
};
