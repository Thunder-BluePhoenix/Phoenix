// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ports as enports } from "../../en/ports";

/** Machine-translated; unreviewed (see ../../README.md). */
export const ports: Record<keyof typeof enports, string> = {
  "ports.title": "Radar de portas",
  "ports.intro":
    "Mostra quais programas estão escutando em portas de rede neste computador, em que projeto rodam e há quanto tempo estão em execução. A verificação só lê; nada é alterado a menos que você pare um programa e aprove.",
  "ports.disabled":
    "O radar de portas está desativado. Ative a capacidade Radar de portas e processos para usá-lo.",
  "ports.scan": "Verificar agora",
  "ports.scanning": "Verificando…",
  "ports.notScanned": "Nada foi verificado ainda. Escolha Verificar agora.",
  "ports.empty": "Nenhum programa está escutando em uma porta.",
  "ports.loadError": "Não foi possível ler as portas.",
  "ports.scannedAt": "Verificado às {time}",
  "ports.count": "{count, plural, one {# porta em escuta} other {# portas em escuta}}",
  "ports.table.caption": "Portas em escuta",
  "ports.col.port": "Porta",
  "ports.col.process": "Programa",
  "ports.col.project": "Projeto",
  "ports.col.age": "Em execução há",
  "ports.col.notes": "Observações",
  "ports.col.actions": "Ações",
  "ports.pid": "processo {pid}",
  "ports.age.unknown": "desconhecido",
  "ports.age.minutes": "{count, plural, one {# minuto} other {# minutos}}",
  "ports.age.hours": "{count, plural, one {# hora} other {# horas}}",
  "ports.age.days": "{count, plural, one {# dia} other {# dias}}",
  "ports.project.none": "sem projeto",
  "ports.exposure.all": "acessível pela rede",
  "ports.exposure.loopback": "somente este computador",
  "ports.exposure.interface": "um endereço de rede",
  "ports.flag.forgotten": "Talvez esquecido",
  "ports.flag.heavy": "Pesado",
  "ports.flag.core": "O próprio Phoenix",
  "ports.usage": "CPU {percent}%, memória {mb} MB",
  "ports.help.forgotten":
    "Talvez esquecido: roda em uma pasta de projeto e está em execução há mais de {hours, plural, one {# hora} other {# horas}}. O Phoenix não consegue saber se alguém ainda o usa.",
  "ports.help.heavy":
    "Pesado: CPU de {cpu}% ou mais, ou memória de {mb} MB ou mais, segundo o ps (uma média, não uma leitura ao vivo).",
  "ports.open": "Abrir no navegador",
  "ports.open.label": "Abrir {name} na porta {port} no seu navegador padrão",
  "ports.openNote":
    "Os links abrem http://127.0.0.1 no seu navegador padrão. O Phoenix ainda não tem um navegador próprio.",
  "ports.stop": "Parar…",
  "ports.stop.label": "Parar {name} na porta {port}",
  "ports.refusal.self": "Este é o próprio Phoenix, que nunca para a si mesmo.",
  "ports.refusal.other_user": "Pertence a outro usuário.",
  "ports.refusal.system": "É um processo do sistema.",
  "ports.refusal.not_dev_tool":
    "Não é uma ferramenta de desenvolvimento que o Phoenix possa parar.",
  "ports.refusal.unsupported": "Parar não está disponível neste sistema.",
  "ports.refusal.unknown":
    "O Phoenix não conseguiu verificar este processo, então não vai pará-lo.",
  "ports.confirm.title": "Parar {name} na porta {port}?",
  "ports.confirm.body":
    "Depois que você aprovar, o Phoenix pedirá a {name} (processo {pid}) que feche. O programa pode perder trabalho não salvo.",
  "ports.confirm.go": "Pedir para parar",
  "ports.confirm.cancel": "Cancelar",
  "ports.stop.waiting": "Aguardando sua aprovação em Aprovações…",
  "ports.stop.exited": "{name} parou.",
  "ports.stop.stillRunning":
    "Pediu-se a {name} que fechasse e ele continua em execução. Forçar a parada o encerra de imediato, não pode ser desfeita e pode perder dados.",
  "ports.force": "Forçar parada…",
  "ports.force.label": "Forçar a parada de {name} na porta {port}",
  "ports.force.hint":
    "O Phoenix recusa forçar a parada nos primeiros segundos após o pedido para fechar.",
  "ports.force.confirm": "Forçar parada",
  "ports.restart.note":
    "Reiniciar não está disponível: o Phoenix não consegue reconstruir com segurança o comando original de um programa.",
  "ports.watch.label": "Atualizar automaticamente enquanto o Phoenix estiver aberto",
  "ports.watch.help":
    "Desativado por padrão. Quando ativado, o Phoenix lê a lista de portas a cada 15 segundos, apenas enquanto uma janela do Phoenix estiver aberta.",
  "ports.noProcessTable":
    "Não foi possível ler a lista de processos, então os tempos de execução e a parada ficam indisponíveis.",
  "ports.parseWarnings":
    "Algumas linhas da lista de processos ou portas do sistema não foram entendidas e foram ignoradas (o nome de um programa pode conter quebras de linha). Programas podem estar ausentes ou não poder ser parados aqui; ao parar, tudo é verificado de novo.",
  "ports.windows.note":
    "No Windows o radar mostra apenas portas e nomes de programas; tempos, projetos e parada não estão disponíveis.",
};
