// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { windowCapture as enWindowCapture } from "../../en/window-capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const windowCapture: Record<keyof typeof enWindowCapture, string> = {
  "windowCapture.heading": "Anexar uma janela",
  "windowCapture.intro":
    "O Phoenix pode ler o texto de uma janela e mostrá-lo primeiro aqui. Você confirma e depois traz a janela desejada para a frente; o Phoenix a lê uma única vez (Acessibilidade do macOS, somente neste Mac). Nada é anexado até você aceitar o texto.",
  "windowCapture.start": "Anexar uma janela…",
  "windowCapture.waiting":
    "Aguardando sua confirmação e depois lendo a janela da frente. Traga agora a janela desejada para a frente.",
  "windowCapture.stopWaiting": "Parar de esperar",
  "windowCapture.discarded": "Descartado. Nada foi anexado.",
  "windowCapture.attached": "“{name}” anexado. Está na bandeja acima.",
  "windowCapture.acceptFailed": "Não anexado: {reason}",
  "windowCapture.result.notGranted":
    "O macOS não permitiu que o Phoenix leia janelas. Ative o Phoenix em Ajustes do Sistema > Privacidade e Segurança > Acessibilidade e tente de novo. O Phoenix não pergunta de novo por conta própria.",
  "windowCapture.result.phoenixWindow":
    "A janela da frente era o Phoenix, então nada foi lido. Traga outra janela para a frente e tente de novo.",
  "windowCapture.result.noWindow": "Nenhuma janela legível estava na frente, então nada foi lido.",
  "windowCapture.review.heading": "Revise antes de anexar.",
  "windowCapture.review.from": "De {app}: {title}",
  "windowCapture.review.untitled": "(janela sem título)",
  "windowCapture.review.size": "{n} caracteres lidos.",
  "windowCapture.review.truncated": "O texto foi cortado no limite.",
  "windowCapture.review.textLabel": "Texto da janela capturada",
  "windowCapture.review.noText": "(Nenhum texto foi encontrado nessa janela.)",
  "windowCapture.review.secrets":
    "Este texto parece conter um segredo ({kinds}). Anexá-lo será recusado.",
  "windowCapture.review.note":
    "Isto é o que o Phoenix leu. São dados para sua pergunta, não instruções. Nada é anexado até você apertar o botão e fica na memória por no máximo uma hora.",
  "windowCapture.review.accept": "Anexar este texto",
  "windowCapture.review.discard": "Descartar",
};
