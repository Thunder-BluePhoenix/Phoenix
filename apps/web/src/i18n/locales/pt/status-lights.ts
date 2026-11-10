// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { statusLights as enStatusLights } from "../../en/status-lights";

/** Machine-translated; unreviewed. */
export const statusLights: Record<keyof typeof enStatusLights, string> = {
  "statusLights.limits":
    "Apenas cores fixas são enviadas, nunca qualquer texto. As credenciais (uma chave de aplicação Hue, um token Luxafor) são somente de escrita: depois de guardadas, nunca mais são mostradas. Os nomes e identificadores que uma luz comunica são mostrados como texto simples.",
  "statusLights.line.luxafor": "App Luxafor em {address}",
  "statusLights.line.hue": "Luz Hue na bridge {bridge}",

  "statusLights.error.unavailable":
    "Este Phoenix Core não tem um cofre de credenciais do sistema, por isso não é possível guardar uma credencial.",
  "statusLights.error.save":
    "Não foi possível guardar a lista de luzes. Verifique o nome e o endereço.",
  "statusLights.error.capability": "Não foi possível alterar a configuração Luzes de estado.",
  "statusLights.error.hueName":
    "Dê à bridge um nome com letras, dígitos e . _ : - (até 160 caracteres).",
  "statusLights.error.hueInspect":
    "A bridge não respondeu nesse endereço. Use o endereço IPv4 dela na sua própria rede.",
  "statusLights.error.huePair":
    "O emparelhamento falhou. Prima o botão redondo de ligação na bridge e tente novamente.",
  "statusLights.error.hueRemove": "Não foi possível remover a bridge.",
  "statusLights.error.hueLights": "Não foi possível listar as luzes desta bridge.",
  "statusLights.error.luxaforToken":
    "O token não foi guardado. Precisa de 1 a 128 caracteres imprimíveis sem espaços.",
  "statusLights.error.lifx":
    "A deteção de LIFX não terminou. Aguarde alguns segundos e tente novamente.",
  "statusLights.error.quietInvalid":
    "Introduza duas horas e um fuso horário válido, como Europe/Paris.",

  "statusLights.hue.title": "Philips Hue",
  "statusLights.hue.notAvailable":
    "O Hue não está disponível: este Phoenix Core não tem um cofre de credenciais do sistema.",
  "statusLights.hue.loadFailed": "Não foi possível carregar as bridges Hue.",
  "statusLights.hue.intro":
    "Uma bridge emparelhada só é considerada de confiança enquanto apresentar o certificado cuja impressão digital SHA-256 você confirmou. A chave de aplicação dela é guardada no cofre de credenciais do seu sistema e nunca é mostrada.",
  "statusLights.hue.empty": "Nenhuma bridge emparelhada.",
  "statusLights.hue.bridgeLine": "em {address}:{port}",
  "statusLights.hue.fingerprint": "Impressão digital SHA-256:",
  "statusLights.hue.find": "Mostrar luzes",
  "statusLights.hue.findNamed": "Mostrar as luzes da bridge {name}",
  "statusLights.hue.remove": "Remover bridge",
  "statusLights.hue.removeNamed": "Remover a bridge {name}",
  "statusLights.hue.removeNote":
    "Remover uma bridge apaga a chave guardada. As luzes que a usam deixam de ser contactadas.",
  "statusLights.hue.noLights": "Esta bridge não comunicou nenhuma luz.",
  "statusLights.hue.alreadyAdded": "Adicionada",
  "statusLights.hue.add": "Adicionar",
  "statusLights.hue.addNamed": "Adicionar a luz Hue {name}",
  "statusLights.hue.pairTitle": "Emparelhar uma bridge",
  "statusLights.hue.name": "Nome desta bridge",
  "statusLights.hue.address": "Endereço da bridge na sua rede (por exemplo 192.168.1.2)",
  "statusLights.hue.lookup": "Ler o certificado da bridge",
  "statusLights.hue.confirmGroup": "Confirmar o certificado da bridge",
  "statusLights.hue.found": "Uma bridge respondeu em {address}:{port}.",
  "statusLights.hue.certName": "Titular do certificado: {name}",
  "statusLights.hue.linkStep":
    "Prima agora o botão redondo de ligação na parte superior da bridge e confirme abaixo. O emparelhamento é recusado se o botão não tiver sido premido nos últimos 30 segundos, aproximadamente.",
  "statusLights.hue.confirm":
    "Comparei esta impressão digital com a da minha bridge e confio nesta bridge.",
  "statusLights.hue.pair": "Emparelhar e fixar esta impressão digital",
  "statusLights.hue.cancel": "Cancelar",

  "statusLights.luxafor.title": "Luxafor",
  "statusLights.luxafor.intro":
    "O Phoenix comunica apenas com o webhook local da app Luxafor, por HTTP simples na sua própria rede. A app responde com sucesso seja qual for o token, por isso um token guardado não prova que a luz mudou.",
  "statusLights.luxafor.name": "Nome desta luz Luxafor",
  "statusLights.luxafor.address": "Endereço do computador que executa a app Luxafor",
  "statusLights.luxafor.add": "Adicionar luz Luxafor",
  "statusLights.luxafor.token": "Token do webhook",
  "statusLights.luxafor.tokenNamed": "Token do webhook de {name}",
  "statusLights.luxafor.save": "Definir ou substituir o token",
  "statusLights.luxafor.saved": "Token guardado.",
  "statusLights.luxafor.writeOnly":
    "O token nunca mais é mostrado. Para o apagar, remova esta luz.",

  "statusLights.lifx.title": "LIFX",
  "statusLights.lifx.intro":
    "A deteção envia uma difusão na sua rede e lista as luzes que respondem. Nada é adicionado e nenhuma cor é enviada até que ative uma luz.",
  "statusLights.lifx.discover": "Procurar luzes LIFX",
  "statusLights.lifx.none": "Nenhuma luz LIFX respondeu.",
  "statusLights.lifx.line": "Luz LIFX {serial} em {address}",
  "statusLights.lifx.added": "Adicionada",
  "statusLights.lifx.enable": "Adicionar esta luz",
  "statusLights.lifx.enableNamed": "Adicionar a luz LIFX {serial}",

  "statusLights.quiet.title": "Horas de silêncio",
  "statusLights.quiet.intro":
    "As luzes permanecem apagadas entre estas horas, no fuso horário que escolher.",
  "statusLights.quiet.off": "As horas de silêncio estão desativadas.",
  "statusLights.quiet.on": "As luzes ficam apagadas das {start} às {end} ({timezone}).",
  "statusLights.quiet.start": "De",
  "statusLights.quiet.end": "Até",
  "statusLights.quiet.timezone": "Fuso horário",
  "statusLights.quiet.save": "Guardar horas de silêncio",
  "statusLights.quiet.clear": "Desativar horas de silêncio",
};
