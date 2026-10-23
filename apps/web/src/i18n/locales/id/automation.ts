// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { automation as enAutomation } from "../../en/automation";

/** Machine-translated; unreviewed (see ../../README.md). */
export const automation: Record<keyof typeof enAutomation, string> = {
  // ---- workflows: tables and checks (core/workflows.ts) ----
  "automation.workflows.environment.local": "Lokal",
  "automation.workflows.environment.dev": "Pengembangan",
  "automation.workflows.environment.staging": "Staging",
  "automation.workflows.environment.production": "PRODUKSI",
  "automation.workflows.environment.productionLive": "PRODUKSI (mengubah sistem yang sedang aktif)",

  "automation.workflows.runStatus.queued": "Dalam antrean",
  "automation.workflows.runStatus.running": "Berjalan",
  "automation.workflows.runStatus.waiting_approval": "Menunggu persetujuan Anda",
  "automation.workflows.runStatus.compensating": "Membatalkan langkah sebelumnya",
  "automation.workflows.runStatus.succeeded": "Berhasil",
  "automation.workflows.runStatus.rejected": "Ditolak oleh Anda",
  "automation.workflows.runStatus.failed": "Gagal",
  "automation.workflows.runStatus.failed_needs_attention": "Gagal: perlu perhatian Anda",
  "automation.workflows.runStatus.cancelled": "Dibatalkan",
  "automation.workflows.runStatus.interrupted": "Terhenti (Phoenix dimulai ulang)",
  "automation.workflows.runStatus.refused": "Ditolak: tidak diizinkan berjalan",

  "automation.workflows.stepStatus.running": "Berjalan",
  "automation.workflows.stepStatus.waiting": "Menunggu",
  "automation.workflows.stepStatus.succeeded": "Berhasil",
  "automation.workflows.stepStatus.failed": "Gagal",
  "automation.workflows.stepStatus.timed_out": "Waktu habis (hasil tidak diketahui)",
  "automation.workflows.stepStatus.rejected": "Ditolak",
  "automation.workflows.stepStatus.expired": "Kedaluwarsa",
  "automation.workflows.stepStatus.unknown": "Hasil tidak diketahui",

  "automation.workflows.authorisation.notNeeded": "Tidak perlu otorisasi",
  "automation.workflows.authorisation.authorised": "Diotorisasi untuk produksi",
  "automation.workflows.authorisation.notAuthorised": "TIDAK diotorisasi: pemicu ditolak",

  "automation.workflows.expiry.invalid": "Itu bukan tanggal dan waktu yang valid.",
  "automation.workflows.expiry.past": "Waktu kedaluwarsa harus di masa depan.",
  "automation.workflows.expiry.tooFar": "Waktu kedaluwarsa paling lama {days} hari dari sekarang.",
  "automation.workflows.refused.noReason": "Tidak ada alasan yang diberikan.",
  "automation.workflows.payload.invalidJson": "Payload bukan JSON yang valid.",
  "automation.workflows.payload.notObject": "Payload harus berupa objek JSON, misalnya '{}'.",
  "automation.workflows.payload.tooMany": "Payload paling banyak memiliki {max} kunci.",

  // ---- workflows: the list ----
  "automation.workflows.title": "Alur kerja",
  "automation.workflows.intro":
    "Alur kerja bereaksi terhadap suatu peristiwa dengan daftar langkah yang tetap. Alur kerja yang mengubah produksi tidak melakukan apa pun sampai Anda mengotorisasi persis definisi yang sudah Anda tinjau.",
  "automation.workflows.empty":
    "Belum ada alur kerja. Buat satu dengan meninjau definisi di bawah ini.",
  "automation.workflows.row.runsWhen": "Berjalan saat {event} terjadi · versi {version}",
  "automation.workflows.row.cannotRun": "Tidak dapat berjalan: {problems}",
  "automation.workflows.row.metrics": "{started} eksekusi, {succeeded} berhasil",

  // ---- workflows: the numbers of one workflow ----
  "automation.workflows.metrics.title": "Angka",
  "automation.workflows.metrics.label": "Metrik",
  "automation.workflows.metrics.none":
    "Alur kerja ini belum pernah berjalan, jadi belum ada angka.",
  "automation.workflows.metrics.started": "Eksekusi dimulai",
  "automation.workflows.metrics.succeeded": "Berhasil",
  "automation.workflows.metrics.failed": "Gagal",
  "automation.workflows.metrics.attention": "Perlu perhatian Anda",
  "automation.workflows.metrics.cancelled": "Dibatalkan",
  "automation.workflows.metrics.refused": "Ditolak",
  "automation.workflows.metrics.interrupted": "Terhenti",
  "automation.workflows.metrics.stepsFailed": "Langkah yang gagal",
  "automation.workflows.metrics.stepsFailedValue": "{count} ({percent}% dari langkah)",
  "automation.workflows.metrics.approvalsWaiting": "Persetujuan menunggu",
  "automation.workflows.metrics.approvalsOutcome": "Persetujuan disetujui / ditolak / kedaluwarsa",
  "automation.workflows.metrics.approvalsOutcomeValue": "{approved} / {rejected} / {expired}",
  "automation.workflows.metrics.runTime": "Waktu eksekusi (median / persentil ke-90)",
  "automation.workflows.metrics.runTimeValue":
    "{median} ms / {p90} ms dari {samples, plural, other {# eksekusi}}",
  "automation.workflows.metrics.noFinishedRuns": "belum ada eksekusi yang selesai",

  // ---- workflows: the definition editor ----
  "automation.workflows.editor.titleEdit": "Ubah definisi",
  "automation.workflows.editor.titleCreate": "Buat alur kerja",
  "automation.workflows.editor.introExisting":
    'Masukkan definisi JSON lengkap. Pertahankan "enabled": {enabled}; perubahan ini mempertahankan status sakelar saat ini. Menyimpan tidak mengotorisasi atau menjalankannya. Pemeriksaan tidak pernah menyimpan.',
  "automation.workflows.editor.introNew":
    'Masukkan definisi JSON lengkap. Definisi baru harus memiliki "enabled": false. Menyimpan tidak menjalankan, mengaktifkan, atau mengotorisasinya. Pemeriksaan tidak pernah menyimpan.',
  "automation.workflows.editor.label": "Definisi alur kerja (JSON)",
  "automation.workflows.editor.check": "Periksa draf",
  "automation.workflows.editor.enterJson":
    "Masukkan definisi alur kerja JSON sebelum memeriksanya.",
  "automation.workflows.editor.notObject": "Definisi alur kerja harus berupa objek JSON.",
  "automation.workflows.editor.keepEnabled":
    'Pertahankan "enabled": {enabled}. Ubah sakelar secara terpisah setelah menyimpan.',
  "automation.workflows.editor.setDisabled":
    'Atur "enabled": false. Menyimpan definisi baru tidak boleh menyalakannya.',
  "automation.workflows.editor.keepId":
    "Pengeditan harus mempertahankan ID alur kerja yang sama. Gunakan Buat alur kerja untuk ID baru.",
  "automation.workflows.editor.notValid": "Tidak valid: {problems}",
  "automation.workflows.editor.noHash": "Validasi tidak mengembalikan hash definisi yang valid.",
  "automation.workflows.editor.hashDiffers":
    "Hash definisi yang tersimpan berbeda dari hash yang ditinjau. Tinjau definisi tersimpan sebelum menggunakannya.",
  "automation.workflows.editor.savedExisting":
    "Definisi disimpan. Status sakelar yang ada tidak berubah; menyimpan tidak mengotorisasinya.",
  "automation.workflows.editor.savedNew":
    "Definisi disimpan dalam keadaan mati. Menyimpan tidak mengotorisasi atau mengaktifkannya.",
  "automation.workflows.editor.reviewed": "Definisi yang ditinjau",
  "automation.workflows.editor.validLead": "Draf valid.",
  "automation.workflows.editor.valid":
    "{lead} Tinjau definisi dan hash ini persis sebelum menyimpan. Setiap perubahan memerlukan pemeriksaan ulang.",
  "automation.workflows.editor.toSave": "Definisi yang akan disimpan",
  "automation.workflows.editor.hash": "Hash tervalidasi: {hash}",
  "automation.workflows.editor.authRequired": "Otorisasi diperlukan secara terpisah: {reasons}",
  "automation.workflows.editor.authNotRequired": "Tidak perlu otorisasi.",
  "automation.workflows.editor.switchOn":
    "Menyimpan tidak pernah mengotorisasi; sakelar tetap menyala.",
  "automation.workflows.editor.switchOff":
    "Menyimpan tidak pernah mengotorisasi; sakelar tetap mati.",
  "automation.workflows.editor.switchNew":
    "Menyimpan tidak pernah mengotorisasi; alur kerja baru tetap dalam keadaan mati.",
  "automation.workflows.editor.confirm": "Konfirmasi: simpan persis definisi ini",
  "automation.workflows.editor.reviewStored": "Tinjau alur kerja tersimpan",

  // ---- workflows: checking the stored definition ----
  "automation.workflows.validate.button": "Periksa definisi",
  "automation.workflows.validate.dryRun":
    "Uji coba. Tidak ada yang disimpan dan tidak ada yang berjalan.",
  "automation.workflows.validate.validLead": "Valid.",
  "automation.workflows.validate.valid": "{lead} Hash {hash}. {authorisation}",
  "automation.workflows.validate.needsAuth": "Perlu otorisasi Anda: {reasons}.",
  "automation.workflows.validate.noAuth": "Tidak perlu otorisasi.",
  "automation.workflows.validate.invalidLead": "Tidak valid.",
  "automation.workflows.validate.invalid": "{lead} {count, plural, other {# masalah:}}",
  "automation.workflows.validate.problems": "Masalah",

  // ---- workflows: authorising ----
  "automation.workflows.authorise.title": "Otorisasi untuk produksi",
  "automation.workflows.authorise.notNeeded": "Alur kerja ini tidak memerlukan otorisasi.",
  "automation.workflows.authorise.why": "Mengapa perlu otorisasi Anda:",
  "automation.workflows.authorise.reasons": "Alasan",
  "automation.workflows.authorise.intro":
    "Ini akan mengizinkan alur kerja {name} berjalan setiap kali {event} terjadi, tanpa pertanyaan lagi untuk langkah-langkah ini kecuali alur kerja memintanya:",
  "automation.workflows.authorise.allowed": "Yang akan diizinkan berjalan",
  "automation.workflows.authorise.noTools": "Tidak memanggil alat apa pun.",
  "automation.workflows.authorise.step": "Langkah {step} memanggil {tool}",
  "automation.workflows.authorise.stepUndo": "Langkah {step} memanggil {tool} (urungkan: {undo})",
  "automation.workflows.authorise.being": "Definisi yang diotorisasi: versi {version}, hash {hash}",
  "automation.workflows.authorise.expires": "Kedaluwarsa {hint}",
  "automation.workflows.authorise.expiresHint": "(opsional, dalam {days} hari)",
  "automation.workflows.authorise.submit": "Otorisasi persis definisi ini",
  "automation.workflows.authorise.done":
    "Versi {version} diotorisasi. Setiap perubahan definisi berikutnya mengakhiri otorisasi ini.",

  // ---- workflows: run now ----
  "automation.workflows.runNow.title": "Jalankan sekarang",
  "automation.workflows.runNow.intro":
    "Memulai alur kerja secara manual dengan pemeriksaan yang sama seperti saat peristiwanya terjadi: aktif, tidak dihentikan oleh penghentian darurat, valid, dan diotorisasi jika mengubah produksi.",
  "automation.workflows.runNow.payload": "Data yang akan dibawa oleh peristiwa {hint}",
  "automation.workflows.runNow.payloadHint": "(objek JSON, opsional)",
  "automation.workflows.runNow.button": "Jalankan sekarang",
  "automation.workflows.runNow.cannotRun": "Tidak dapat berjalan: {problems}",
  "automation.workflows.runNow.enableFirst": "Aktifkan alur kerja untuk menjalankannya.",
  "automation.workflows.runNow.refusedLead": "Permulaan ditolak.",
  "automation.workflows.runNow.seeRefused": "Lihat eksekusi yang ditolak",
  "automation.workflows.runNow.started": "Dimulai. {link}",
  "automation.workflows.runNow.follow": "Ikuti eksekusi",

  // ---- workflows: one workflow ----
  "automation.workflows.detail.all": "Semua alur kerja",
  "automation.workflows.detail.backAll": "← Semua alur kerja",
  "automation.workflows.detail.productionLead": "Produksi.",
  "automation.workflows.detail.production":
    "{lead} Alur kerja ini dapat mengubah sistem yang sedang aktif. Alur kerja ini hanya berjalan selama Anda mengotorisasi definisinya yang persis.",
  "automation.workflows.detail.cannotRunNow": "Saat ini tidak dapat berjalan:",
  "automation.workflows.detail.definition": "Definisi",
  "automation.workflows.detail.versionHash": "Versi {version} · hash {hash}",
  "automation.workflows.detail.runsWhen": "Berjalan saat {event} terjadi.",
  "automation.workflows.detail.runsWhenAnd": "Berjalan saat {event} terjadi dan {condition}.",
  "automation.workflows.detail.tools": "Alat yang dapat dipanggil",
  "automation.workflows.detail.toolsLabel": "Alat",
  "automation.workflows.detail.none": "Tidak ada.",
  "automation.workflows.detail.toolStep": "Langkah {step}: {tool}",
  "automation.workflows.detail.flagged": "Tindakan produksi atau kritis",
  "automation.workflows.detail.declaredUndo": "urungkan yang dideklarasikan: {undo}",
  "automation.workflows.detail.definitionText": "Definisi (teks hanya-baca, dapat digulir)",
  "automation.workflows.detail.unreadable": "Definisi tersimpan tidak dapat dibaca.",
  "automation.workflows.detail.switch": "Sakelar",
  "automation.workflows.detail.enable": "Aktifkan",
  "automation.workflows.detail.disable": "Nonaktifkan",
  "automation.workflows.detail.switchNote":
    "Mengaktifkan tidak mengotorisasi. Alur kerja produksi yang aktif tetapi tidak diotorisasi mencatat setiap pemicu sebagai ditolak.",
  "automation.workflows.detail.authorisations": "Otorisasi",
  "automation.workflows.detail.noneYet": "Belum ada.",
  "automation.workflows.detail.inForce": "Berlaku",
  "automation.workflows.detail.revoked": "Dicabut",
  "automation.workflows.detail.notInForce": "Tidak berlaku",
  "automation.workflows.detail.authorisedBy": "oleh {by} pada {date}",
  "automation.workflows.detail.authExpires": "kedaluwarsa {date}",
  "automation.workflows.detail.authChanged": "definisi berubah atau sudah kedaluwarsa",
  "automation.workflows.detail.forHash": "untuk hash {hash}",
  "automation.workflows.detail.confirmRevoke": "Konfirmasi: cabut otorisasi",
  "automation.workflows.detail.revoke": "Cabut otorisasi…",
  "automation.workflows.detail.revokeNote":
    "Eksekusi yang sedang berjalan berhenti pada langkah berikutnya.",
  "automation.workflows.detail.recentRuns": "Eksekusi terbaru",
  "automation.workflows.detail.noRuns": "Belum ada eksekusi.",

  // ---- workflows: runs and steps ----
  "automation.workflows.run.needsLook": "(perlu diperiksa)",
  "automation.workflows.run.notSuccess": "(tidak berhasil)",
  "automation.workflows.run.nowAtStep": "kini di langkah {step}",
  "automation.workflows.run.atStep": "di langkah {step}",
  "automation.workflows.run.backToWorkflow": "Kembali ke alur kerja",
  "automation.workflows.run.title": "Eksekusi {name}",
  "automation.workflows.run.created": "Dibuat {date}",
  "automation.workflows.run.finished": "selesai {date}",
  "automation.workflows.run.chainDepth": "kedalaman rantai {depth}",
  "automation.workflows.run.waitingForYou": "Menunggu Anda",
  "automation.workflows.run.stop": "Hentikan eksekusi ini",
  "automation.workflows.run.confirmCancel": "Konfirmasi: batalkan eksekusi ini",
  "automation.workflows.run.keepRunning": "Tetap jalankan",
  "automation.workflows.run.cancel": "Batalkan eksekusi ini…",
  "automation.workflows.run.cancelNote":
    "Pembatalan tidak menjalankan langkah urungkan yang dideklarasikan. Langkah yang sedang berlangsung mungkin tetap selesai.",
  "automation.workflows.run.trigger": "Yang memulainya",
  "automation.workflows.run.triggerText": "Pemicu (teks biasa, dapat digulir)",
  "automation.workflows.run.stepsHeading": "Langkah ({count})",
  "automation.workflows.run.stepsLabel": "Langkah",
  "automation.workflows.run.noSteps": "Belum ada langkah yang dimulai.",
  "automation.workflows.step.undo": "Urungkan: {step}",
  "automation.workflows.step.attempts": "{count, plural, other {# percobaan}}",
  "automation.workflows.step.changesState": "Mengubah status",
  "automation.workflows.step.destructive": "{lead}: langkah ini dapat mengubah sistem yang nyata.",
  "automation.workflows.step.tool": "Alat {tool}",
  "automation.workflows.step.input": "Input langkah {step} (teks biasa, dapat digulir)",
  "automation.workflows.step.output": "Output langkah {step} (teks biasa, dapat digulir)",

  // ---- plans: tables and checks (core/plans.ts) ----
  "automation.plans.status.draft": "Draf: belum diusulkan",
  "automation.plans.status.proposed": "Diusulkan: menunggu persetujuan Anda",
  "automation.plans.status.approved": "Disetujui: siap dibuat",
  "automation.plans.status.creating": "Membuat tugas…",
  "automation.plans.status.created": "Dibuat",
  "automation.plans.status.failed": "Gagal: sebagian tugas tidak dibuat",
  "automation.plans.status.cancelled": "Dibatalkan",
  "automation.plans.basis.meeting": "dari rapat",
  "automation.plans.basis.suggested": "disarankan oleh model",
  "automation.plans.basis.user": "ditulis oleh Anda",
  "automation.plans.run.pending": "Belum dimulai",
  "automation.plans.run.attempting": "Sedang berlangsung",
  "automation.plans.run.created": "Dibuat",
  "automation.plans.run.failed": "Gagal",
  "automation.plans.tool.githubIssue": "Buat isu GitHub",
  "automation.plans.tool.frappeTask": "Buat tugas Frappe",
  "automation.plans.kind.decision": "keputusan",
  "automation.plans.kind.action_item": "butir tindakan",
  "automation.plans.kind.requirement": "persyaratan",
  "automation.plans.authorship.rules":
    "Draf berbasis aturan: tidak ditulis oleh AI, hanya mengulang butir rapat.",
  "automation.plans.authorship.model":
    "Keluaran model ({model}): periksa terhadap rapat sebelum menyetujui.",
  "automation.plans.destination.github": "Repositori GitHub {repository}",
  "automation.plans.destination.frappe": "Situs Frappe {site}",
  "automation.plans.problem.repository": 'Repositori harus berbentuk "owner/name".',
  "automation.plans.problem.site": "Itu bukan nama situs Frappe yang valid.",
  "automation.plans.problem.titleEmpty": "Judul tidak boleh kosong.",
  "automation.plans.problem.titleLong": "Judul lebih panjang dari {max}.",
  "automation.plans.problem.summaryEmpty": "Ringkasan tidak boleh kosong.",
  "automation.plans.problem.summaryLong": "Ringkasan lebih panjang dari {max}.",
  "automation.plans.problem.taskCount": "Rencana memerlukan 1 sampai {max} tugas.",
  "automation.plans.problem.taskTitle": "Tugas {n} memerlukan judul.",
  "automation.plans.problem.bodyLong": "Isi lebih panjang dari {max}.",
  "automation.plans.problem.labelCount": "Paling banyak {max} label.",
  "automation.plans.problem.labelLong": "Sebuah label lebih panjang dari {max}.",

  // ---- plans: make a plan from a meeting item ----
  "automation.plans.off": "Perencanaan nonaktif.",
  "automation.plans.make.open": "Buat rencana…",
  "automation.plans.make.openFrom": "Buat rencana dari {kind}: {text}",
  "automation.plans.make.intro":
    "Rencana adalah draf tugas rekayasa. Tidak ada yang dibuat sampai Anda menyetujuinya dan mengonfirmasi setiap tugas.",
  "automation.plans.make.where": "Ke mana tugas-tugas ini akan dikirim?",
  "automation.plans.make.githubIssues": "Isu GitHub",
  "automation.plans.make.frappeTasks": "Tugas Frappe",
  "automation.plans.make.repository": "Repositori (owner/name)",
  "automation.plans.make.site": "Situs Frappe",
  "automation.plans.make.chooseSite": "Pilih situs",
  "automation.plans.make.drafting": "Menyusun draf rencana…",
  "automation.plans.make.draft": "Susun draf rencana",
  "automation.plans.make.localModel":
    "Model lokal dapat memerlukan satu menit. Tidak ada yang dikirim ke tempat lain.",
  "automation.plans.make.drafted": "Draf rencana selesai.",
  "automation.plans.make.openPlan": "Buka rencana",

  // ---- plans: on a meeting ----
  "automation.plans.meeting.title": "Rencana dan tugas dari rapat ini",
  "automation.plans.meeting.plans": "Rencana",
  "automation.plans.meeting.summary": "{status} · {count, plural, other {# tugas}} · {system}",
  "automation.plans.meeting.tasksCreated": "Tugas yang dibuat",
  "automation.plans.meeting.tasksLabel": "Tugas yang dibuat dari rapat ini",
  "automation.plans.link.frappeTask": "Tugas {id}",
  "automation.plans.link.detail": "tugas {index} dari {plan} · disetujui {date}",
  "automation.plans.link.itsPlan": "rencananya",

  // ---- plans: the editor ----
  "automation.plans.editor.label": "Ubah rencana",
  "automation.plans.editor.title": "Judul {hint}",
  "automation.plans.editor.summary": "Ringkasan {hint}",
  "automation.plans.editor.upTo": "(maksimal {max})",
  "automation.plans.editor.tasks": "Tugas {hint}",
  "automation.plans.editor.tasksRange": "(1 sampai {max})",
  "automation.plans.editor.task": "Tugas {n}",
  "automation.plans.editor.taskTitle": "Judul tugas {n}",
  "automation.plans.editor.taskBody": "Isi tugas {n} {hint}",
  "automation.plans.editor.taskLabels": "Label tugas {n} {hint}",
  "automation.plans.editor.labelsHint": "(dipisahkan koma, maksimal {max})",
  "automation.plans.editor.removeTask": "Hapus tugas {n}",
  "automation.plans.editor.addTask": "Tambah tugas",
  "automation.plans.editor.note":
    "Menyimpan mengembalikan rencana ke draf dan menghapus persetujuan yang ada. Anda kemudian mengusulkan dan menyetujuinya lagi.",
  "automation.plans.editor.save": "Simpan perubahan",

  // ---- plans: preview and results ----
  "automation.plans.preview.title": "Persis yang akan dikirim",
  "automation.plans.preview.intro":
    "Setiap tugas adalah satu panggilan yang dilakukan atas nama Anda. Ini adalah input sebenarnya, ditampilkan sebagai teks biasa.",
  "automation.plans.preview.calls": "Panggilan yang akan dilakukan",
  "automation.plans.preview.task": "Tugas {n}: {tool}",
  "automation.plans.preview.decision": "(efek: {effect}, risiko: {risk})",
  "automation.plans.preview.input": "Input tugas {n} (teks biasa, dapat digulir)",
  "automation.plans.runs.title": "Tugas demi tugas",
  "automation.plans.runs.label": "Hasil tugas",
  "automation.plans.runs.task": "Tugas {n}:",
  "automation.plans.runs.attempts": "{count, plural, other {# percobaan}}",
  "automation.plans.runs.frappeTask": "Tugas Frappe {id}",
  "automation.plans.runs.stopped":
    "Berhenti pada tugas {n}: {message}. Tidak ada tugas setelahnya yang dibuat. Anda dapat menjalankan Buat lagi: tugas yang sudah ada akan ditemukan, bukan digandakan.",

  // ---- plans: one plan ----
  "automation.plans.page.allMeetings": "Semua rapat",
  "automation.plans.page.meeting": "← Rapat",
  "automation.plans.page.rules": "Draf berbasis aturan",
  "automation.plans.page.model": "Keluaran model",
  "automation.plans.page.destination": "Tujuan: {destination}",
  "automation.plans.page.from": "Dari {kind}: {text}",
  "automation.plans.page.owner": "pemilik {owner}",
  "automation.plans.page.due": "tenggat {due}",
  "automation.plans.page.proposedNotice": "Diusulkan. Periksa pratinjau, lalu setujui.",
  "automation.plans.page.approvedNotice": "Disetujui. Belum ada yang dibuat.",
  "automation.plans.page.savedNotice":
    "Tersimpan. Rencana kembali menjadi draf; usulkan untuk menyetujuinya.",
  "automation.plans.page.cancelledNotice": "Dibatalkan. Tidak ada yang dibuat.",
  "automation.plans.page.plan": "Rencana",
  "automation.plans.page.tasks": "Tugas ({count})",
  "automation.plans.page.tasksLabel": "Tugas",
  "automation.plans.page.labels": "Label:",
  "automation.plans.page.edit": "Ubah rencana",
  "automation.plans.page.acceptance": "Kriteria penerimaan",
  "automation.plans.page.risks": "Risiko",
  "automation.plans.page.questions": "Pertanyaan terbuka",
  "automation.plans.frappe.doctype": "DocType Frappe yang diusulkan: {doctype}",
  "automation.plans.frappe.note":
    "Hanya rancangan yang disarankan. Membuat tugas tidak membuat DocType ini, field, alur kerja, atau izinnya.",
  "automation.plans.frappe.fields": "Field",
  "automation.plans.frappe.fieldsLabel": "Field Frappe yang diusulkan",
  "automation.plans.frappe.required": "wajib",
  "automation.plans.frappe.noFields": "Tidak ada field yang diusulkan.",
  "automation.plans.frappe.states": "Status alur kerja",
  "automation.plans.frappe.statesLabel": "Status alur kerja Frappe yang diusulkan",
  "automation.plans.frappe.noStates": "Tidak ada status alur kerja yang diusulkan.",
  "automation.plans.frappe.permissions": "Izin",
  "automation.plans.frappe.permissionsLabel": "Izin Frappe yang diusulkan",
  "automation.plans.frappe.noPermissions": "Tidak ada izin yang diusulkan.",
  "automation.plans.frappe.access": "{role}: {access}",
  "automation.plans.frappe.read": "baca",
  "automation.plans.frappe.write": "tulis",
  "automation.plans.frappe.create": "buat",
  "automation.plans.frappe.noAccess": "tanpa akses",
  "automation.plans.decide.title": "Putuskan",
  "automation.plans.decide.fingerprint":
    "Sidik jari dari yang sedang Anda lihat: {hash}. Persetujuan hanya mencakup isi persis ini; jika rencana berubah, persetujuan ditolak.",
  "automation.plans.decide.propose": "Usulkan rencana ini",
  "automation.plans.decide.nameMeeting": "Sebutkan nama rapat dalam tugas yang dibuat",
  "automation.plans.decide.approve": "Setujui rencana persis ini",
  "automation.plans.decide.approved": "Disetujui oleh {by} pada {date}.",
  "automation.plans.decide.approvedNamed":
    "Disetujui oleh {by} pada {date} · nama rapat disebutkan dalam tugas.",
  "automation.plans.decide.understand":
    "Saya mengerti ini membuat {count, plural, other {# tugas}} di {destination}, atas nama saya.",
  "automation.plans.decide.createRemaining": "Buat tugas yang tersisa",
  "automation.plans.decide.create": "Buat tugas",
  "automation.plans.decide.waiting": "Menunggu persetujuan Anda untuk tugas {n} dari {total}.",
  "automation.plans.decide.waitingNote":
    "Core bertanya kepada Anda sebelum setiap tugas dibuat. Jawab di bawah; halaman ini menunggu selama diperlukan.",
  "automation.plans.decide.cancel": "Batalkan rencana ini",

  // ---- automation settings (AutomationSettings.tsx) ----
  "automation.settings.title": "Otomatisasi",
  "automation.settings.intro":
    "Otomatisasi nonaktif sampai Anda menyalakannya. Saat nonaktif, Fawkes tidak memulai tugas dan tidak menjalankan apa pun sendiri. Saat aktif, Fawkes hanya dapat memulai tugas jika Anda memintanya, misalnya “Diagnosis kegagalan CI” di tab Chat. Fawkes membaca data dan mengusulkan; apa pun yang mengubah sesuatu menunggu persetujuan Anda, dan Anda dapat membatalkan tugas kapan saja. Menonaktifkan otomatisasi membatalkan semua tugas yang sedang berjalan.",
  "automation.settings.allow": "Izinkan Fawkes menjalankan tugas yang saya mulai",
  "automation.settings.statusOn":
    "Otomatisasi aktif. {active, plural, other {# tugas}} sedang berjalan (maksimal {max} sekaligus).",
  "automation.settings.statusOff":
    "Otomatisasi nonaktif. {active, plural, other {# tugas}} sedang berjalan (maksimal {max} sekaligus).",
  "automation.settings.unavailable":
    "Pengaturan otomatisasi tidak tersedia dari Phoenix Core ({error}).",

  // ---- proactive suggestions (ProactiveSettings.tsx) ----
  "automation.proactive.title": "Saran proaktif",
  "automation.proactive.intro":
    "Nonaktif secara default. Kage dapat menyarankan butir rapat yang diterima dan belum ditugaskan saat tersedia. Sinyal rekayasa hanya dapat memindai akar repositori yang dipantau dan Anda tambahkan secara eksplisit; penyedia advisori tidak tersedia sehingga tidak pernah melaporkan advisori. Evaluasi bersifat manual kecuali Anda memilih kadensi secara eksplisit setelah ikut serta. Pekerjaan terjadwal berjalan secara lokal dan menghormati jam tenang, batas laju, dan penghentian darurat.",
  "automation.proactive.status": "Sumber Kage: {source}. Saran {state} ({cadence}).",
  "automation.proactive.sourceAvailable": "tersedia",
  "automation.proactive.sourceUnavailable": "tidak tersedia",
  "automation.proactive.stateOn": "aktif",
  "automation.proactive.stateOff": "nonaktif",
  "automation.proactive.cadenceEvery": "setiap {minutes, plural, other {# menit}}",
  "automation.proactive.cadenceManual": "hanya manual",
  "automation.proactive.optIn": "Ikut serta",
  "automation.proactive.enable": "Aktifkan saran proaktif",
  "automation.proactive.kageItems": "Butir tindakan Kage yang diterima dan belum ditugaskan",
  "automation.proactive.engineeringSignals": "Sinyal rekayasa dari repositori yang dipantau",
  "automation.proactive.engineeringSignalsStatus": "Sinyal rekayasa {state}.",
  "automation.proactive.cadence": "Kadensi evaluasi otomatis",
  "automation.proactive.cadenceOff": "Hanya manual (nonaktif)",
  "automation.proactive.cadence15": "Setiap 15 menit",
  "automation.proactive.cadence30": "Setiap 30 menit",
  "automation.proactive.cadence60": "Setiap jam",
  "automation.proactive.cadence1440": "Setiap hari",
  "automation.proactive.quietHours": "Jam tenang",
  "automation.proactive.useQuiet": "Gunakan jam tenang",
  "automation.proactive.timezone": "Zona waktu (IANA)",
  "automation.proactive.quietFrom": "Tenang mulai",
  "automation.proactive.quietUntil": "Tenang sampai",
  "automation.proactive.maxPerHour": "Maksimum saran per jam",
  "automation.proactive.preview": "Pratinjau saran",
  "automation.proactive.evaluate": "Evaluasi sekarang",
  "automation.proactive.refreshNoise": "Segarkan metrik gangguan",
  "automation.proactive.delivered": "Saran yang dikirim",
  "automation.proactive.dismiss": "Tutup {title}",
  "automation.proactive.previewHeading": "Pratinjau berbasis bukti",
  "automation.proactive.previewLabel": "Pratinjau saran",
  "automation.proactive.previewEmpty":
    "Tidak ada butir tindakan Kage yang diterima, belum ditugaskan, dan memenuhi syarat.",
  "automation.proactive.evidence": "Bukti: rapat {meeting}, butir {item} ({source}): “{quote}”",
  "automation.proactive.sourceTranscript": "transkrip",
  "automation.proactive.sourceSummary": "ringkasan",
  "automation.proactive.noiseLabel": "Metrik gangguan saran",
  "automation.proactive.noiseDelivered": "Dikirim",
  "automation.proactive.noiseDismissed": "Ditutup",
  "automation.proactive.noiseSuppressed": "Ditekan",
  "automation.proactive.noiseRate": "Tingkat penutupan",
  "automation.proactive.saved": "Preferensi saran disimpan.",
  "automation.proactive.previewCount":
    "{count, plural, other {# saran berbasis bukti dalam pratinjau.}}",
  "automation.proactive.evaluated": "{delivered} dikirim; {suppressed} ditekan.",
  "automation.proactive.dismissed": "Saran ditutup.",

  // ---- capability registry (RegistrySettings.tsx) ----
  "automation.registry.title": "Registri kapabilitas",
  "automation.registry.intro":
    "Jelajahi metadata dari indeks bertanda tangan yang dikonfigurasi secara lokal dan dipercaya oleh host. Phoenix Core memverifikasi tanda tangan indeks sebelum mengembalikan entri. Menjelajah tidak memasang atau menjalankan kode pihak ketiga.",
  "automation.registry.noInstall":
    "Pemasangan tidak tersedia: sandbox OS yang telah diaudit tidak tersedia. Kapabilitas pihak ketiga tidak dapat dipasang di sini.",
  "automation.registry.unavailable": "Registri tidak tersedia",
  "automation.registry.loadFailed": "Registri tidak dapat dimuat: {error}",
  "automation.registry.loading": "Memuat registri…",
  "automation.registry.notConfigured":
    "Belum ada registri lokal yang dikonfigurasi. Minta administrator host untuk mengonfigurasi kunci tepercaya dan indeks bertanda tangan agar dapat menjelajahi kapabilitas.",
  "automation.registry.indexSignature":
    "Tanda tangan indeks: terverifikasi dengan penanda tangan Ed25519 tepercaya host {signer}.",
  "automation.registry.signature": "Tanda tangan: {signature}",
  "automation.registry.indexHash": "SHA-256 indeks bertanda tangan: {hash}",
  "automation.registry.empty": "Registri bertanda tangan tidak berisi kapabilitas.",
  "automation.registry.preview": "Pratinjau {name} {version}",
  "automation.registry.previewFailed": "Pratinjau tidak tersedia: {error}",
  "automation.registry.previewLoading": "Memuat pratinjau terverifikasi…",
  "automation.registry.permissions": "Izin",
  "automation.registry.noDescription": "Tidak ada deskripsi yang diberikan",
  "automation.registry.noneDeclared": "Tidak ada yang dideklarasikan.",
  "automation.registry.dataCategories": "Kategori data",
  "automation.registry.licence": "Lisensi",
  "automation.registry.licenceLine": "{licence}. {policy}",
  "automation.registry.security": "Keamanan",
  "automation.registry.securityContact": "Kontak keamanan",
  "automation.registry.advisories": "Peringatan keamanan",
  "automation.registry.provenance": "Asal-usul bertanda tangan",
  "automation.registry.artifact":
    "SHA-256 artefak yang dideklarasikan oleh indeks bertanda tangan: {hash} ({bytes, plural, other {# byte}}). Verifikasi artefak: belum diverifikasi; byte artefak belum diambil atau diperiksa. Menjelajah tidak mengeksekusi artefak.",
  "automation.registry.sandbox":
    "Sandbox: tidak tersedia. Pemasangan dinonaktifkan; tidak ada permintaan pemasangan yang akan dikirim.",

  "automation.registry.skinPack": "paket skin khusus data",
  "automation.registry.skinDataOnly":
    "Paket pakaian Phoenix khusus data. Paket ini tidak dapat menjalankan kode atau meminta izin.",
  "automation.registry.installSkin": "Pasang skin {name} {version}",
  "automation.registry.installPending":
    "Menunggu konfirmasi Core sebelum memasang skin bertanda tangan ini.",
  "automation.registry.installSucceeded": "Skin bertanda tangan dipasang di Wardrobe.",
  "automation.registry.installFailed": "Pemasangan skin gagal: {error}",
  // ---- encrypted sync (SyncSettings.tsx) ----
  "automation.sync.title": "Sinkronisasi terenkripsi",
  "automation.sync.intro":
    "Opsional dan nonaktif secara default. Sinkronisasi memerlukan relay HTTPS milik Anda sendiri yang tersedia dan autentikasi relay; Phoenix tidak menyediakan relay yang di-host. Konfigurasi adalah keikutsertaan eksplisit: tidak ada yang dikirim selama penyiapan, tetapi rekaman yang mengantre disinkronkan secara otomatis saat online setelahnya. Sinkronkan sekarang memulai upaya segera. Adaptor hanya menyiapkan dua pengaturan non-konten yang dipilih secara eksplisit; perubahan lokal berikutnya memerlukan Publikasikan saat ini. Teks rapat, orang, dan memori tidak pernah disertakan oleh adaptor ini.",
  "automation.sync.unavailable":
    "Pengaturan sinkronisasi tidak tersedia dari Phoenix Core. Permintaan status ini tidak menghubungi relay.",
  "automation.sync.relayNone": "belum dikonfigurasi",
  "automation.sync.relayUnknown": "relay terkonfigurasi (URL tidak tersedia)",
  "automation.sync.statusOn":
    "Sinkronisasi aktif. {pending} mengantre; {conflicts, plural, other {# konflik}}.",
  "automation.sync.statusOff":
    "Sinkronisasi nonaktif. {pending} mengantre; {conflicts, plural, other {# konflik}}.",
  "automation.sync.chooseExclusions":
    "Pilih pengecualian sebelum ikut serta; kelas dan proyek yang dikecualikan tidak diunggah.",
  "automation.sync.excludeClasses": "Kecualikan kelas data",
  "automation.sync.class.preference": "preferensi",
  "automation.sync.class.context": "konteks",
  "automation.sync.class.project_profile": "profil proyek",
  "automation.sync.excludeProject": "Kecualikan proyek berdasarkan nama",
  "automation.sync.excludeProjectButton": "Kecualikan proyek",
  "automation.sync.removeExclusion": "Hapus pengecualian untuk {name}",
  "automation.sync.exclusionsSaved": "Pengecualian disimpan.",
  "automation.sync.adapterLegend": "Ikutkan pengaturan yang ada satu per satu",
  "automation.sync.adapterNote":
    "Hanya pengurangan gerakan (preferensi) dan jumlah hasil pencarian (konfigurasi konteks) yang berlingkup pemilik akun yang memenuhi syarat; tidak ada sumber berlingkup proyek. Memilih akan menyiapkan nilai saat ini. Publikasikan perubahan lokal berikutnya secara eksplisit. Nilai masuk tetap disiapkan sampai Anda meninjau dan mengonfirmasi penerapannya secara lokal. Mengecualikan sebuah kelas juga menghapus pilihan adaptornya bila diizinkan; rekaman yang sudah dipublikasikan harus dihapus dan disinkronkan terlebih dahulu. Membatalkan pilihan tidak menghapus ciphertext yang telah diunggah; hapus item tersinkronnya secara terpisah jika perlu.",
  "automation.sync.adapter.reducedMotion": "Preferensi pengurangan gerakan",
  "automation.sync.adapter.searchCount": "Metadata jumlah hasil pencarian",
  "automation.sync.adapterSaved":
    "Pilihan adaptor disimpan. Pengaturan saat ini yang baru dipilih disiapkan; tidak ada sumber lain yang disertakan.",
  "automation.sync.adapterApplied": "Pengaturan tersinkron yang dipilih diterapkan secara lokal.",
  "automation.sync.adapterPublished":
    "Pengaturan lokal saat ini disiapkan untuk sinkronisasi terenkripsi.",
  "automation.sync.publish": "Publikasikan {key} saat ini",
  "automation.sync.reviewApply": "Tinjau penerapan {key}",
  "automation.sync.applyPreview": "Pratinjau penerapan pengaturan",
  "automation.sync.applyText":
    "Terapkan revisi {revision} dari {key} yang telah didekripsi dan disiapkan ke pengaturan lokal yang ada? Ini akan menggantikan nilai saat ini hanya setelah konfirmasi. Nilai saat ini dan nilai masuk disembunyikan; kenali versi berdasarkan sumber dan revisi, atau batalkan. Perubahan nilai lokal atau revisi yang disiapkan membuat pratinjau ini tidak berlaku.",
  "automation.sync.confirmApply": "Konfirmasi penerapan pengaturan",
  "automation.sync.cancelApply": "Batalkan penerapan",
  "automation.sync.relayLine":
    "Relay: {relay}. Identitas: {identity}. Relay yang dapat dijangkau diperlukan; status ini tidak membuktikan bahwa relay tersedia.",
  "automation.sync.identityNone": "tidak tersedia",
  "automation.sync.identityNote":
    "Identitas ini mewakili akun kunci pemulihan bersama, bukan perangkat tertentu. Perangkat dengan kunci dan token relay yang sama tidak dapat dicabut satu per satu, dan perlindungan replay relay belum diterapkan.",
  "automation.sync.syncNow": "Sinkronkan sekarang",
  "automation.sync.turnOff": "Matikan sinkronisasi",
  "automation.sync.turnedOff": "Sinkronisasi nonaktif. Rekaman yang mengantre tetap lokal.",
  "automation.sync.offlineNote":
    "Jika relay offline, sinkronisasi manual melaporkan kesalahan dan item tertunda tetap mengantre untuk dicoba lagi nanti. Tidak ada penimpaan diam-diam saat terjadi konflik.",
  "automation.sync.syncedPending":
    "{pending, plural, other {# item}} masih mengantre. Tinjau status dan konflik di bawah.",
  "automation.sync.syncedDone": "Sinkronisasi selesai. Tinjau item dan konflik di bawah.",
  "automation.sync.items": "Item tersinkron",
  "automation.sync.itemsNote":
    "Hanya metadata; isi item dan nilai yang berkonflik tidak ditampilkan.",
  "automation.sync.noItems": "Tidak ada rekaman sinkronisasi yang disiapkan.",
  "automation.sync.itemLine":
    "{id} · {dataClass} · pemilik {owner} · lingkup {scope} · proyek {project} · revisi {revision} · diperbarui {updated} · {state}",
  "automation.sync.projectNone": "tidak ada",
  "automation.sync.updatedUnknown": "tidak diketahui",
  "automation.sync.state.deletionQueued": "penghapusan mengantre",
  "automation.sync.state.deleted": "dihapus",
  "automation.sync.state.queued": "mengantre",
  "automation.sync.state.synced": "tersinkron",
  "automation.sync.conflictMissing":
    "Konflik: rekaman ini tidak ada di relay. Pertahankan lokal untuk memulihkannya di relay, atau terima penghapusan jarak jauh untuk menghapus rekaman sinkronisasi lokal yang disiapkan. Tidak ada yang ditimpa secara otomatis.",
  "automation.sync.conflictRemote":
    "Konflik: revisi jarak jauh {revision}, diperbarui {updated}. Tidak ada yang ditimpa sampai Anda memilih salah satu sisi.",
  "automation.sync.reviewKeepLocal": "Tinjau mempertahankan lokal untuk {id}",
  "automation.sync.reviewKeepRemote": "Tinjau mempertahankan jarak jauh untuk {id}",
  "automation.sync.reviewAcceptDeletion": "Tinjau penerimaan penghapusan jarak jauh untuk {id}",
  "automation.sync.reviewDeletion": "Tinjau penghapusan jarak jauh untuk {id}",
  "automation.sync.resolutionPreview": "Pratinjau penyelesaian konflik",
  "automation.sync.previewFor": "Pratinjau untuk {id} ({scope}):",
  "automation.sync.previewAcceptDeletion":
    "Terima penghapusan jarak jauh: hapus rekaman sinkronisasi lokal yang disiapkan sekarang; tidak ada yang diunggah.",
  "automation.sync.previewRestore":
    "Pulihkan yang hilang di jarak jauh: antrekan versi lokal untuk diunggah pada sinkronisasi berhasil berikutnya.",
  "automation.sync.previewKeepRemote":
    "Pertahankan jarak jauh: ganti rekaman sinkronisasi lokal yang disiapkan dengan versi jarak jauh sekarang.",
  "automation.sync.previewKeepLocal":
    "Pertahankan lokal: antrekan versi ini untuk diunggah pada sinkronisasi berhasil berikutnya. Perubahan jarak jauh yang lebih baru tetap memerlukan penyelesaian.",
  "automation.sync.previewTail":
    "Isi item disembunyikan di sini; jika Anda tidak dapat mengenali versi dari metadata, batalkan. Ini tidak dapat dibatalkan di sini.",
  "automation.sync.confirmAcceptDeletion": "Konfirmasi terima penghapusan jarak jauh",
  "automation.sync.confirmRestore": "Konfirmasi pemulihan yang hilang di jarak jauh",
  "automation.sync.confirmKeepLocal": "Konfirmasi pertahankan lokal",
  "automation.sync.confirmKeepRemote": "Konfirmasi pertahankan jarak jauh",
  "automation.sync.cancelResolution": "Batalkan penyelesaian",
  "automation.sync.resolvedDeletion":
    "Penghapusan jarak jauh diterima. Rekaman sinkronisasi lokal yang disiapkan kini dihapus; tidak ada yang diantrekan untuk diunggah.",
  "automation.sync.resolvedChoice":
    "Pilihan konflik disimpan. Perubahan tertunda disinkronkan secara otomatis saat online; Sinkronkan sekarang memulai upaya segera.",
  "automation.sync.deletionConfirmation": "Konfirmasi penghapusan jarak jauh",
  "automation.sync.deletionText":
    "Hapus {id} ({scope}) dari relay? Ini mengantrekan tombstone secara lokal; salinan jarak jauh dihapus hanya setelah sinkronisasi berhasil. Ini tidak dapat dibatalkan di sini.",
  "automation.sync.confirmDeletion": "Konfirmasi penghapusan jarak jauh",
  "automation.sync.cancelDeletion": "Batalkan penghapusan",
  "automation.sync.deletionQueued":
    "Penghapusan diantrekan. Salinan jarak jauh tidak dihapus sampai sinkronisasi berhasil.",
  "automation.sync.relayUrl": "URL HTTPS relay",
  "automation.sync.relayToken": "Token autentikasi relay",
  "automation.sync.restoreKey": "Kunci pemulihan yang ada (opsional, untuk memulihkan identitas)",
  "automation.sync.optInNote":
    "Keikutsertaan eksplisit: konfigurasi menyimpan kredensial relay secara lokal dan mengaktifkan sinkronisasi otomatis rekaman yang mengantre saat online. Identitas baru menampilkan kunci pemulihan sekali saja: simpan segera; kunci tidak dapat diambil kembali nanti. Mengonfigurasi ulang setelah mematikan sinkronisasi menggunakan kembali identitas yang tersimpan secara lokal bila tersedia. Jangan pernah membagikan kunci Anda kepada operator relay.",
  "automation.sync.configure": "Konfigurasi sinkronisasi terenkripsi",
  "automation.sync.configured":
    "Sinkronisasi dikonfigurasi. Rekaman yang mengantre disinkronkan secara otomatis saat online; Sinkronkan sekarang memulai upaya segera.",
  "automation.sync.recoveryGroup": "Kunci pemulihan sekali pakai",
  "automation.sync.recoveryText":
    "Salin dan simpan kunci pemulihan ini di tempat yang aman sekarang. Kunci ini hanya ditampilkan sekali dan tidak dapat diambil kembali nanti. Jangan bagikan.",
  "automation.sync.copyKey": "Salin kunci pemulihan",
  "automation.sync.savedKey": "Saya sudah menyimpan kunci — tutup",
  "automation.sync.refresh": "Segarkan status sinkronisasi",
};
