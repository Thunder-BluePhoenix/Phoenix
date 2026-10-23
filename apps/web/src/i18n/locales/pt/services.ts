// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { services as enservices } from "../../en/services";

/** Machine-translated; unreviewed (see ../../README.md). */
export const services: Record<keyof typeof enservices, string> = {
  "services.common.notYetLoaded": "Ainda não carregado.",

  "services.overview.nothingRunning": "Nada em execução.",
  "services.overview.taskProgress": "Progresso de {title}",
  "services.overview.showFewer": "Mostrar menos",
  "services.overview.showAll":
    "{count, plural, one {Mostrar # tarefa} other {Mostrar todas as # tarefas}}",
  "services.overview.stateFor": "por {since}",
  "services.overview.recordingActive": "A gravação está ativa.",
  "services.overview.activeTasks": "Tarefas ativas",
  "services.overview.quickActions": "Ações rápidas",
  "services.overview.dismissErrors": "Dispensar erros",
  "services.overview.wake": "Acordar o Fawkes",
  "services.overview.pause": "Pausar o Fawkes",
  "services.overview.releaseStop": "Liberar a parada de emergência",
  "services.overview.confirmStop": "Confirmar: parar todas as capacidades",
  "services.overview.emergencyStop": "Parada de emergência",
  "services.overview.stopOn":
    "A parada de emergência está ativada: todas as capacidades estão desativadas e as ações estão bloqueadas.",

  "services.integrations.agents.title": "Agentes de programação",
  "services.integrations.agents.empty": "Nenhum agente de programação reportou ainda.",
  "services.integrations.agents.stateReason": "{state} ({reason})",
  "services.integrations.agents.state.started": "Iniciado",
  "services.integrations.agents.state.working": "Trabalhando",
  "services.integrations.agents.state.waiting": "Precisa da sua resposta",
  "services.integrations.agents.state.idle": "Ocioso",
  "services.integrations.agents.state.completed": "Concluído",
  "services.integrations.agents.state.failed": "Falhou",
  "services.integrations.frappe.title": "Sites Frappe",
  "services.integrations.frappe.empty":
    "Nenhum site encontrado. Selecione um bench em Capacidades.",
  "services.integrations.frappe.status.checking": "Verificando",
  "services.integrations.frappe.status.healthy": "Saudável",
  "services.integrations.frappe.status.unhealthy": "Sem resposta",
  "services.integrations.frappe.responseMs": "{ms} ms",
  "services.integrations.frappe.lastHealthy": "Última vez saudável: {ago}",

  "services.capabilities.empty": "Nenhuma capacidade instalada.",
  "services.capabilities.status.installed": "Não ativada",
  "services.capabilities.status.enabled": "Ativada",
  "services.capabilities.status.disabled": "Desativada",
  "services.capabilities.status.failed": "Falha ao iniciar",
  "services.capabilities.status.disconnected": "Não está em execução",
  "services.capabilities.health.healthy": "saudável",
  "services.capabilities.health.degraded": "degradada",
  "services.capabilities.health.unhealthy": "com problemas",
  "services.capabilities.enable": "Ativar",
  "services.capabilities.disable": "Desativar",
  "services.capabilities.enableNamed": "Ativar {name}",
  "services.capabilities.disableNamed": "Desativar {name}",
  "services.capabilities.version": "v{version}",
  "services.capabilities.stoppedByKill": "parada pela parada de emergência",
  "services.capabilities.permissions": "Permissões ({count})",
  "services.capabilities.granted": "(concedida)",
  "services.capabilities.notGranted": "(não concedida)",
  "services.capabilities.accesses": "Acessa: {categories}",

  "services.media.heading": "Tocando agora · {name}",
  "services.media.notRunning": "{name} não está em execução.",
  "services.media.nothingPlaying": "Nada tocando",
  "services.media.previous": "Anterior",
  "services.media.next": "Próxima",
  "services.media.play": "Reproduzir",
  "services.media.pause": "Pausar",
  "services.media.shuffleOn": "Aleatório ativado",
  "services.media.shuffleOff": "Aleatório desativado",
  "services.media.repeat": "Repetir: {mode}",
  "services.media.repeatMode.off": "desativado",
  "services.media.repeatMode.one": "uma",
  "services.media.repeatMode.all": "todas",
  "services.media.seek": "Posição",
  "services.media.volume": "Volume",
  "services.media.waitingApproval": "Aguardando a sua aprovação…",

  "services.portfolio.title": "Portfólio",
  "services.portfolio.change24h": "24 h",
  "services.portfolio.chart": "Valor em 7 dias",
  "services.portfolio.unpriced":
    "{count, plural, one {# sem preço, fora do total.} other {# sem preço, fora do total.}}",
  "services.portfolio.sourceError": "{name}: {error}",
  "services.portfolio.sourceUnreadable": "{name}: não foi possível ler",
  "services.portfolio.prices": "Preços: {source}.",
  "services.portfolio.updated": "Atualizado {ago}.",

  "services.ai.title": "Provedores de IA",
  "services.ai.empty": "Nenhum provedor de IA encontrado.",
  "services.ai.locality.local": "Neste dispositivo",
  "services.ai.locality.cloud": "Nuvem (sai deste dispositivo)",
  "services.ai.automatic": "Automático (primeiro neste dispositivo)",
  "services.ai.defaultModel": "modelo padrão",
  "services.ai.provider.available": "Disponível",
  "services.ai.provider.unavailable": "Indisponível",
  "services.ai.provider.unavailableReason": "Indisponível: {reason}",
  "services.ai.provider.keyNotNeeded": "Nenhuma chave necessária",
  "services.ai.provider.keySet": "Chave definida",
  "services.ai.provider.keyMissing": "Chave ausente",
  "services.ai.provider.replaceKey": "Substituir chave",
  "services.ai.provider.setKey": "Definir chave",
  "services.ai.provider.apiKey": "Chave de API de {provider}",
  "services.ai.provider.keyNote":
    "Somente gravação: ela é guardada no chaveiro do seu OS e nunca é exibida novamente. Só é usada se você permitir IA externa.",
  "services.ai.provider.saveKey": "Salvar chave de {provider}",
  "services.ai.provider.removeKey": "Remover chave de {provider}",
  "services.ai.provider.keySaved":
    "Chave definida. Ela é guardada no chaveiro do seu OS e nunca é exibida novamente.",
  "services.ai.provider.keyRemoved": "Chave removida do seu chaveiro.",
  "services.ai.endpoints.legend": "Endpoints personalizados (servidores compatíveis com OpenAI)",
  "services.ai.endpoints.note":
    "O Phoenix descobre se um endereço está neste computador ou na nuvem; você não pode declará-lo. Tudo o que não for este computador deve usar https.",
  "services.ai.endpoints.empty": "Nenhum endpoint personalizado.",
  "services.ai.endpoints.list": "Endpoints personalizados",
  "services.ai.endpoints.remove": "Remover o endpoint {label}",
  "services.ai.endpoints.id": "ID",
  "services.ai.endpoints.baseUrl": "URL base",
  "services.ai.endpoints.addressLocal": "Este endereço está neste dispositivo.",
  "services.ai.endpoints.addressCloud": "Este endereço está na nuvem (sai deste dispositivo).",
  "services.ai.endpoints.preset": "Predefinição (opcional)",
  "services.ai.endpoints.add": "Adicionar endpoint",
  "services.ai.endpoints.added": "Endpoint {name} adicionado.",
  "services.ai.endpoints.removed": "Endpoint {name} removido.",
  "services.ai.endpoints.tooMany": "Você pode adicionar no máximo {max} endpoints.",
  "services.ai.endpoints.badId":
    "O ID precisa ter de 2 a 24 caracteres: letras minúsculas, dígitos e hifens, começando com uma letra.",
  "services.ai.endpoints.idTaken": "Esse ID já é usado por outro provedor.",
  "services.ai.endpoints.badName": "O nome precisa ter de 1 a 40 caracteres.",
  "services.ai.endpoints.urlInvalid":
    "Informe um endereço completo, como https://api.example.com/v1.",
  "services.ai.endpoints.urlScheme": "O endereço deve começar com https:// ou http://.",
  "services.ai.endpoints.urlInsecure":
    "Use https; http simples só é permitido para este computador.",
  "services.ai.routing.legend": "Qual modelo faz o quê",
  "services.ai.routing.note":
    "Uma rota na nuvem ainda precisa da permissão para enviar dados a IA externa e da autorização para o tipo de memória, ambas abaixo. Sem elas, nada é enviado e o motivo é exibido no lugar.",
  "services.ai.routing.providerLocal": "{label} (neste dispositivo)",
  "services.ai.routing.providerCloud": "{label} (nuvem)",
  "services.ai.routing.chat.name": "Chat",
  "services.ai.routing.chat.help": "Respostas às suas perguntas no chat e em Pergunte ao Fawkes.",
  "services.ai.routing.chat.provider": "Provedor do chat",
  "services.ai.routing.chat.model": "Modelo do chat (opcional)",
  "services.ai.routing.chat.save": "Salvar rota do chat",
  "services.ai.routing.chat.saved": "Rota do chat salva.",
  "services.ai.routing.summaries.name": "Resumos",
  "services.ai.routing.summaries.help":
    "Resumos de reuniões, planos, extração e diagnóstico de CI.",
  "services.ai.routing.summaries.provider": "Provedor dos resumos",
  "services.ai.routing.summaries.model": "Modelo dos resumos (opcional)",
  "services.ai.routing.summaries.save": "Salvar rota dos resumos",
  "services.ai.routing.summaries.saved": "Rota dos resumos salva.",
  "services.ai.routing.cleanup.name": "Limpeza",
  "services.ai.routing.cleanup.help": "Organização do texto ditado.",
  "services.ai.routing.cleanup.provider": "Provedor da limpeza",
  "services.ai.routing.cleanup.model": "Modelo da limpeza (opcional)",
  "services.ai.routing.cleanup.save": "Salvar rota da limpeza",
  "services.ai.routing.cleanup.saved": "Rota da limpeza salva.",
  "services.ai.prices.legend": "Preços (opcional)",
  "services.ai.prices.note":
    "O Phoenix não tem preços embutidos. Os custos são exibidos apenas a partir dos números que você informar.",
  "services.ai.prices.modelKey": "Chave do modelo, linha {n}",
  "services.ai.prices.input": "Entrada em $ por 1M de tokens, linha {n}",
  "services.ai.prices.output": "Saída em $ por 1M de tokens, linha {n}",
  "services.ai.prices.removeRow": "Remover a linha de preço {n}",
  "services.ai.prices.add": "Adicionar preço",
  "services.ai.prices.save": "Salvar preços",
  "services.ai.prices.saved": "Preços salvos.",
  "services.ai.prices.badKey":
    'Use o formato provider:model para a chave do modelo, por exemplo "openai:gpt-4o".',
  "services.ai.prices.duplicateKey": "A chave de modelo {key} aparece duas vezes.",
  "services.ai.prices.badNumber": "Os preços de {key} devem ser números maiores ou iguais a zero.",

  "services.model.loading": "Modelo: carregando…",
  "services.model.button": "Modelo: {label}",
  "services.model.current": "{model} · {provider}",
  "services.model.default": "Padrão ({model})",
  "services.model.keyHint":
    "Adicione a chave em Configurações, Provedores de IA. Você ainda pode escolhê-lo.",
  "services.model.aiOff": "A IA está desativada",
  "services.model.providers": "Provedores",
  "services.model.models": "Modelos",
  "services.model.modelsFor": "Modelos de {provider}",
  "services.model.loadingModels": "Carregando modelos…",
  "services.model.loadFailed": "Não foi possível carregar a lista de modelos",
  "services.model.listFailed":
    "Não foi possível listar os modelos: {error}. Mostrando apenas o modelo padrão.",
  "services.model.notListed": "Este provedor não listou os seus modelos.",
  "services.model.cloudNote":
    "Um modelo na nuvem recebe apenas o que você permitiu em Configurações, IA.",

  "services.demo.banner": "Demonstração - nada é salvo",
  "services.demo.bannerDetail":
    "Este é um roteiro guiado em um Core separado e temporário. Os seus dados não são alterados.",
  "services.demo.settingsTitle": "Modo de demonstração",
  "services.demo.settingsIntro":
    "Veja o Fawkes reagir a builds, agentes, deploys e reuniões. A demonstração roda em um Core separado que mantém tudo na memória, não envia nada para lugar nenhum e é excluído quando você a encerra. Os seus próprios dados não são lidos nem alterados.",
  "services.demo.start": "Iniciar demonstração",
  "services.demo.starting": "Iniciando demonstração...",
  "services.demo.stop": "Encerrar demonstração e voltar",
  "services.demo.play": "Reproduzir este passo",
  "services.demo.next": "Próximo passo",
  "services.demo.previous": "Passo anterior",
  "services.demo.playing": "Reproduzindo",
  "services.demo.finished":
    "Esse foi o último passo. Encerre a demonstração para voltar ao seu Phoenix.",
  "services.demo.stepOf": "Passo {n} / {total}",
  "services.demo.stepCount": "{count, plural, one {# passo} other {# passos}}",
  "services.demo.auto.group": "Percurso automático",
  "services.demo.auto.play": "Reproduzir automaticamente",
  "services.demo.auto.pause": "Pausar",
  "services.demo.auto.resume": "Retomar",
  "services.demo.auto.stop": "Parar e recomeçar",
  "services.demo.auto.running":
    "Reproduzindo sozinho, um passo a cada {seconds} segundos. Qualquer clique em um passo ou página o interrompe.",
  "services.demo.auto.paused": "Em pausa. Retome para continuar a partir deste passo.",
  "services.demo.auto.reducedMotion":
    "Seu sistema pede menos movimento, então o percurso só avança quando você pressiona «Reproduzir automaticamente».",
  "services.demo.startFailed": "Não foi possível iniciar a demonstração",
  "services.demo.stopFailed":
    "Não foi possível encerrar a demonstração corretamente; ela para sozinha quando fica ociosa",
  "services.demo.playFailed": "Não foi possível reproduzir o passo da demonstração",
  "services.demo.invalidSession":
    "O Core enviou um endereço de demonstração inválido; a demonstração não foi aberta",
  "services.demo.offline":
    "O Core da demonstração está inacessível. Ele pode ter parado após ficar ocioso.",
  "services.demo.recordingActive":
    "Uma chamada está sendo gravada. Pare a gravação antes de iniciar a demonstração.",
  "services.demo.voiceStopped":
    "A escuta por voz foi desativada para a demonstração. Ative-a novamente depois.",
  "services.demo.failureDetail": "{message}: {detail}",
  "services.demo.caption.build-pass":
    "Um build é executado e passa. O Fawkes trabalha enquanto ele roda e depois comemora. Nada aqui é real.",
  "services.demo.caption.build-fail":
    "Um build falha. O Fawkes mostra o erro e o mantém na tela até você confirmar a leitura.",
  "services.demo.caption.tests":
    "Os testes rodam e passam. O Fawkes mostra o trabalho e o limpa quando termina.",
  "services.demo.caption.agent-waiting":
    "Um agente de programação trabalha e depois precisa de você. O Fawkes espera e diz o que está aguardando.",
  "services.demo.caption.agent-done":
    "Um agente de programação termina. O Fawkes marca a tarefa como concluída.",
  "services.demo.caption.deploy":
    "Um deploy de homologação avança. O Fawkes o acompanha passo a passo.",
  "services.demo.caption.deploy-fail":
    "Um deploy de produção falha. O Fawkes o sinaliza como erro imediatamente.",
  "services.demo.caption.meeting":
    "Uma reunião é gravada, transcrita e resumida. O Fawkes mostra o indicador de gravação enquanto ela durar.",
  "services.demo.caption.frappe-down":
    "Um site Frappe cai e depois se recupera. O Fawkes avisa você e limpa o aviso.",
  "services.demo.caption.merge-conflict":
    "Um conflito de merge aparece e é resolvido. O Fawkes avisa você e, em seguida, o commit é concluído.",
};
