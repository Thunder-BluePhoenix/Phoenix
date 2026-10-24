// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "Capturar uma região para uma issue",
  "screenRegion.intro":
    "Escolha Escolher região da tela, confirme em Aprovações e arraste a área desejada com o seletor do sistema (Esc cancela). Funciona só no macOS. A imagem fica nesta página e não é salva; a issue é criada apenas como texto, no GitHub, depois de você aprová-la de novo.",
  "screenRegion.unavailable":
    "A captura de região está desativada. Ative a capacidade Captura de região da tela e permita a captura de tela para usá-la. Funciona só no macOS.",
  "screenRegion.cancelled": "Você cancelou a seleção, então nada foi capturado.",
  "screenRegion.declined": "Você recusou, então nada foi capturado.",
  "screenRegion.blocked": "A parada de emergência está ativa, então nada foi capturado.",
  "screenRegion.timeout":
    "Nenhuma região foi escolhida a tempo ou o pedido não foi aprovado; nada foi capturado.",
  "screenRegion.failed": "Não foi possível capturar a região: {message}",
  "screenRegion.badImage": "A captura não era uma imagem PNG válida e foi descartada.",
  "screenRegion.tooLarge": "A região capturada tem mais de 5 MiB e foi descartada.",
  "screenRegion.unsupported": "A captura de região só é compatível com o macOS.",
  "screenRegion.expired": "A captura não estava mais disponível. Escolha uma região novamente.",
  "screenRegion.trackerUnsupported":
    "Somente o GitHub pode criar uma issue daqui; Linear e Jira ainda não, então nada foi enviado.",
};
