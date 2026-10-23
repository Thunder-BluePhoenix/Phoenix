// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "Início do Phoenix",
  "shell.nav.main": "Principal",
  "shell.nav.meetings": "Reuniões",
  "shell.nav.provenance": "Proveniência",
  "shell.nav.agents": "Agentes",
  "shell.nav.workflows": "Fluxos de trabalho",
  "shell.nav.recap": "Resumo",
  "shell.nav.settings": "Configurações",
  "shell.nav.recording": "Gravando",
  "shell.app.skipToContent": "Ir para o conteúdo",
  "shell.app.tagline": "O Phoenix é a plataforma. O Fawkes é o mascote.",
  "shell.app.noToken":
    "Esta página não tem token de sessão. Abra o Phoenix pelo endereço exibido por {command}.",
  "shell.app.hint": "Clique no Fawkes na barra superior para ver o que o Phoenix está fazendo.",
  "shell.language.title": "Idioma",
  "shell.language.label": "Idioma da interface",
  "shell.language.available":
    "{count, plural, one {# idioma disponível.} many {# de idiomas disponíveis.} other {# idiomas disponíveis.}}",
  "shell.language.machineNote":
    "O texto em idiomas diferentes do inglês é traduzido automaticamente e ainda não foi revisado por falantes nativos.",
  "shell.language.saved": "Idioma alterado.",
  "shell.language.failed": "Não foi possível salvar o idioma. Tente novamente.",

  "shell.palette.title": "Paleta de comandos",
  "shell.palette.inputLabel": "Pesquisar comandos",
  "shell.palette.placeholder": "Digite um comando…",
  "shell.palette.results": "Comandos",
  "shell.palette.hint": "As setas para cima e para baixo escolhem, Enter executa, Escape fecha.",
  "shell.palette.count": "{count, plural, one {# comando} many {# de comandos} other {# comandos}}",
  "shell.palette.empty": "Nenhum comando corresponde a “{query}”.",

  "shell.cmd.palette.open": "Abrir a paleta de comandos",
  "shell.cmd.nav.home": "Ir para o início",
  "shell.cmd.nav.meetings": "Ir para Reuniões",
  "shell.cmd.nav.provenance": "Ir para Proveniência",
  "shell.cmd.nav.agents": "Ir para Agentes",
  "shell.cmd.nav.workflows": "Ir para Fluxos de trabalho",
  "shell.cmd.nav.recap": "Ir para Resumo",
  "shell.cmd.nav.settings": "Ir para Configurações",
  "shell.cmd.settings.language": "Abrir Configurações: Idioma",
  "shell.cmd.panel.overview": "Painel do Fawkes: Visão geral",
  "shell.cmd.panel.chat": "Painel do Fawkes: Chat",
  "shell.cmd.panel.activity": "Painel do Fawkes: Atividade",
  "shell.cmd.panel.capabilities": "Painel do Fawkes: Capacidades",
  "shell.cmd.panel.memory": "Painel do Fawkes: Memória",
  "shell.cmd.panel.wardrobe": "Abrir o Guarda-roupa",
  "shell.cmd.demo.start": "Iniciar a demonstração",
  "shell.cmd.demo.stop": "Parar a demonstração",
  "shell.cmd.pills.next": "Mudar para a próxima etiqueta de fonte",
  "shell.cmd.pills.previous": "Mudar para a etiqueta de fonte anterior",
  "shell.cmd.mute.toggle": "Silenciar ou reativar sons e notificações",

  "shell.shortcuts.title": "Atalhos globais",
  "shell.shortcuts.desktopOnly":
    "Os atalhos globais são um recurso do aplicativo de desktop do Phoenix. Não estão disponíveis em um navegador.",
  "shell.shortcuts.intro":
    "Os atalhos globais funcionam em qualquer aplicativo enquanto o aplicativo de desktop do Phoenix estiver em execução.",
  "shell.shortcuts.loading": "Carregando atalhos…",
  "shell.shortcuts.loadFailed": "Não foi possível ler os atalhos do aplicativo de desktop.",
  "shell.shortcuts.enable": "Ativar os atalhos globais",
  "shell.shortcuts.warning":
    "Aviso: enquanto os atalhos globais estiverem ativados, cada um tira sua combinação de teclas de todos os outros aplicativos. Eles ficam desativados até você ativá-los. Cada atalho precisa de pelo menos duas teclas modificadoras (Ctrl, Alt, Shift ou Cmd), para não atrapalhar a digitação normal.",
  "shell.shortcuts.mute": "Silenciar sons e notificações",
  "shell.shortcuts.muteHelp":
    "O Fawkes continua mostrando o que está fazendo; só os sons e os balões de notificação dele são silenciados.",
  "shell.shortcuts.list": "Ações de atalho",
  "shell.shortcuts.action.open_chat": "Abrir o chat",
  "shell.shortcuts.action.jump_to_alert": "Ir para o alerta",
  "shell.shortcuts.action.jump_to_terminal": "Ir para o terminal",
  "shell.shortcuts.action.switch_pills": "Alternar as etiquetas",
  "shell.shortcuts.action.mute": "Silenciar sons e notificações",
  "shell.shortcuts.action.send_to_desktop": "Enviar o Fawkes para a área de trabalho",
  "shell.shortcuts.action.wardrobe": "Abrir o Guarda-roupa",
  "shell.shortcuts.binding.none": "Não definido",
  "shell.shortcuts.default": "Padrão: {keys}",
  "shell.shortcuts.state.active": "Ativo",
  "shell.shortcuts.state.off": "Inativo: os atalhos globais estão desativados",
  "shell.shortcuts.state.unbound": "Inativo: nenhuma combinação de teclas definida",
  "shell.shortcuts.state.rejected": "Inativo: esta combinação de teclas não é permitida",
  "shell.shortcuts.state.unavailable":
    "Inativo: outro aplicativo pode já usar esta combinação de teclas, ou o sistema não a permite",
  "shell.shortcuts.changeFor": "Alterar o atalho de {action}",
  "shell.shortcuts.capture": "Pressione a nova combinação de teclas",
  "shell.shortcuts.captureFor": "Nova combinação de teclas para {action}",
  "shell.shortcuts.captureHelp": "Pressione as teclas juntas. Escape cancela.",
  "shell.shortcuts.resetFor": "Restaurar o atalho de {action} para o padrão",
  "shell.shortcuts.resetAll": "Redefinir todos os atalhos",
  "shell.shortcuts.saved": "O atalho de {action} agora é {keys}.",
  "shell.shortcuts.resetDone": "O atalho de {action} foi redefinido.",
  "shell.shortcuts.resetAllDone": "Todos os atalhos foram redefinidos.",
  "shell.shortcuts.reason.invalid": "Esse atalho não é válido.",
  "shell.shortcuts.reason.unsupportedKey":
    "Essa tecla não pode ser usada. Use uma letra, um dígito, uma tecla F ou uma seta junto com teclas modificadoras.",
  "shell.shortcuts.reason.needs_modifiers":
    "Um atalho precisa de pelo menos duas teclas modificadoras (Ctrl, Alt, Shift ou Cmd), para não tomar conta da digitação normal.",
  "shell.shortcuts.reason.needs_third_modifier":
    "Em muitos teclados, Ctrl+Alt e Alt+Shift com uma letra ou dígito digitam símbolos (AltGr ou Option). Adicione uma terceira tecla modificadora.",
  "shell.shortcuts.reason.reserved": "O sistema já usa essa combinação de teclas.",
  "shell.shortcuts.reason.dictation_chord":
    "Essa combinação de teclas é usada pelo ditado (colar novamente).",
  "shell.shortcuts.reason.conflict": "Outro atalho do Phoenix já usa essa combinação de teclas.",
  "shell.shortcuts.reason.unavailable":
    "O sistema não registrou essa combinação de teclas. Outro aplicativo pode já usá-la.",
  "shell.shortcuts.reason.forbidden": "Esta janela não pode alterar atalhos.",
  "shell.shortcuts.reason.unknown_action": "Isso não é uma ação de atalho.",
  "shell.shortcuts.reason.unknown": "Não foi possível alterar o atalho.",
};
