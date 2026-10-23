// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlancesB as enServiceGlancesB } from "../../en/service-glances-b";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlancesB: Record<keyof typeof enServiceGlancesB, string> = {
  "services.glance.resend.notConfigured":
    "Adicione uma chave de API do Resend nos segredos da capacidade Resend para ver aqui o estado das entregas.",
  "services.glance.resend.empty": "Nenhum e-mail enviado recentemente para contar.",
  "services.glance.resend.summary":
    "{count, plural, one {# e-mail recente} other {# e-mails recentes}}",
  "services.glance.resend.newest": "Mais recente: {time}",
  "services.glance.resend.privacy":
    "Apenas contagens. Os assuntos e os destinatários nunca são mostrados aqui.",
  "services.glance.resend.state.delivered": "Entregue",
  "services.glance.resend.state.inFlight": "A caminho",
  "services.glance.resend.state.delayed": "Atrasado",
  "services.glance.resend.state.bounced": "Devolvido",
  "services.glance.resend.state.complained": "Marcado como spam",
  "services.glance.resend.state.failed": "Falhou",
  "services.glance.resend.state.other": "Outro",

  "services.glance.notion.notConfigured":
    "Adicione um token de integração do Notion nos segredos da capacidade Notion para ver aqui as suas páginas monitoradas.",
  "services.glance.notion.empty":
    "Nenhuma página ou base de dados monitorada para mostrar. Liste-as por id nas configurações da capacidade Notion.",
  "services.glance.notion.summary":
    "{count, plural, one {# item monitorado} other {# itens monitorados}}",
  "services.glance.notion.privacy":
    "Apenas títulos e horários de edição. O conteúdo das páginas nunca é lido.",
  "services.glance.notion.untitled": "Sem título",
  "services.glance.notion.kind.page": "Página",
  "services.glance.notion.kind.database": "Base de dados",
  "services.glance.notion.kind.archived": "Arquivado",
  "services.glance.notion.edited": "Editado {time}",
  "services.glance.notion.open": "Abrir no Notion",
  "services.glance.notion.openNamed": "Abrir {title} no Notion",

  "services.glance.calcom.notConfigured":
    "Adicione uma chave de API do Cal.com nos segredos da capacidade Cal.com para ver aqui as suas reservas.",
  "services.glance.calcom.empty": "Nenhuma reserva próxima.",
  "services.glance.calcom.summary":
    "{count, plural, one {# reserva próxima} other {# reservas próximas}}",
  "services.glance.calcom.privacy":
    "Apenas horários e número de participantes. Nomes e endereços de e-mail nunca são mostrados aqui.",
  "services.glance.calcom.booking": "Reserva",
  "services.glance.calcom.status.accepted": "Confirmada",
  "services.glance.calcom.status.pending": "Aguardando confirmação",
  "services.glance.calcom.status.other": "Outro",
  "services.glance.calcom.attendees":
    "{count, plural, one {# participante} other {# participantes}}",
  "services.glance.calcom.more":
    "{count, plural, one {# reserva a mais} other {# reservas a mais}}",
};
