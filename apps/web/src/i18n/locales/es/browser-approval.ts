// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserApproval as enBrowserApproval } from "../../en/browser-approval";

/** Machine-translated; unreviewed. */
export const browserApproval: Record<keyof typeof enBrowserApproval, string> = {
  "browserApproval.action": "Acción del navegador",
  "browserApproval.action.click": "Hacer clic en un control de la página",
  "browserApproval.action.type": "Escribir texto en un campo de la página",
  "browserApproval.action.submit": "Enviar un formulario de la página",
  "browserApproval.action.download": "Iniciar una descarga desde la página",
  "browserApproval.action.navigate": "Ir a otra dirección",
  "browserApproval.action.missing": "La solicitud no indica de qué tipo de acción se trata.",
  "browserApproval.page": "Página",
  "browserApproval.page.missing": "La solicitud no nombra la página.",
  "browserApproval.selector": "Control",
  "browserApproval.selector.missing": "La solicitud no nombra ningún control.",
  "browserApproval.destination": "Destino",
  "browserApproval.destination.missing": "La solicitud no nombra ningún destino.",
  "browserApproval.queryHidden":
    "La dirección también tiene una parte de consulta, que no se muestra.",
  "browserApproval.text": "Texto que se escribirá (se muestra completo)",
  "browserApproval.text.missing": "La solicitud no incluye el texto.",
  "browserApproval.textLength": "Longitud del texto",
  "browserApproval.textLength.value": "{length} caracteres",
  "browserApproval.textLength.missing": "Falta la longitud del texto.",
};
