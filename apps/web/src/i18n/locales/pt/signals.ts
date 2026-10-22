// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { signals as ensignals } from "../../en/signals";

/** Machine-translated; unreviewed. */
export const signals: Record<keyof typeof ensignals, string> = {
  "signals.title": "Sinais de engenharia",
  "signals.intro":
    "Verifique avisos de dependências, testes instáveis, tendências de duração e diferenças nas chaves de configuração dos repositórios escolhidos. A leitura não altera arquivos.",
  "signals.root": "Pasta do repositório",
  "signals.add": "Monitorar pasta",
  "signals.remove": "Parar de monitorar",
  "signals.refresh": "Verificar agora",
  "signals.empty": "Não há sinais atuais para os repositórios monitorados.",
  "signals.unconfigured": "Escolha uma pasta de repositório para começar.",
  "signals.error": "Não foi possível ler os sinais de engenharia.",
  "signals.advisory": "Aviso de dependência",
  "signals.flaky_test": "Teste instável",
  "signals.duration_trend": "Aumento da duração",
  "signals.config_drift": "Chave de configuração ausente",
  "signals.optin":
    "Notificações proativas exigem consentimento explícito e respeitam o horário de silêncio e o limite por hora.",
  "signals.privacy": "Somente os nomes das chaves são comparados; os valores nunca são exibidos.",
  "signals.unknown.advisories":
    "Avisos de dependências não avaliados (status desconhecido, não limpo):",
  "signals.unknown.history":
    "Histórico de testes e tendências de duração não avaliados (status desconhecido, não limpo):",
};
