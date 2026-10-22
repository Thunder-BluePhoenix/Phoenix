// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { safety as ensafety } from "../../en/safety";

/** Machine-translated; unreviewed (see ../../README.md). */
export const safety: Record<keyof typeof ensafety, string> = {
  "safety.title": "Jaring pengaman agen",
  "safety.intro":
    "Sebelum edit pertama yang dilaporkan oleh agen pengodean dalam sebuah sesi, Phoenix menyimpan snapshot proyek di repositori git milik proyek itu sendiri (sebuah ref tersembunyi; branch, indeks, dan stash Anda tidak pernah disentuh). Anda dapat mengembalikan file ke snapshot itu, setelah pratinjau dan persetujuan Anda.",
  "safety.timing":
    "Claude Code melaporkan sebuah langkah setelah alat dijalankan, jadi snapshot diambil pada laporan edit pertama: edit pertama itu biasanya sudah ada di dalamnya. Pengembalian membatalkan apa yang dilakukan agen setelahnya, bukan edit pertama itu sendiri.",
  "safety.ignored":
    "File yang diabaikan git (hasil build, log, dependensi) tidak disimpan dan tidak pernah dipulihkan atau dihapus.",
  "safety.loadFailed": "Jaring pengaman tidak dapat dimuat: {error}",
  "safety.killSwitch": "Kill switch aktif, sehingga tidak ada checkpoint baru yang dibuat.",

  "safety.warnings.title": "Peringatan dari Fawkes",
  "safety.warnings.loop": "Perulangan",
  "safety.warnings.stall": "Macet",
  "safety.warnings.line": "{kind} · {agent} di {repository}: {reason}",

  "safety.checkpoints.title": "Checkpoint",
  "safety.checkpoints.none":
    "Belum ada checkpoint. Satu checkpoint dibuat saat edit pertama agen dilaporkan.",
  "safety.checkpoints.row": "{agent} di {repository}",
  "safety.checkpoints.facts":
    "Dibuat {taken} · {count, plural, other {# file}} · disimpan hingga {expires}",
  "safety.checkpoints.rolledBack": "Dikembalikan {when}",
  "safety.checkpoints.preview": "Pratinjau pengembalian…",
  "safety.checkpoints.previewLabel": "Pratinjau pengembalian ke checkpoint {agent} di {repository}",
  "safety.checkpoints.close": "Tutup pratinjau",

  "safety.skipped.title": "Sesi tanpa checkpoint",
  "safety.skipped.line": "{agent} di {repository}: {reason}",
  "safety.skipped.disabled": "jaring pengaman dimatikan",
  "safety.skipped.kill_switch": "kill switch sedang aktif",
  "safety.skipped.not_git": "folder ini bukan repositori git, jadi tidak ada yang bisa di-snapshot",
  "safety.skipped.git_unavailable": "git tidak dapat dijalankan",
  "safety.skipped.too_many_files": "proyek memiliki file lebih banyak daripada batas",
  "safety.skipped.too_large": "proyek lebih besar daripada batas ukuran",
  "safety.skipped.throttled":
    "titik pemeriksaan sudah dibuat di proyek ini dalam satu menit terakhir",
  "safety.skipped.snapshot_failed": "git tidak dapat mengambil snapshot",

  "safety.preview.title": "Pratinjau pengembalian",
  "safety.preview.counts":
    "{restore, plural, other {# file akan dipulihkan}}, {remove, plural, other {# file baru akan dihapus}}, {kept, plural, other {# perbedaan akan dibiarkan}}.",
  "safety.preview.restore": "Dipulihkan ke checkpoint",
  "safety.preview.remove": "File baru yang akan dihapus",
  "safety.preview.kept": "Dibiarkan",
  "safety.preview.change.modified": "diubah",
  "safety.preview.change.deleted": "dihapus oleh agen",
  "safety.preview.change.type_changed": "tipe berubah",
  "safety.preview.why.tracked_by_head": "dilacak oleh git, sehingga tidak dihapus",
  "safety.preview.why.ignored": "diabaikan oleh git",
  "safety.preview.why.submodule": "sebuah submodul",
  "safety.preview.why.unsafe_path": "path tidak aman untuk disentuh",
  "safety.preview.why.not_a_file": "bukan file biasa",
  "safety.preview.truncated": "Daftar dipotong; jumlah di atas akurat.",
  "safety.preview.diff": "Perubahan sejak checkpoint",
  "safety.preview.diffTruncated": "Diff dipotong pada batas ukurannya.",
  "safety.preview.diffRedacted": "Sebagian teks yang tampak seperti rahasia telah disamarkan.",
  "safety.preview.diffEmpty": "Tidak ada perubahan teks untuk ditampilkan.",
  "safety.preview.nothing":
    "File sudah sesuai dengan checkpoint. Tidak ada yang perlu dikembalikan.",
  "safety.preview.refusal.repository_missing":
    "Proyek ini tidak lagi menjadi repositori git di sini.",
  "safety.preview.refusal.checkpoint_gone": "Snapshot tidak lagi ada di repositori.",
  "safety.preview.refusal.head_moved":
    "HEAD repositori berpindah sejak checkpoint (sebuah commit atau pergantian branch). Phoenix tidak akan mengembalikan melewatinya; tidak ada yang diubah.",
  "safety.preview.refusal.snapshot_failed": "Git tidak dapat membaca working tree.",
  "safety.preview.approvalNote":
    "Pengembalian meminta persetujuan Anda terlebih dahulu. Pengembalian tidak pernah mengubah riwayat git, branch, indeks, atau stash, dan akan menolak jika file berubah setelah pratinjau ini.",

  "safety.rollback.button": "Kembalikan…",
  "safety.rollback.waiting": "Menunggu persetujuan Anda di daftar persetujuan di atas…",
  "safety.rollback.done":
    "Dikembalikan: {restored, plural, other {# file dipulihkan}}, {removed, plural, other {# file baru dihapus}}.",
  "safety.rollback.exact": "File kini sesuai dengan checkpoint.",
  "safety.rollback.inexact":
    "Beberapa perbedaan dibiarkan, sehingga file tidak sepenuhnya sesuai dengan checkpoint.",

  "safety.settings.title": "Pengaturan",
  "safety.settings.enabled": "Buat checkpoint saat edit pertama agen dilaporkan",
  "safety.settings.notify":
    "Kirim notifikasi saat Fawkes memperingatkan tentang perulangan atau kemacetan",
  "safety.settings.retention": "Simpan checkpoint selama (hari)",
  "safety.settings.maxFiles": "Lewati proyek dengan file lebih dari",
  "safety.settings.loopThreshold": "Peringatan perulangan setelah sekian kali pengulangan",
  "safety.settings.waitingMin": "Beri peringatan saat agen menunggu Anda selama (menit)",
  "safety.settings.idleMin": "Beri peringatan saat agen aktif diam selama (menit)",
  "safety.settings.saved": "Tersimpan.",
  "safety.settings.detectNote":
    "Hook tidak melaporkan kode keluar maupun isi file, jadi perulangan berarti perintah yang sama dijalankan berulang kali, atau file yang editnya terus saling membatalkan (berdasarkan jumlah baris).",
};
