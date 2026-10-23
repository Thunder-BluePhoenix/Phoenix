// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { capture as encapture } from "../../en/capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const capture: Record<keyof typeof encapture, string> = {
  // Shared audio/mic
  "capture.audio.connectionFailed": "A conexão de áudio falhou.",
  "capture.audio.connectionClosed": "A conexão de áudio foi encerrada.",
  "capture.audio.invalidReply": "Resposta inválida do Core.",
  "capture.audio.micUnavailable": "Microfone indisponível: {reason}",
  "capture.audio.waitingForPermission": "Aguardando a permissão do microfone…",
  "capture.audio.coreNotConnected": "O Phoenix Core não está conectado.",
  "capture.audio.emergencyStop": "A parada de emergência está ativada.",
  "capture.audio.recognizerAvailable": "Reconhecedor de fala: disponível. {detail}",
  "capture.audio.recognizerUnavailable": "Reconhecedor de fala: indisponível. {detail}",
  "capture.mic.unsupported": "Este navegador não pode usar um microfone",
  "capture.mic.sampleRate": "Este dispositivo não consegue fornecer áudio de microfone a 16 kHz",
  "capture.notetaker.settings.title": "Anotador",
  "capture.notetaker.settings.savedOn": "O anotador está ativado.",
  "capture.notetaker.settings.savedOff": "O anotador está desativado.",
  "capture.notetaker.settings.intro":
    "O anotador grava uma chamada neste computador, sem nenhum bot entrando, e a transforma em transcrição, resumo e tarefas para você revisar. Ele fica {off} até você ativá-lo aqui. Ativá-lo {not} é consentimento para gravar outras pessoas: cada gravação pergunta a você de novo.",
  "capture.notetaker.settings.introOff": "desativado",
  "capture.notetaker.settings.introNot": "não",
  "capture.notetaker.settings.audio.lead": "O áudio nunca é armazenado.",
  "capture.notetaker.settings.audio.body":
    "Ele fica apenas na memória, é transformado em texto em pequenos trechos neste dispositivo e é apagado assim que cada trecho termina ou a gravação para.",
  "capture.notetaker.settings.kept.lead": "O que é mantido:",
  "capture.notetaker.settings.kept.body":
    "a transcrição, escrita enquanto a chamada acontece, e um resumo feito por um modelo neste dispositivo. Se nenhum modelo responder, você recebe a transcrição sem resumo.",
  "capture.notetaker.settings.speakers.lead": "Falantes:",
  "capture.notetaker.settings.speakers.body":
    "apenas “Você” e “Outros”. O Phoenix não distingue as outras pessoas.",
  "capture.notetaker.settings.captured.lead": "O que é capturado:",
  "capture.notetaker.settings.banner":
    "O Fawkes mostra “Gravando” em todas as telas, com um botão Parar, durante toda a gravação.",
  "capture.notetaker.settings.toggle": "Ativar o anotador",
  "capture.notetaker.settings.killSwitch":
    "A parada de emergência está ativada: a gravação está bloqueada.",
  "capture.notetaker.banner.title": "Gravando uma chamada",
  "capture.notetaker.banner.stop": "Parar a gravação",
  "capture.notetaker.banner.stopping": "Parando…",
  "capture.notetaker.micOnly":
    "Somente o seu microfone está sendo gravado; os outros participantes não são capturados.",
  "capture.notetaker.consent.title": "Antes de gravar",
  "capture.notetaker.consent.notice":
    "Avise a todos na chamada que ela está sendo gravada. Gravar sem consentimento pode ser ilegal onde você ou eles moram.",
  "capture.notetaker.consent.checkbox": "Avisei a todos na chamada que ela está sendo gravada",
  "capture.notetaker.consent.titleField": "Título {optional}",
  "capture.notetaker.consent.optional": "(opcional)",
  "capture.notetaker.consent.start": "Iniciar gravação",
  "capture.notetaker.blocked.unavailable": "O status do anotador não está disponível.",
  "capture.notetaker.blocked.off":
    "O anotador está desativado. Ative-o em Configurações, em Anotador.",
  "capture.notetaker.blocked.noConsentChannel":
    "A gravação precisa de uma forma confiável de perguntar a você antes. {detail}",
  "capture.notetaker.blocked.inProgress": "Já há uma gravação em andamento.",
  "capture.notetaker.record.title": "Gravar uma chamada",
  "capture.notetaker.record.intro":
    "Grava o microfone deste computador, sem bot. O áudio nunca é armazenado; você recebe uma transcrição e, se um modelo neste dispositivo responder, um resumo.",
  "capture.notetaker.record.saved": "A gravação foi salva.",
  "capture.notetaker.record.openMeeting": "Abrir a reunião",
  "capture.notetaker.recorder.stopped":
    "A gravação parou. O que foi transcrito até agora está salvo.",
  "capture.notetaker.recorder.stoppedWithReason":
    "A gravação parou: {reason}. O que foi transcrito até agora está salvo.",
  "capture.voice.phase.idle": "A voz está desativada",
  "capture.voice.phase.starting": "Iniciando o microfone…",
  "capture.voice.phase.waiting": "Aguardando “OK Fawkes”",
  "capture.voice.phase.awake": "O Fawkes está ouvindo seu pedido",
  "capture.voice.phase.thinking": "Trabalhando no seu pedido…",
  "capture.voice.banner.label": "Assistente de voz",
  "capture.voice.banner.live": "Microfone ligado. {phase}.",
  "capture.voice.banner.stop": "Parar de ouvir",
  "capture.voice.banner.fawkes": "Fawkes:",
  "capture.voice.banner.openDraft": "Abrir o rascunho do e-mail",
  "capture.voice.blocked.unavailable": "O status do assistente de voz não está disponível.",
  "capture.voice.blocked.off":
    "O assistente de voz está desativado. Ative-o em Configurações, em Voz.",
  "capture.voice.reason.stopped": "A voz parou.",
  "capture.voice.reason.disabled": "A voz foi desativada.",
  "capture.voice.reason.killSwitch": "A voz parou: a parada de emergência está ativada.",
  "capture.voice.reason.badFrame": "A voz parou: o microfone enviou áudio inválido.",
  "capture.voice.reason.tooFast": "A voz parou: o microfone enviou áudio rápido demais.",
  "capture.voice.reason.connectionClosed": "A voz parou: a conexão foi encerrada.",
  "capture.voice.reason.streamNotOpened": "A voz parou: o microfone não iniciou a tempo.",
  "capture.voice.reason.recogniserFailed": "A voz parou: o reconhecimento de fala falhou.",
  "capture.voice.reason.shutdown": "A voz parou: o Phoenix Core está sendo encerrado.",
  "capture.voice.reason.refused": "A voz parou: o Core recusou o áudio.",
  "capture.voice.micCouldNotStart": "Não foi possível iniciar o microfone: {reason}",
  "capture.voice.settings.titleShort": "Voz",
  "capture.voice.settings.title": "Voz (“OK Fawkes”)",
  "capture.voice.settings.unavailable":
    "As configurações de voz não estão disponíveis no Phoenix Core.",
  "capture.voice.settings.savedOn": "A voz está ativada.",
  "capture.voice.settings.savedOff": "A voz está desativada. O microfone foi liberado.",
  "capture.voice.settings.intro":
    "Diga “OK Fawkes” e pergunte sobre seus serviços. A voz fica {off} até você ativá-la aqui, e ativá-la é seu consentimento apenas para voz.",
  "capture.voice.settings.introOff": "desativada",
  "capture.voice.settings.whileOn.lead": "Enquanto está ativada:",
  "capture.voice.settings.whileOn.body":
    "esta página mantém seu microfone aberto e mostra “Microfone ligado” o tempo todo. Uma verificação simples de volume roda neste dispositivo a cada instante de som; só quando alguém fala um trecho curto é entregue ao reconhecedor de fala neste dispositivo.",
  "capture.voice.settings.leaves.lead": "O que sai deste dispositivo:",
  "capture.voice.settings.leaves.body":
    "nada. O reconhecimento é local; não há caminho de fala pela nuvem. O Phoenix não produz áudio: as respostas são faladas pelo seu navegador, quando ele consegue.",
  "capture.voice.settings.kept.lead": "O que é mantido:",
  "capture.voice.settings.kept.body":
    "o áudio fica na memória por segundos e é apagado quando foi entendido, quando você para ou quando a parada de emergência é usada. Ele nunca é gravado em disco e nenhuma transcrição é armazenada. O registro de auditoria anota que um pedido aconteceu e qual ferramenta ele usou, nunca o que você disse.",
  "capture.voice.settings.canDo.lead": "O que ela pode fazer:",
  "capture.voice.settings.canDo.body":
    "ler o status dos serviços que você ativou, abrir a pílula e preparar um rascunho de e-mail para você revisar. Ela não pode alterar nada e nunca pode aprovar uma ação: só você pode, no painel do mascote. Ela pode dizer “negar”.",
  "capture.voice.settings.limits.lead": "Limites:",
  "capture.voice.settings.limits.body":
    "a frase de ativação é encontrada transcrevendo trechos curtos de fala (não é um detector de palavra-chave dedicado), então ela pode não ser detectada ou confundir palavras parecidas.",
  "capture.voice.settings.toggle": "Ativar “OK Fawkes”",
  "capture.voice.settings.killSwitch": "A parada de emergência está ativada: a voz está bloqueada.",
  "capture.voice.settings.notListening":
    "A voz está ativada, mas esta página ainda não está ouvindo (após recarregar, o navegador pergunta de novo).",
  "capture.voice.settings.start": "Começar a ouvir",
  "capture.multimodal.title": "Captura única do dispositivo",
  "capture.multimodal.intro":
    "Solicitado por: usuário. O Core verifica sua concessão de capacidade e pede aprovação a cada uso antes de o navegador pedir acesso ao dispositivo. Nada captura em segundo plano; não há fallback para a nuvem.",
  "capture.multimodal.statusUnavailable": "O status de captura do Core não está disponível.",
  "capture.multimodal.killSwitch": "Captura indisponível: parada de emergência ativada.",
  "capture.multimodal.kind.microphone": "Microfone · um segundo de áudio WAV",
  "capture.multimodal.kind.screen": "Tela · um quadro PNG",
  "capture.multimodal.modality":
    "{label}. Modelo: {model}; provedor: {provider}; localidade: {locality}. {detail}",
  "capture.multimodal.notReported": "não informado pelo Core",
  "capture.multimodal.modalityUnavailable": "indisponível",
  "capture.multimodal.statusPending": "Status ainda não disponível.",
  "capture.multimodal.grant.microphone":
    "A concessão da capacidade de microfone não está disponível; ative-a em Capacidades antes de capturar.",
  "capture.multimodal.grant.screen":
    "A concessão da capacidade de tela não está disponível; ative-a em Capacidades antes de capturar.",
  "capture.multimodal.capture.microphone": "Capturar microfone",
  "capture.multimodal.capture.screen": "Capturar tela",
  "capture.multimodal.stop": "Parar captura",
  "capture.multimodal.phase.waitingApproval":
    "Aguardando a aprovação do Core. Revise a solicitação abaixo; nenhum dispositivo está ativo ainda.",
  "capture.multimodal.phase.approvedMicrophone":
    "O Core aprovou. Solicitando acesso ao microfone por um segundo.",
  "capture.multimodal.phase.approvedScreen": "O Core aprovou. Solicitando um quadro da tela.",
  "capture.multimodal.phase.processing": "Processando localmente; o dispositivo foi parado.",
  "capture.multimodal.error.connectionUnavailable": "Conexão de captura indisponível.",
  "capture.multimodal.error.invalidResponse": "Resposta de captura do Core inválida.",
  "capture.multimodal.error.browserUnavailable": "A captura pelo navegador não está disponível.",
  "capture.multimodal.error.frameSize": "A captura excede o tamanho de quadro permitido.",
  "capture.multimodal.error.deviceDenied": "O navegador negou o acesso ao dispositivo.",
  "capture.multimodal.error.invalidResult":
    "O Core retornou um resultado de captura local inválido.",
  "capture.multimodal.error.refused": "O Core recusou a captura.",
  "capture.multimodal.error.unexpected": "Resposta de captura do Core inesperada.",
  "capture.multimodal.error.connectionFailed": "A conexão de captura falhou.",
  "capture.multimodal.error.ended": "A captura terminou sem resultado nem aprovação.",
  "capture.multimodal.result.heading": "{what} · {provider} ({locality})",
  "capture.multimodal.result.transcript": "Transcrição",
  "capture.multimodal.result.screen": "Descrição da tela",
  "capture.multimodal.result.clear": "Limpar resultado",

  // Dictation and the pill
  "capture.dictation.mode.asSaid": "Como falado (sem limpeza)",
  "capture.dictation.mode.natural": "Natural (remove vícios de fala)",
  "capture.dictation.mode.polished": "Refinado (corrige também a gramática)",
  "capture.dictation.duration.minutesSeconds": "{minutes} min {seconds} s",
  "capture.dictation.duration.seconds": "{seconds} s",
  "capture.dictation.blocked.statusUnavailable": "O status do ditado não está disponível.",
  "capture.dictation.blocked.off": "O ditado está desativado. Ative-o em Configurações, em Ditado.",
  "capture.dictation.stopped.plain": "O ditado parou.",
  "capture.dictation.stopped.reason": "O ditado parou: {reason}.",
  "capture.dictation.nothingRecognised": "Nada foi reconhecido.",
  "capture.dictation.button.start": "Ditar",
  "capture.dictation.button.starting": "Iniciando…",
  "capture.dictation.button.recognising": "Reconhecendo…",
  "capture.dictation.button.stop": "Parar de ditar",
  "capture.dictation.button.cancel": "Cancelar ditado",
  "capture.dictation.hint":
    "Usa seu microfone apenas enquanto você dita; o áudio não é armazenado.",
  "capture.dictation.indicator.listening": "Ouvindo: seu microfone está ligado.",
  "capture.dictation.settings.title": "Ditado",
  "capture.dictation.settings.unavailable":
    "As configurações de ditado não estão disponíveis no Phoenix Core.",
  "capture.dictation.settings.intro":
    "O ditado transforma sua fala em texto neste dispositivo. Ele fica {off} até você ativá-lo aqui, e ativá-lo é seu consentimento apenas para o ditado.",
  "capture.dictation.settings.intro.off": "desativado",
  "capture.dictation.settings.enable": "Ativar o ditado",
  "capture.dictation.privacy.leaves.lead": "O que sai deste dispositivo:",
  "capture.dictation.privacy.leaves.body":
    "nada. A fala é reconhecida neste dispositivo; a limpeza opcional usa apenas um modelo neste dispositivo e nunca é enviada a um provedor na nuvem, mesmo que você tenha permitido IA na nuvem para outras coisas.",
  "capture.dictation.privacy.memory.lead": "O que fica na memória:",
  "capture.dictation.privacy.memory.body":
    "o áudio, pela duração de um ditado (no máximo {seconds, plural, one {# segundo} many {# de segundos} other {# segundos}}). Ele nunca é gravado em disco e é apagado quando o ditado termina, é cancelado ou a parada de emergência é usada.",
  "capture.dictation.privacy.stored.lead": "O que é armazenado:",
  "capture.dictation.privacy.stored.body":
    "suas configurações e listas de palavras abaixo, e contagens por dia e por app (palavras, tempo de fala, número de ditados). Nunca o texto que você dita e nunca o áudio.",
  "capture.dictation.privacy.microphone":
    "O microfone fica ligado apenas enquanto você dita, e o Fawkes mostra “Ouvindo” o tempo todo.",
  "capture.dictation.killSwitch": "A parada de emergência está ativada: o ditado está bloqueado.",
  "capture.dictation.saved.on": "O ditado está ativado.",
  "capture.dictation.saved.off": "O ditado está desativado.",
  "capture.dictation.saved.defaultMode": "Limpeza padrão salva.",
  "capture.dictation.saved.appModes": "Modos de limpeza por app salvos.",
  "capture.dictation.saved.typing": "Velocidade de digitação salva.",
  "capture.dictation.saved.vocabulary": "Listas de palavras salvas.",
  "capture.dictation.saved.statsDeleted": "Todas as estatísticas de ditado foram excluídas.",
  "capture.dictation.cleanup.heading": "Limpeza",
  "capture.dictation.cleanup.default": "Limpeza padrão",
  "capture.dictation.typing.heading": "Velocidade de digitação",
  "capture.dictation.typing.label": "Qual a sua velocidade de digitação? (palavras por minuto)",
  "capture.dictation.typing.save": "Salvar velocidade de digitação",
  "capture.dictation.typing.invalid": "Informe um número inteiro de {min} a {max}.",
  "capture.dictation.appModes.summary":
    "Limpeza por app ({count} de {max}). Um app que não está na lista usa o padrão.",
  "capture.dictation.appModes.entry": "{app}: {mode}",
  "capture.dictation.appModes.remove": "Remover {app}",
  "capture.dictation.appModes.idLabel": "Identificador do app (por exemplo, um bundle id)",
  "capture.dictation.appModes.modeLabel": "Limpeza para este app",
  "capture.dictation.appModes.set": "Definir limpeza do app",
  "capture.dictation.appModes.invalid":
    "Use letras, dígitos, ponto, hífen ou sublinhado (no máximo {max}).",
  "capture.dictation.problem.plainWords":
    "Use palavras simples separadas por espaços únicos (sem pontuação).",
  "capture.dictation.problem.maxChars":
    "{n, plural, one {No máximo # caractere.} many {No máximo # de caracteres.} other {No máximo # caracteres.}}",
  "capture.dictation.problem.maxWords":
    "{n, plural, one {No máximo # palavra.} many {No máximo # de palavras.} other {No máximo # palavras.}}",
  "capture.dictation.problem.term":
    "{n, plural, one {Até # caractere visível, sem espaços nas pontas.} many {Até # de caracteres visíveis, sem espaços nas pontas.} other {Até # caracteres visíveis, sem espaços nas pontas.}}",
  "capture.dictation.problem.soundsLike":
    "“Soa como” é necessário quando o termo não são palavras simples: {problem}",
  "capture.dictation.problem.replacement":
    "{n, plural, one {Até # caractere visível.} many {Até # de caracteres visíveis.} other {Até # caracteres visíveis.}}",
  "capture.dictation.problem.snippet":
    "{n, plural, one {Até # caractere; sem caracteres de controle ou ocultos.} many {Até # de caracteres; sem caracteres de controle ou ocultos.} other {Até # caracteres; sem caracteres de controle ou ocultos.}}",
  "capture.dictation.vocabulary.heading": "Dicionário, substituições e trechos",
  "capture.dictation.vocabulary.intro":
    "Tudo aqui é texto literal: não há padrões. A correspondência ignora maiúsculas e minúsculas e funciona com palavras inteiras.",
  "capture.dictation.vocabulary.save": "Salvar listas de palavras",
  "capture.dictation.dictionary.heading": "Dicionário ({count} de {max})",
  "capture.dictation.dictionary.intro": "Escreva um nome ou termo do jeito que você quiser.",
  "capture.dictation.dictionary.entry": "“{soundsLike}” → {term}",
  "capture.dictation.dictionary.remove": "Remover a entrada do dicionário {term}",
  "capture.dictation.dictionary.term": "Termo",
  "capture.dictation.dictionary.soundsLike": "Soa como (opcional)",
  "capture.dictation.dictionary.add": "Adicionar entrada ao dicionário",
  "capture.dictation.replacements.heading": "Substituições ({count} de {max})",
  "capture.dictation.replacements.entry": "“{from}” → “{to}”",
  "capture.dictation.replacements.entryRemoved": "“{from}” → (removido)",
  "capture.dictation.replacements.remove": "Remover a substituição {from}",
  "capture.dictation.replacements.from": "Substituir as palavras",
  "capture.dictation.replacements.to": "Por (vazio as remove)",
  "capture.dictation.replacements.add": "Adicionar substituição",
  "capture.dictation.snippets.heading": "Trechos ({count} de {max})",
  "capture.dictation.snippets.intro":
    "Um trecho só é expandido quando o ditado inteiro é exatamente o seu gatilho.",
  "capture.dictation.snippets.entry": "“{trigger}” → {text}",
  "capture.dictation.snippets.remove": "Remover o trecho {trigger}",
  "capture.dictation.snippets.trigger": "Quando eu disser",
  "capture.dictation.snippets.text": "Inserir este texto",
  "capture.dictation.snippets.add": "Adicionar trecho",
  "capture.dictation.stats.heading": "Estatísticas",
  "capture.dictation.stats.none": "Nenhum ditado ainda.",
  "capture.dictation.stats.words": "Palavras ditadas",
  "capture.dictation.stats.sessions": "Ditados",
  "capture.dictation.stats.saved": "Tempo economizado",
  "capture.dictation.stats.savedValue":
    "{duration} (digitando a {wpm, plural, one {# palavra por minuto} many {# de palavras por minuto} other {# palavras por minuto}})",
  "capture.dictation.stats.average": "Velocidade média de fala",
  "capture.dictation.stats.wordsPerMinute":
    "{n, plural, one {# palavra por minuto} many {# de palavras por minuto} other {# palavras por minuto}}",
  "capture.dictation.stats.streak": "Sequência",
  "capture.dictation.stats.days": "{n, plural, one {# dia} many {# de dias} other {# dias}}",
  "capture.dictation.stats.topApps": "Apps mais usados",
  "capture.dictation.stats.noApps": "nenhum",
  "capture.dictation.stats.unknownApp": "app desconhecido",
  "capture.dictation.stats.appWords":
    "{app} ({n, plural, one {# palavra} many {# de palavras} other {# palavras}})",
  "capture.dictation.stats.note":
    "São apenas contagens. Os nomes dos apps são privados e não são enviados a lugar nenhum. O Core os mantém até você excluí-los.",
  "capture.dictation.stats.confirmGroup": "Confirmar a exclusão das estatísticas",
  "capture.dictation.stats.confirmText":
    "Excluir todas as estatísticas de ditado? Isso não pode ser desfeito.",
  "capture.dictation.stats.confirmYes": "Sim, excluir tudo",
  "capture.dictation.stats.confirmKeep": "Manter",
  "capture.dictation.stats.delete": "Excluir todas as estatísticas de ditado",
  "capture.pill.waiting": "Aguardando o microfone…",
  "capture.pill.listening": "Ouvindo: seu microfone está ligado",
  "capture.pill.recognising": "Reconhecendo…",
  "capture.pill.ready": "Pronto",
  "capture.pill.stop": "Parar",
  "capture.pill.recordCall": "Gravar uma chamada",
  "capture.pill.recordCall.title": "Gravar uma chamada: abre o gravador de chamadas no Phoenix",
  "capture.pill.openPhoenix": "Abrir o Phoenix",
  "capture.pill.pasteFailed": "Não foi possível colar o texto.",
  "capture.pill.outcome.typed": "Digitado",
  "capture.pill.outcome.pasted": "Colado",

  // Attachments, chat, answers, retrieval
  "capture.attachments.kind.text": "Texto",
  "capture.attachments.kind.image": "Imagem",
  "capture.attachments.kind.folder": "Pasta",
  "capture.attachments.origin.drop": "arrastado",
  "capture.attachments.origin.window": "janela",
  "capture.attachments.origin.paste": "colado",
  "capture.attachments.localOnly": "Somente local",
  "capture.attachments.dropZone.label": "Solte arquivos em {label}",
  "capture.attachments.dropZone.over": "Solte para anexar.",
  "capture.attachments.dropZone.hint":
    "Solte aqui arquivos de texto, imagens PNG/JPEG ou uma pasta, ou {attach} Anexar não envia nada.",
  "capture.attachments.dropZone.attachFiles": "anexe arquivos…",
  "capture.attachments.dropZone.choose": "Escolher arquivos para anexar",
  "capture.attachments.dropZone.reading": "Lendo o que você soltou…",
  "capture.attachments.preview.imageAlt": "Pré-visualização de {name}",
  "capture.attachments.preview.listingBroken": "A listagem armazenada não pode ser exibida.",
  "capture.attachments.preview.filesIn": "Arquivos em {name}",
  "capture.attachments.preview.contentsOf": "Conteúdo de {name}",
  "capture.attachments.chip.include": "Incluir {name} na pergunta",
  "capture.attachments.chip.meta": "{kind} · {size} · {origin}",
  "capture.attachments.chip.metaFiles":
    "{kind}, {files, plural, one {# arquivo} many {# de arquivos} other {# arquivos}} · {size} · {origin}",
  "capture.attachments.chip.previewLabel": "Pré-visualizar {name}",
  "capture.attachments.chip.removeLabel": "Remover {name}",
  "capture.attachments.chip.preview": "Pré-visualizar",
  "capture.attachments.chip.hide": "Ocultar",
  "capture.attachments.tray.label": "Anexos",
  "capture.attachments.tray.heading": "Anexos ({n})",
  "capture.attachments.tray.localOnlyTitle":
    "Os arquivos anexados só são lidos por um modelo neste dispositivo",
  "capture.attachments.tray.clearAll": "Limpar tudo",
  "capture.attachments.tray.noteTicked":
    "Mantidos apenas na memória do Phoenix Core (nunca salvos em disco) por até {minutes, plural, one {# minuto} many {# de minutos} other {# minutos}}. Ao clicar em “Perguntar sobre os anexos”, {n, plural, one {o item marcado é enviado} many {os # de itens marcados são enviados} other {os # itens marcados são enviados}}, por inteiro, a um modelo neste dispositivo. Nada sai deste dispositivo.",
  "capture.attachments.tray.noteNone":
    "Mantidos apenas na memória do Phoenix Core (nunca salvos em disco) por até {minutes, plural, one {# minuto} many {# de minutos} other {# minutos}}. Nada é enviado até você perguntar.",
  "capture.attachments.tray.tooMany":
    "Uma pergunta pode usar no máximo {max, plural, one {# item} many {# de itens} other {# itens}}. Desmarque {n} para perguntar.",
  "capture.attachments.draft.open": "Rascunho de e-mail",
  "capture.attachments.draft.to": "Para (opcional)",
  "capture.attachments.draft.message": "Mensagem (este texto exato vai no rascunho)",
  "capture.attachments.draft.count":
    "{n} / {max} caracteres. Abre seu app de e-mail com um rascunho. O Phoenix não o envia.",
  "capture.attachments.draft.submit": "Abrir rascunho de e-mail",
  "capture.attachments.draft.openFailed": "Não foi possível abrir seu app de e-mail.",
  "capture.attachments.answer.local": "grátis, neste dispositivo",
  "capture.attachments.answer.cloud": "nuvem",
  "capture.attachments.answer.processed": "Processado por {by} · {where}",
  "capture.attachments.answer.processedVision":
    "Processado por {by} · imagens lidas por {vision} neste dispositivo · {where}",
  "capture.attachments.answer.from": "De: {names}. Texto gerado, não um fato armazenado.",
  "capture.attachments.fawkesDrop.heading": "Dê um arquivo ao Fawkes",
  "capture.attachments.fawkesDrop.hint":
    "Solte um arquivo, imagem ou pasta no Fawkes e pergunte sobre isso na aba Chat.",
  "capture.attachments.fawkesDrop.count": "{n} anexado(s).",
  "capture.attachments.file.badName":
    "{name}: o nome está vazio, é longo demais ou contém caracteres ocultos",
  "capture.attachments.file.imageTooBig": "{name}: uma imagem pode ter no máximo 5 MiB",
  "capture.attachments.file.unreadable": "{name}: não foi possível ler o arquivo",
  "capture.attachments.file.unsupported":
    "{name}: tipo não suportado (arquivos de texto, imagens PNG/JPEG ou uma pasta)",
  "capture.attachments.file.tooLargeBytes":
    "{name}: grande demais (um arquivo de texto pode ter no máximo {max} caracteres)",
  "capture.attachments.file.empty": "{name}: o arquivo está vazio",
  "capture.attachments.file.tooLarge":
    "{name}: grande demais ({chars} caracteres; o limite é {max})",
  "capture.attachments.skip.unreadableFolder":
    "{label}: pastas que não puderam ser lidas, ignoradas: {n}",
  "capture.attachments.skip.unusualName": "{label}: entradas com nome incomum, ignoradas: {n}",
  "capture.attachments.skip.hidden":
    "{label}: arquivos e pastas ocultos, ignorados: {n} (nomes com ponto, node_modules, .git)",
  "capture.attachments.skip.longPath":
    "{label}: entradas com caminho acima de {pathChars} caracteres, ignoradas: {n}",
  "capture.attachments.skip.tooDeep":
    "{label}: pastas aninhadas além de {depth} níveis, ignoradas: {n}",
  "capture.attachments.skip.special":
    "{label}: entradas que não são arquivo nem pasta, ignoradas: {n}",
  "capture.attachments.skip.unreadableFile":
    "{label}: arquivos que não puderam ser lidos, ignorados: {n}",
  "capture.attachments.skip.longText":
    "{label}: arquivos de texto longos demais para incluir, ignorados: {n} (listados sem conteúdo)",
  "capture.attachments.folder.capped": "{label}: apenas os primeiros {max} arquivos foram listados",
  "capture.attachments.folder.noFiles": "{label}: nenhum arquivo legível foi encontrado",
  "capture.attachments.folder.badName": "{label}: o nome da pasta não é utilizável",
  "capture.attachments.notice.uploadFailed": "{name}: {reason}",
  "capture.attachments.notice.attached":
    "{n, plural, one {# item anexado} many {# de itens anexados} other {# itens anexados}}. Nada foi enviado a lugar nenhum ainda.",
  "capture.attachments.notice.nothingAttached": "Nada foi anexado.",
  "capture.attachments.notice.withProblems": "{head} {problems}",
  "capture.attachments.nativeDrop.folder":
    "{name}: uma pasta não pode ser solta aqui. Use a caixa de chat ou o Pet Panel.",
  "capture.attachments.nativeDrop.skipped":
    "Somente os primeiros {max} arquivos soltos são usados; mais {n} foram ignorados.",
  "capture.attachments.mail.subject": "Sobre: {name}",
  "capture.attachments.mail.empty": "Escreva primeiro o que você quer compartilhar.",
  "capture.attachments.mail.tooLong":
    "A mensagem excede o limite de {limit} em {over} caracteres. Encurte-a.",
  "capture.attachments.mail.badAddress":
    "Informe um único endereço de e-mail ou deixe o destinatário vazio.",
  "capture.attachments.mail.urlTooLong":
    "Links de e-mail tão longos não são confiáveis ({length} de {limit} caracteres depois de codificado). Encurte a mensagem.",
  "capture.chat.ciForm.badRepository":
    "Informe o repositório como “owner/name”, por exemplo “acme/app”.",
  "capture.chat.ciForm.badRunId":
    "O id da execução deve ser um número inteiro positivo, ou ficar vazio para a última execução com falha.",
  "capture.chat.ciForm.label": "Diagnosticar uma falha de CI",
  "capture.chat.ciForm.intro":
    "O Fawkes vai ler a execução com falha do GitHub Actions e seu histórico local do git. Ele não altera nada.",
  "capture.chat.ciForm.repository": "Repositório (owner/name)",
  "capture.chat.ciForm.runId":
    "Id da execução (opcional; vazio significa a última execução com falha)",
  "capture.chat.ciForm.start": "Iniciar diagnóstico",
  "capture.chat.who.you": "Você",
  "capture.chat.status": "Fawkes: {state}.",
  "capture.chat.intro":
    "Pergunte o que o Fawkes lembra. As respostas listam primeiro os fatos armazenados com suas fontes; tudo o que é gerado é identificado. Esta conversa fica apenas nesta página e desaparece quando você recarrega.",
  "capture.chat.empty": "Nenhuma mensagem ainda.",
  "capture.chat.conversation": "Conversa",
  "capture.chat.waiting": "Aguardando a resposta do Phoenix Core…",
  "capture.chat.dropLabel": "a caixa de chat",
  "capture.chat.message": "Mensagem para o Fawkes",
  "capture.chat.count": "{n} / {max} caracteres · Enter envia, Shift+Enter insere uma nova linha",
  "capture.chat.send": "Enviar",
  "capture.chat.sending": "Enviando…",
  "capture.chat.askAttachments": "Perguntar sobre os anexos",
  "capture.chat.askAttachmentsNone": "Anexe algo primeiro ou marque um anexo",
  "capture.chat.askAttachmentsTitle":
    "Envia sua pergunta e os anexos marcados a um modelo neste dispositivo",
  "capture.chat.diagnose": "Diagnosticar uma falha de CI",
  "capture.chat.automationOff":
    "A automação está desativada, então o Fawkes não pode iniciar tarefas. Ative-a em Configurações, em Automação.",
  "capture.chat.attachmentQuestion": "{text}\n(sobre: {names})",
  "capture.chat.error.askMemory": "Falha ao consultar a memória: {reason}.",
  "capture.chat.error.askAttachments": "Falha ao perguntar sobre os anexos: {reason}.",
  "capture.chat.error.automationOff":
    "A automação está desativada, então nenhuma tarefa foi iniciada. Ative-a em Configurações, em Automação.",
  "capture.chat.error.startTask": "Não foi possível iniciar a tarefa: {reason}.",
  "capture.chat.ciUser.latest":
    "Diagnosticar uma falha de CI em {repository} (a última execução com falha)",
  "capture.chat.ciUser.run": "Diagnosticar uma falha de CI em {repository} (execução {run})",
  "capture.answer.sensitivity.public": "Pública",
  "capture.answer.sensitivity.internal": "Interna",
  "capture.answer.sensitivity.sensitive": "Sensível",
  "capture.answer.classification.storedFact": "Fato armazenado",
  "capture.answer.classification.retrievedEvidence": "Evidência recuperada, não um fato afirmado",
  "capture.answer.classification.storedInterpretation": "Interpretação armazenada, não um fato",
  "capture.answer.freshness.stale": "Observação desatualizada",
  "capture.answer.freshness.fresh": "Observação recente",
  "capture.answer.confidenceUnknown": "desconhecida",
  "capture.answer.record":
    "{classification} · id da fonte {id} · {domain} · de {source}{ref} · observado em {observed} · {sensitivity} · {freshness} · confiança {confidence}",
  "capture.answer.attribution.whereLocal": "neste dispositivo",
  "capture.answer.attribution.whereCloud": "na nuvem (sai deste dispositivo)",
  "capture.answer.attribution.costUnknown": "custo desconhecido",
  "capture.answer.attribution.costFree": "grátis, neste dispositivo",
  "capture.answer.attribution.costAbout": "cerca de US${amount} (com base nos seus preços)",
  "capture.answer.attribution.defaultModel": "seu modelo padrão",
  "capture.answer.attribution.line": "Respondido por {model} via {provider} · {where} · {cost}",
  "capture.answer.facts.heading": "Fatos armazenados",
  "capture.answer.facts.empty": "Nenhum fato armazenado correspondeu à sua pergunta.",
  "capture.answer.evidence.heading": "Evidências recuperadas (não são fatos armazenados)",
  "capture.answer.evidence.empty": "Nenhuma evidência recuperada correspondeu.",
  "capture.answer.interpretations.heading": "Interpretações armazenadas anteriores (não são fatos)",
  "capture.answer.interpretations.empty": "Nenhuma interpretação anterior correspondeu.",
  "capture.answer.hypothesis.heading": "Hipótese gerada",
  "capture.answer.hypothesis.label":
    "Hipótese gerada por {by}, não um fato armazenado nem uma conclusão estabelecida.",
  "capture.answer.hypothesis.anAiModel": "um modelo de IA",
  "capture.answer.hypothesis.noInterpretation":
    "A IA foi usada, mas não deu nenhuma interpretação.",
  "capture.answer.hypothesis.noAi": "Nenhuma IA foi usada.",
  "capture.retrieval.hybrid":
    "Encontrado por palavras-chave e por significado (busca inteligente).",
  "capture.retrieval.keywordsOnly": "Encontrado apenas por palavras-chave.",
  "capture.retrieval.notUsed": "A busca inteligente não foi usada: {reason}.",
  "capture.retrieval.skipped.aiDisabled": "a IA está desativada",
  "capture.retrieval.truncated":
    "As memórias mais antigas foram deixadas de fora para manter a rapidez.",
};
