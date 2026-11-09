// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { sounds as ensounds } from "../../en/sounds";

/** Machine-translated; unreviewed (see ../../README.md). */
export const sounds: Record<keyof typeof ensounds, string> = {
  "sounds.title": "Sonidos de Fawkes",
  "sounds.intro":
    "Tonos breves que Fawkes emite cuando ocurre algo. Desactivados por defecto. Los genera el propio Phoenix y nunca suenan en modo silencioso, en horas de silencio, con el sonido silenciado, durante la parada de emergencia ni en la demo.",
  "sounds.enabled": "Permitir que Fawkes haga sonidos",
  "sounds.volume": "Volumen",
  "sounds.volumeValue": "{percent} por ciento",
  "sounds.event.launch": "Hola",
  "sounds.event.poke": "Toque",
  "sounds.event.dizzy": "Mareado",
  "sounds.event.recover": "Recuperado",
  "sounds.event.completion": "Tarea terminada",
  "sounds.event.needsYou": "Te necesita",
  "sounds.event.failure": "Algo falló",
  "sounds.preview.legend": "Escuchar un sonido",
  "sounds.preview.play": "Reproducir: {name}",
  "sounds.preview.hint":
    "Una vista previa suena al volumen indicado aunque los sonidos estén desactivados, y solo después de que hayas usado la página.",
  "sounds.preview.muted": "Fawkes está silenciado, así que no se reprodujo nada.",
  "sounds.preview.silentVolume": "El volumen es 0, así que no se reprodujo nada.",
  "sounds.preview.quiet":
    "Hay modo silencioso, horas de silencio, parada de emergencia o demo activos, así que no se reprodujo nada.",
  "sounds.preview.noGesture":
    "Haz clic o pulsa una tecla en la página primero y vuelve a intentarlo.",
  "sounds.preview.failed": "No se pudo reproducir el sonido en este dispositivo.",
  "sounds.saveFailed": "No se pudieron guardar los ajustes de sonido.",
  "sounds.loadFailed": "No se pudieron cargar los ajustes de sonido.",
  "sounds.note":
    "Tu carpeta de sonidos propios solo funciona en la app de escritorio de Phoenix; aquí solo se usan los tonos integrados de Phoenix.",
  "sounds.folder":
    "Para reemplazar un sonido, crea tú mismo esta carpeta y pon en ella archivos WAV llamados greet.wav, poke.wav, dizzy.wav, recover.wav, jump.wav, waiting.wav o error.wav: {path}. Phoenix nunca la crea ni lista su contenido. Un archivo que no sea un WAV PCM simple, que supere 1 MiB o dure más de 5 segundos se ignora y suena el sonido integrado.",
};
