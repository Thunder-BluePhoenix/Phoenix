// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { awakeSettings as enAwakeSettings } from "../../en/awake-settings";

/** Machine-translated; unreviewed. */
export const awakeSettings: Record<keyof typeof enAwakeSettings, string> = {
  "awakeSettings.title": "Manter ativo",
  "awakeSettings.intro":
    "Impede que este computador entre em repouso por um tempo definido, por exemplo enquanto uma compilação ou um agente roda. Uma sessão sempre tem um fim: de 1 minuto a 7 dias.",
  "awakeSettings.approval":
    "Iniciar, estender e encerrar uma sessão pedem primeiro a sua aprovação em Aprovações. Nada muda até você aprovar.",
  "awakeSettings.off": "Manter ativo está desligado, então nenhuma sessão pode começar.",
  "awakeSettings.enable": "Ligar Manter ativo",
  "awakeSettings.status.title": "Sessão atual",
  "awakeSettings.status.idle":
    "Nenhuma sessão em andamento. O computador entra em repouso normalmente.",
  "awakeSettings.status.unreadable": "Não foi possível ler o estado de Manter ativo.",
  "awakeSettings.status.mode.timed": "(com tempo)",
  "awakeSettings.status.mode.agents_grace": "(enquanto os agentes trabalham)",
  "awakeSettings.status.label": "Rótulo: {label}",
  "awakeSettings.end.button": "Encerrar sessão",
  "awakeSettings.start.title": "Iniciar uma sessão",
  "awakeSettings.start.durations": "Durações predefinidas",
  "awakeSettings.start.minutes": "Minutos",
  "awakeSettings.start.label": "Rótulo (opcional)",
  "awakeSettings.start.labelInvalid":
    "O rótulo deve ter de 1 a {max} caracteres, sem caracteres de controle ou invisíveis.",
  "awakeSettings.start.submit": "Pedir para iniciar",
  "awakeSettings.outcome.waiting": "Aguardando sua aprovação em Aprovações…",
  "awakeSettings.outcome.succeeded.start": "Aprovado: a sessão começou.",
  "awakeSettings.outcome.succeeded.extend": "Aprovado: foi adicionado tempo à sessão.",
  "awakeSettings.outcome.succeeded.end": "Aprovado: a sessão terminou.",
  "awakeSettings.outcome.denied": "Você recusou, então nada foi alterado.",
  "awakeSettings.outcome.blocked": "A parada de emergência está ativa, então nada foi alterado.",
  "awakeSettings.outcome.timeout":
    "O pedido não foi aprovado a tempo ou foi cancelado, então nada foi alterado.",
  "awakeSettings.outcome.failed": "Manter ativo não conseguiu fazer isso: {message}",
};
