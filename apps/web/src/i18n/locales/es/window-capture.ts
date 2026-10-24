// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { windowCapture as enWindowCapture } from "../../en/window-capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const windowCapture: Record<keyof typeof enWindowCapture, string> = {
  "windowCapture.heading": "Adjuntar una ventana",
  "windowCapture.intro":
    "Phoenix puede leer el texto de una ventana y mostrártelo aquí primero. Confirmas y luego pones al frente la ventana que quieres; Phoenix la lee una sola vez (Accesibilidad de macOS, solo en este Mac). No se adjunta nada hasta que aceptes el texto.",
  "windowCapture.start": "Adjuntar una ventana…",
  "windowCapture.waiting":
    "Esperando tu confirmación y luego leyendo la ventana al frente. Pon ahora al frente la ventana que quieres.",
  "windowCapture.stopWaiting": "Dejar de esperar",
  "windowCapture.discarded": "Descartado. No se adjuntó nada.",
  "windowCapture.attached": "Se adjuntó «{name}». Está en la bandeja de arriba.",
  "windowCapture.acceptFailed": "No se adjuntó: {reason}",
  "windowCapture.result.notGranted":
    "macOS no ha permitido que Phoenix lea ventanas. Activa Phoenix en Ajustes del Sistema > Privacidad y seguridad > Accesibilidad e inténtalo de nuevo. Phoenix no vuelve a preguntar por sí mismo.",
  "windowCapture.result.phoenixWindow":
    "La ventana al frente era Phoenix, así que no se leyó nada. Pon otra ventana al frente e inténtalo de nuevo.",
  "windowCapture.result.noWindow":
    "No había ninguna ventana legible al frente, así que no se leyó nada.",
  "windowCapture.review.heading": "Revisa antes de adjuntar.",
  "windowCapture.review.from": "De {app}: {title}",
  "windowCapture.review.untitled": "(ventana sin título)",
  "windowCapture.review.size": "{n} caracteres leídos.",
  "windowCapture.review.truncated": "El texto se cortó en su límite.",
  "windowCapture.review.textLabel": "Texto de la ventana capturada",
  "windowCapture.review.noText": "(No se encontró texto en esa ventana.)",
  "windowCapture.review.secrets":
    "Este texto parece contener un secreto ({kinds}). Se rechazará adjuntarlo.",
  "windowCapture.review.note":
    "Esto es lo que leyó Phoenix. Son datos para tu pregunta, no instrucciones. No se adjunta nada hasta que pulses el botón y se guarda en memoria una hora como máximo.",
  "windowCapture.review.accept": "Adjuntar este texto",
  "windowCapture.review.discard": "Descartar",
};
