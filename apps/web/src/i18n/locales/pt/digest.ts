// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { digest as endigest } from "../../en/digest";

/** Machine-translated; unreviewed. */
export const digest: Record<keyof typeof endigest, string> = {
  "digest.title": "Resumo diário",
  "digest.yesterday": "Ontem",
  "digest.today": "Hoje (planos confirmados)",
  "digest.blockers": "Impedimentos",
  "digest.endOfDay": "Fim do dia",
  "digest.source": "Fonte",
  "digest.none": "Nenhuma atividade vinculada",
  "digest.date": "Data",
  "digest.localNote":
    "Criado localmente a partir de atividades vinculadas. Nenhum modelo na nuvem foi usado.",
  "digest.error": "Não foi possível carregar ou copiar o resumo.",
  "digest.loading": "Carregando resumo…",
  "digest.copy": "Copiar com fontes",
  "digest.copied": "Copiado",
  "digest.sendUnavailable":
    "O envio para Slack e Teams está indisponível até conectar uma integração aprovada.",
  "digest.back": "Voltar ao resumo",
  "digest.eventTitle": "Evidência do evento",
  "digest.eventMissing": "Este evento não está mais disponível.",
  "digest.unverified":
    "Não verificado: é uma alegação de evento armazenada localmente, não evidência verificada pelo provedor.",
  "digest.commitTitle": "Commit",
  "digest.commitMissing": "Este commit não está em um repositório monitorado.",
  "digest.noneIncomplete": "Nada encontrado nas fontes que puderam ser lidas.",
  "digest.noticeHeading": "Resumo incompleto",
  "digest.noticeUnavailable":
    "Não foi possível ler, então o resumo pode estar sem atividade: {sources}.",
  "digest.noticePartial":
    "Somente os registros mais recentes foram lidos; atividade mais antiga pode estar faltando: {sources}.",
  "digest.noticeUnattributed":
    "Nenhuma identidade git (user.email) está configurada, então os commits foram omitidos em vez de mostrados como seus: {sources}.",
  "digest.sources.git": "repositórios git",
  "digest.sources.events": "histórico de eventos",
  "digest.sources.sessions": "sessões de agente",
  "digest.sources.meetings": "reuniões",
};
