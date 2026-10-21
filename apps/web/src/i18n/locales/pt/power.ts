// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { power as enpower } from "../../en/power";

/** Machine-translated; unreviewed (see ../../README.md). */
export const power: Record<keyof typeof enpower, string> = {
  "power.awake.duration.minutes": "{minutes, plural, one {# minuto} other {# minutos}}",
  "power.awake.duration.hours": "{hours, plural, one {# hora} other {# horas}}",
  "power.awake.heading": "Manter ativo",
  "power.awake.disabled": "Manter ativo está desligado. Ative a capacidade para usá-lo.",
  "power.awake.waiting": "Aguardando sua aprovação…",
  "power.awake.idle":
    "O computador suspende normalmente. Inicie uma sessão com tempo para mantê-lo ativo.",
  "power.awake.start.heading": "Manter ativo por",
  "power.awake.custom.label": "Minutos",
  "power.awake.reason.label": "Motivo (opcional)",
  "power.awake.custom.start": "Iniciar",
  "power.awake.custom.invalid": "Digite um número inteiro de minutos entre {min} e {max}.",
  "power.awake.agents.start": "Enquanto os agentes trabalham",
  "power.awake.agents.help":
    "Fica ativo enquanto algum agente de código trabalha e termina alguns minutos depois que o último acabar (usa os minutos acima).",
  "power.awake.agents.working":
    "{count, plural, one {# agente trabalhando} other {# agentes trabalhando}}",
  "power.awake.agents.grace":
    "Termina {minutes, plural, one {# minuto} other {# minutos}} depois que o último agente acabar.",
  "power.awake.running": "Mantendo o computador ativo",
  "power.awake.remaining": "Tempo restante: {time}",
  "power.awake.endsAt": "Termina às {time}",
  "power.awake.extend.label": "Adicionar tempo",
  "power.awake.extend.button": "+{duration}",
  "power.awake.end.hold": "Segure para encerrar",
  "power.awake.end.holding": "Continue segurando…",
  "power.awake.end.hint":
    "Segure o botão por 1,5 segundo (ou segure Espaço ou Enter) para encerrar a sessão.",
  "power.awake.battery":
    "A sessão também termina se a bateria cair abaixo de {percent}% fora da tomada.",
  "power.awake.lid":
    "Fechar a tampa ainda suspende o computador; ficar ativo com a tampa fechada exige o modo de tampa fechada separado.",
  "power.awake.indicator": "Ativo {time}",
  "power.recovery.heading": "Modo de tampa fechada e recuperação",
  "power.recovery.waiting": "Aguardando sua aprovação…",
  "power.recovery.unreadable": "Não foi possível ler o estado de recuperação.",
  "power.recovery.journal.clean": "Nada está aguardando para ser desfeito.",
  "power.recovery.journal.pending":
    "O Phoenix não conseguiu restaurar {count, plural, one {# alteração do sistema} other {# alterações do sistema}}. As configurações de suspensão ainda podem estar alteradas.",
  "power.recovery.journal.kind.disablesleep": "Sem suspensão com a tampa fechada",
  "power.recovery.journal.kind.lowpowermode": "Modo de baixo consumo",
  "power.recovery.journal.kind.other": "Outra alteração",
  "power.recovery.journal.at": "desde {time}",
  "power.recovery.journal.undo": "Desfazer agora",
  "power.recovery.journal.untrusted":
    "{count, plural, one {# linha ilegível do registro foi ignorada} other {# linhas ilegíveis do registro foram ignoradas}}, sem confiança.",
  "power.recovery.journal.cannotQuit": "Sair do Phoenix é recusado até que isto seja desfeito.",
  "power.recovery.lid.open": "A tampa está aberta.",
  "power.recovery.lid.closed": "A tampa está fechada.",
  "power.recovery.lid.unknown": "O estado da tampa é desconhecido.",
  "power.recovery.lid.unsupported":
    "Este computador não tem sensor de tampa, então o modo de tampa fechada não está disponível.",
  "power.recovery.helper.installed": "Auxiliar privilegiado instalado",
  "power.recovery.helper.missing":
    "Auxiliar privilegiado não instalado (modo de tampa fechada indisponível). Veja docs/awake-helper.md.",
  "power.recovery.helper.unknown": "Não se sabe se o auxiliar privilegiado está instalado.",
  "power.recovery.floors.off": "Os limites estão desligados",
  "power.recovery.floors.rule":
    "Modo de baixo consumo abaixo de {low} %, encerrar a sessão abaixo de {end} %; calor: modo de baixo consumo em {heatLow}, encerrar em {heatEnd}.",
  "power.recovery.floors.lowPowerActive": "O modo de baixo consumo está ligado",
  "power.recovery.floors.battery.none": "Bateria: nenhuma",
  "power.recovery.floors.battery.unknown": "Bateria: desconhecida",
  "power.recovery.floors.battery.level": "Bateria {percent} %",
  "power.recovery.floors.battery.unplugged": "Bateria {percent} %, fora da tomada",
  "power.recovery.floors.battery.plugged": "Bateria {percent} %, na tomada",
  "power.recovery.floors.thermal.nominal": "normal",
  "power.recovery.floors.thermal.fair": "morno",
  "power.recovery.floors.thermal.serious": "quente",
  "power.recovery.floors.thermal.critical": "crítico",
  "power.recovery.floors.thermal.level": "Calor: {level}",
  "power.recovery.floors.thermal.unsupported": "Calor: não informado",
  "power.recovery.floors.thermal.unknown": "Calor: desconhecido",
  "power.recovery.safety.warning":
    "Nunca carregue o computador em uma bolsa, capa ou outro espaço fechado enquanto o modo de tampa fechada estiver ligado: ele pode superaquecer. Mantenha as aberturas de ventilação livres.",
  "power.recovery.safety.understand": "Eu entendo",
  "power.recovery.safety.acknowledge": "Confirmar",
  "power.recovery.safety.done": "Você confirmou o aviso de segurança da tampa fechada.",
  "power.recovery.start": "Iniciar modo de tampa fechada",
  "power.recovery.end": "Encerrar modo de tampa fechada",
  "power.recovery.engaged": "O modo de tampa fechada está ligado.",
  "power.recovery.engagedSince": "O modo de tampa fechada está ligado desde {time}.",
  "power.recovery.needsSession":
    "Inicie primeiro uma sessão de manter ativo; o modo de tampa fechada precisa de uma.",
  "power.recovery.journal.discard": "Descartar esta entrada",
  "power.recovery.lockBlocked":
    "Outro processo de recuperação detém o bloqueio, então nada foi desfeito ainda. A alteração continua pendente.",
  "power.recovery.sleepUnjournaled":
    "A suspensão está desativada neste computador, mas o Phoenix não tem registro de tê-la desativado. Outra coisa a alterou.",
  "power.recovery.journalPath": "Diário: {path}",
  "power.continuity.heading": "Continuidade do agente",
  "power.continuity.intro":
    "Extras para execuções longas de agentes. Cada um fica desativado até você ativá-lo, e nenhum deles escolhe por você uma rede, um terminal ou um programa.",
  "power.continuity.needsAwake":
    "Estas configurações só têm efeito enquanto o recurso Manter ativo estiver ativado.",
  "power.continuity.saved":
    "Salvo. As alterações são aplicadas na próxima vez que o Manter ativo for iniciado.",
  "power.continuity.applyNote":
    "As alterações são salvas no recurso Manter ativo e são aplicadas na próxima vez que ele for ativado.",
  "power.continuity.network.title": "Monitoramento de rede",
  "power.continuity.network.help":
    "Verifica a cada poucos segundos se um computador que você indicar está acessível e avisa o Phoenix quando a rede cai e quando volta. Ele apenas se conecta; não envia nem lê nada.",
  "power.continuity.hosts.label": "Hosts a verificar (nome ou nome:porta)",
  "power.continuity.hotspot.title": "Failover para hotspot",
  "power.continuity.hotspot.help":
    "Quando o Wi-Fi cair durante uma sessão de manter ativo, conecta ao hotspot do iPhone que você indicar. Requer o monitoramento de rede acima e uma lista de hosts. Funciona somente no macOS e não foi testado em um Mac real.",
  "power.continuity.hotspot.ssid": "Nome do hotspot (SSID)",
  "power.continuity.hotspot.disclosure":
    "Antes de ativar isto: o macOS pode se conectar a uma rede que já conhece sem nenhuma senha em uma linha de comando, portanto conecte-se ao seu hotspot uma vez manualmente antes. Somente se você também permitir a senha salva abaixo o Phoenix a passará à ferramenta networksetup do macOS, e então qualquer programa neste Mac poderá lê-la nessa linha de comando durante os poucos segundos que a conexão leva. Não existe uma forma integrada mais segura de fazer isso sem perguntar a você. Recuse se isso não for aceitável.",
  "power.continuity.hotspot.allowPassword":
    "Eu aceito isto: usar a senha salva do hotspot na linha de comando",
  "power.continuity.hotspot.passwordSaved": "Uma senha de hotspot está salva no keychain.",
  "power.continuity.hotspot.passwordMissing":
    "Nenhuma senha de hotspot está salva. Salve uma como o segredo “hotspot_password” do recurso Manter ativo, ou deixe esta caixa desmarcada e conecte-se ao hotspot uma vez manualmente.",
  "power.continuity.hotspot.join": "Conectar ao hotspot agora",
  "power.continuity.hotspot.rejoin": "Reconectar à minha rede anterior",
  "power.continuity.hotspot.confirmNote":
    "Conectar-se a uma rede muda o Wi-Fi que este Mac usa. O Phoenix pede sua confirmação a cada vez.",
  "power.continuity.hotspot.joined": "Conectado.",
  "power.continuity.nudge.title": "Cutucar agentes",
  "power.continuity.nudge.help":
    "Se não houver rede pelo tempo abaixo, digita “continue” nos terminais que você listar. Nada é digitado durante uma reunião ou ditado, e cada terminal o recebe no máximo uma vez por queda.",
  "power.continuity.nudge.after": "Segundos sem rede antes de cutucar (30 a 3600)",
  "power.continuity.nudge.panes": "Painéis do tmux (por exemplo %12)",
  "power.continuity.nudge.sessions": "Sessões de agente do Phoenix (ph- e 16 dígitos hexadecimais)",
  "power.continuity.nudge.sessionsNote":
    "Ainda não disponível: o Phoenix não tem uma forma segura de digitar em uma sessão rastreada, então as sessões listadas são ignoradas e informadas. Somente painéis do tmux são cutucados.",
  "power.continuity.nudge.commands":
    "Programas que um painel pode estar executando (por exemplo claude)",
  "power.continuity.nudge.commandsNote":
    "O Phoenix verifica se o painel ainda existe e executa um destes programas antes de digitar. Com a lista vazia, nada é digitado.",
  "power.continuity.nudge.enter": "Pressionar Enter também",
  "power.continuity.nudge.enterHelp":
    "Desativado por padrão. Sem isso, “continue” é digitado mas não enviado, então você mesmo pressiona Enter.",
  "power.continuity.throttle.title": "Verificação de limitação do navegador",
  "power.continuity.throttle.help":
    "Chrome, Arc, Comet, Edge e Brave reduzem o desempenho das abas em segundo plano, o que pode travar a página web de um agente. Isto lista os que estão em execução assim. Nunca altera um navegador, a menos que você escolha Reiniciar e confirme.",
  "power.continuity.throttle.unsupported":
    "A verificação de navegadores funciona somente no macOS.",
  "power.continuity.throttle.notRunning": "não está em execução",
  "power.continuity.throttle.throttled": "em execução com limitação em segundo plano",
  "power.continuity.throttle.fine": "em execução sem limitação",
  "power.continuity.throttle.relaunch": "Reiniciar {name} sem limitação",
  "power.continuity.throttle.confirm":
    "Reiniciar {name} sem limitação em segundo plano? {name} será encerrado e reaberto, suas abas serão recarregadas e qualquer coisa não salva em uma página pode ser perdida. Isso é recusado durante uma reunião ou ditado.",
  "power.continuity.throttle.confirmYes": "Encerrar e reiniciar",
  "power.continuity.throttle.relaunched": "{name} foi reiniciado.",
  "power.continuity.outage.title": "Última queda de rede",
  "power.continuity.outage.none": "Nenhuma queda de rede observada até agora.",
  "power.continuity.outage.down": "A rede está fora do ar desde {time}.",
  "power.continuity.outage.ended": "A rede ficou fora do ar de {from} até {to}.",
  "power.continuity.outage.nudged":
    "{count, plural, one {# terminal cutucado} other {# terminais cutucados}}",
  "power.continuity.outage.hotspot.joined": "Conectado ao hotspot",
  "power.continuity.outage.hotspot.failed": "Falha ao conectar ao hotspot",
  "power.continuity.outage.hotspot.skipped":
    "Hotspot não tentado (desativado, ou nenhuma sessão em execução)",
  "power.continuity.outage.hotspot.notTried": "Hotspot ainda não tentado",
  "power.continuity.list.empty": "Nada na lista.",
  "power.continuity.list.remove": "Remover {item}",
  "power.continuity.invalid.host":
    "Use um nome de host ou endereço, opcionalmente com :porta (1 a 65535).",
  "power.continuity.invalid.pane":
    "Use um ID de painel do tmux como %12: um sinal de porcentagem e até seis dígitos.",
  "power.continuity.invalid.session": "Use um ID de sessão como ph-0123456789abcdef.",
  "power.continuity.invalid.command":
    "Use um nome de programa como claude: somente letras, dígitos e . _ + -",
  "power.continuity.invalid.ssid": "Use de 1 a 32 bytes de texto visível que não comece com hífen.",
  "power.continuity.invalid.seconds": "Digite um número inteiro de segundos de {min} a {max}.",
  "power.continuity.problem.duplicate": "Essa entrada já está na lista.",
  "power.continuity.problem.full": "A lista está cheia (no máximo {max} entradas).",
  "power.continuity.reason.unsupported_platform": "Isto funciona somente no macOS.",
  "power.continuity.reason.no_wifi_device":
    "O Phoenix não encontrou o dispositivo Wi-Fi deste Mac.",
  "power.continuity.reason.no_hotspot_configured":
    "Não há hotspot utilizável nem rede anterior à qual se conectar.",
  "power.continuity.reason.bad_password":
    "A senha salva não pode ser usada. Verifique-a no keychain.",
  "power.continuity.reason.join_failed": "O macOS não conseguiu se conectar à rede.",
  "power.continuity.reason.unknown_browser":
    "Esse navegador não é um dos gerenciados pelo Phoenix.",
  "power.continuity.reason.protected": "Agora não: uma reunião ou ditado está em andamento.",
  "power.continuity.reason.not_running": "Esse navegador não está em execução.",
  "power.continuity.reason.already_unthrottled":
    "Esse navegador já é executado sem limitação em segundo plano.",
  "power.continuity.reason.unavailable": "Isto não está disponível no momento.",
  "power.continuity.reason.quit_failed": "O navegador não aceitou o pedido para encerrar.",
  "power.continuity.reason.still_running":
    "O navegador ainda está aberto, por isso não foi reaberto. Feche-o você mesmo e tente novamente.",
  "power.continuity.reason.open_failed": "O navegador foi encerrado, mas não pôde ser reaberto.",
  "power.continuity.reason.other": "Isso não funcionou.",
  "power.lid.heading": "Ações ao fechar a tampa",
  "power.lid.intro":
    "Enquanto uma sessão de manter ativo está em andamento e você fecha a tampa, o Phoenix pode economizar energia e silenciar este computador. Tudo é desfeito quando você abre a tampa, quando a sessão termina e quando o Phoenix inicia de novo após uma falha.",
  "power.lid.needsAwake": "Estas ações só rodam enquanto o recurso Manter ativo está habilitado.",
  "power.lid.master.title": "Executar ações ao fechar a tampa",
  "power.lid.master.help": "O interruptor geral. Desligado, nada abaixo é executado.",
  "power.lid.display.title": "Desligar a tela",
  "power.lid.display.help":
    "Coloca a tela em repouso. O brilho é salvo e restaurado se a ferramenta gratuita de brilho estiver instalada.",
  "power.lid.freeze.title": "Congelar apps de chat",
  "power.lid.freeze.help":
    "Pausa os apps de chat escolhidos para que parem de gastar energia e depois os retoma. Nunca durante uma reunião, gravação ou ditado, nem para terminais, editores ou agentes de código em execução.",
  "power.lid.freeze.apps": "Apps a congelar",
  "power.lid.mute.title": "Silenciar o som",
  "power.lid.mute.help":
    "Silencia a saída de som e a restaura exatamente como estava, mesmo que você tenha trocado de saída no meio tempo.",
  "power.lid.lowPower.title": "Modo de baixo consumo",
  "power.lid.lowPower.help":
    "Ativa o modo de baixo consumo. Precisa do auxiliar privilegiado opcional; sem ele, é ignorado.",
  "power.lid.docker.title": "Congelar o Docker Desktop",
  "power.lid.docker.help":
    "Pausa o Docker Desktop enquanto nenhum contêiner estiver rodando. Nunca se um contêiner estiver rodando ou o estado do Docker for desconhecido.",
  "power.lid.nap.title": "Manter apps de agentes fora do App Nap",
  "power.lid.nap.help":
    "Impede o macOS de desacelerar os apps listados. A configuração anterior é salva e restaurada exatamente.",
  "power.lid.nap.apps": "Apps (bundle ids, por exemplo com.example.App)",
  "power.lid.protected.title": "Nunca congelados",
  "power.lid.protected.help":
    "Estes são sempre deixados em paz. Você pode acrescentar à lista, mas as proteções embutidas não podem ser removidas.",
  "power.lid.protected.builtIn": "Embutidos",
  "power.lid.protected.extra": "Adicionar um nome de programa ou app",
  "power.lid.list.empty": "Nada foi adicionado.",
  "power.lid.list.remove": "Remover {item}",
  "power.lid.list.duplicate": "Já está na lista.",
  "power.lid.list.full": "A lista está cheia ({max} entradas).",
  "power.lid.invalid.bundle":
    "Use um bundle id como com.example.App: letras, dígitos e hifens, com pelo menos um ponto.",
  "power.lid.invalid.name":
    "Use um nome simples de programa ou app: letras, dígitos, espaços e . _ + -",
  "power.lid.unsupported": "Indisponível aqui: {reason}",
  "power.lid.gapNote":
    "Algumas só funcionam em parte neste computador. Veja README-lid.md para o que é ou não suportado.",
  "power.lid.last.title": "Último evento da tampa",
  "power.lid.last.closed": "A tampa fechou às {time}.",
  "power.lid.last.opened": "A tampa abriu às {time}.",
  "power.lid.last.none": "Nada aconteceu ainda.",
  "power.lid.last.mismatched":
    "{count, plural, other {# processos não foram retomados porque não correspondiam mais ao que o Phoenix congelou.}}",
  "power.lid.last.stillClosed": "A tampa está fechada e as ações acima estão aplicadas.",
  "power.lid.outcome.applied": "Feito",
  "power.lid.outcome.skipped": "Ignorado",
  "power.lid.outcome.failed": "Falhou",
  "power.lid.outcome.undone": "Desfeito",
  "power.lid.outcome.undo_failed": "Não foi possível desfazer (o Phoenix tentará de novo)",
  "power.lid.reason.unsupported_platform": "Só é suportado em Mac.",
  "power.lid.reason.helper_unavailable": "O auxiliar privilegiado não está instalado.",
  "power.lid.reason.tool_missing": "Uma ferramenta necessária não está instalada.",
  "power.lid.reason.already_on": "Já estava ativado por outro motivo.",
  "power.lid.reason.state_unknown":
    "O Phoenix não sabe se você está em uma reunião, então não fez nada.",
  "power.lid.reason.protected_state": "Há uma reunião, gravação ou ditado em andamento.",
  "power.lid.reason.docker_busy": "Um contêiner está rodando.",
  "power.lid.reason.docker_unknown": "O estado do Docker é desconhecido.",
  "power.lid.reason.process_list_unavailable":
    "Não foi possível ler a lista de programas em execução.",
  "power.lid.reason.audio_unavailable": "Não foi possível ler as saídas de som.",
  "power.lid.reason.no_targets": "Não havia nada para alterar.",
  "power.lid.reason.nothing_to_do": "Não havia nada para alterar.",
  "power.lid.reason.journal_unwritable":
    "O diário de recuperação não pôde ser gravado, então nada foi alterado.",
  "power.lid.reason.not_applied": "Nada foi alterado.",
  "power.lid.reason.apply_failed": "A alteração não pôde ser feita.",
  "power.lid.reason.undo_failed": "A alteração não pôde ser desfeita.",
  "power.lid.reason.assertions_unknown":
    "O Phoenix não consegue saber se um app está em chamada, por isso não congelou nada.",
  "power.lid.reason.holds_assertion":
    "Todos os apps de chat estão em uso (chamada ou reprodução), por isso nenhum foi congelado.",
  "power.lid.reason.output_changed":
    "A saída de som foi trocada enquanto a tampa estava fechada, por isso o Phoenix não mexeu na nova saída. A saída que ele silenciou continua silenciada até voltar a ser a padrão.",
  "power.lid.reason.retry_or_alert":
    "Um app congelado parece ter sido reiniciado, por isso o Phoenix não o retomou. Verifique se seus apps de chat funcionam normalmente.",
  "power.lid.reason.not_ours":
    "Alguns processos não puderam ser retomados porque o Phoenix não pode controlá-los.",
  "power.lid.limit.output_identity_unknown":
    "O Phoenix não consegue ler o nome da saída de som, por isso não sabe se ela mudou.",
  "power.lid.limit.brightness_tool_untrusted":
    "O arquivo da ferramenta de brilho não é seguro (dono errado ou gravável por outros), por isso não foi usado.",
  "power.lid.reason.other": "Isso não funcionou.",
  "power.lid.limit.brightness_tool_missing":
    "A ferramenta gratuita de brilho não está instalada; só o repouso da tela é usado e o brilho não é alterado.",
  "power.lid.limit.keyboard_backlight_unsupported":
    "A luz do teclado não pode ser controlada sem software de terceiros.",
  "power.lid.limit.default_output_only": "Só a saída padrão atual pode ser silenciada.",
  "power.lid.applyNote":
    "As alterações valem na próxima vez que uma sessão vir a tampa fechar. Tudo é registrado no diário antes de ser feito.",
  "power.lid.saved": "Salvo.",
  "power.lid.glance.closed": "A tampa está fechada: as ações de fechamento estão aplicadas.",
  "power.lid.glance.failed":
    "Uma ação de fechamento de tampa não pôde ser desfeita. Abra Manter ativo para ver os detalhes.",
};
