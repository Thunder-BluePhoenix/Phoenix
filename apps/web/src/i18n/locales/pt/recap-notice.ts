// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { recapNotice as enrecapNotice } from "../../en/recap-notice";

/** Machine-translated; unreviewed. */
export const recapNotice: Record<keyof typeof enrecapNotice, string> = {
  "recapNotice.title": "Aviso do resumo semanal",
  "recapNotice.intro":
    "Toda segunda-feira às 09:00 no horário local, mostra um aviso na lista de notificações do próprio Phoenix com as contagens da semana passada. Desativado por padrão. O texto é fixo e só tem números (sem nomes, caminhos ou títulos), não chama nenhum modelo nem usa a rede, e é ignorado durante o horário silencioso do Proativo, no modo silencioso de notificações e durante uma parada de emergência. No máximo um por semana; se o Phoenix não estava em execução na segunda, é mostrado uma vez mais tarde na mesma semana.",
  "recapNotice.enable": "Mostrar um aviso do resumo semanal na segunda-feira",
  "recapNotice.last": "Último aviso da semana {week}.",
  "recapNotice.never": "Nenhum aviso do resumo semanal foi mostrado ainda.",
  "recapNotice.error":
    "Não foi possível carregar ou salvar a configuração do aviso do resumo semanal.",
  "recapNotice.midweek": "Ativar no meio da semana aguarda a próxima segunda-feira.",
};
