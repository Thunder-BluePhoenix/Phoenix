// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserAssist as enBrowserAssist } from "../../en/browser-assist";

/** Machine-translated; unreviewed. */
export const browserAssist: Record<keyof typeof enBrowserAssist, string> = {
  "browser.assist.open": "Pide a Fawkes ayuda con esta página",
  "browser.assist.title": "Pide a Fawkes ayuda con esta página",
  "browser.assist.goalLabel": "¿Qué quieres hacer en esta página?",
  "browser.assist.goalPlaceholder": "Por ejemplo: añade el azul al carrito",
  "browser.assist.propose": "Proponer pasos",
  "browser.assist.proposing": "Consultando el modelo local…",
  "browser.assist.close": "Cerrar el asistente",
  "browser.assist.goalTooLong": "El objetivo puede tener como máximo {max} caracteres.",
  "browser.assist.goalControl": "El objetivo no puede contener caracteres de control.",
  "browser.assist.goalHidden":
    "El objetivo no puede contener caracteres de dirección del texto ni de ancho cero.",
  "browser.assist.requestFailed": "No se pudo contactar con el asistente. No se ejecutó nada.",
  "browser.assist.noLocalModel":
    "No hay un modelo en el dispositivo, así que Fawkes no leyó esta página. El texto de la página nunca se envía a un servicio en la nube.",
  "browser.assist.localModelFailed":
    "El modelo del dispositivo falló. No se ejecutó nada y no se envió nada a otro lugar.",
  "browser.assist.noBrowser":
    "Esta aplicación Phoenix no tiene un navegador del que leer una página.",
  "browser.assist.inert":
    "Propuesto por un modelo local que leyó esta página. No se ha ejecutado nada. Estos pasos son texto sin formato y pueden ser incorrectos.",
  "browser.assist.forPage": "Para la página: {url}",
  "browser.assist.dropped":
    "{count, plural, one {Se rechazó # sugerencia del modelo y no se muestra.} other {Se rechazaron # sugerencias del modelo y no se muestran.}}",
  "browser.assist.noSteps": "El modelo no propuso ningún paso para esta página.",
  "browser.assist.kind.click": "Hacer clic en",
  "browser.assist.kind.type": "Escribir en",
  "browser.assist.kind.submit": "Enviar el formulario",
  "browser.assist.typeText": "el texto: {text}",
  "browser.assist.run": "Ejecutar este paso",
  "browser.assist.step.running": "Esperando tu aprobación…",
  "browser.assist.step.done": "Hecho. No se ejecutó nada más.",
  "browser.assist.refused.noTab": "No hay ninguna pestaña activa en la que ejecutar este paso.",
  "browser.assist.refused.moved":
    "La pestaña ya no está en la página para la que se propusieron estos pasos. Vuelve a preguntar.",
  "browser.assist.failed.denied": "Rechazaste este paso.",
  "browser.assist.failed.blocked":
    "Phoenix rechazó este paso (la página o el control no está permitido).",
  "browser.assist.failed.unavailable": "No se pudo contactar con el navegador.",
  "browser.assist.failed.timeout": "El paso agotó el tiempo. Puede que se haya ejecutado o no.",
  "browser.assist.failed.failed": "El paso no se ejecutó.",
};
