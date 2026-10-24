// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { calendar as enCalendar } from "../../en/calendar";

/** Machine-translated; unreviewed. */
export const calendar: Record<keyof typeof enCalendar, string> = {
  "calendar.title": "Preparação para reuniões",
  "calendar.disabled": "O calendário está desligado. Ative-o para ver as próximas reuniões.",
  "calendar.empty": "Sem reuniões futuras.",
  "calendar.loading": "A ler reuniões…",
  "calendar.error": "Não foi possível ler o calendário.",
  "calendar.refresh": "Atualizar reuniões",
  "calendar.prep": "Preparação",
  "calendar.decisions": "Decisões anteriores",
  "calendar.actions": "Ações pendentes",
  "calendar.noPrep": "Sem decisões revistas ou ações pendentes relevantes.",
  "calendar.notetaker": "Iniciar anotador",
  "calendar.notetakerInfo": "A gravação só começa após escolher iniciar e conceder permissão.",
  "calendar.freeze": "Bloqueio de implantação",
  "calendar.busy": "Evento privado",
  "calendar.source": "De {meeting}",
  "calendar.unconfigured":
    "Nenhum provedor de calendário está conectado. Conecte Google, Microsoft ou CalDAV para ver reuniões.",
  "calendar.unavailable":
    "O feed do calendário está indisponível. Não é possível mostrar as próximas reuniões nem os congelamentos de implantação.",
  "calendar.stale":
    "O feed do calendário está desatualizado. As reuniões e os congelamentos de implantação não são confiáveis até a atualização.",
  "calendar.lastChecked": "Última leitura bem-sucedida: {time}",
  "calendar.prepIncomplete": "A preparação está incompleta para algumas reuniões.",
};
