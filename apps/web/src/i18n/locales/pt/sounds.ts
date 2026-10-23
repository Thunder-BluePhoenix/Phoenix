// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { sounds as ensounds } from "../../en/sounds";

/** Machine-translated; unreviewed (see ../../README.md). */
export const sounds: Record<keyof typeof ensounds, string> = {
  "sounds.title": "Sons do Fawkes",
  "sounds.intro":
    "Tons curtos que o Fawkes emite quando algo acontece. Desativados por padrão. São gerados pelo próprio Phoenix e nunca tocam no modo silencioso, nas horas de silêncio, com o som silenciado, durante a parada de emergência nem na demonstração.",
  "sounds.enabled": "Permitir que o Fawkes faça sons",
  "sounds.volume": "Volume",
  "sounds.volumeValue": "{percent} por cento",
  "sounds.event.launch": "Olá",
  "sounds.event.poke": "Cutucada",
  "sounds.event.dizzy": "Tonto",
  "sounds.event.recover": "Recuperado",
  "sounds.event.completion": "Tarefa concluída",
  "sounds.event.needsYou": "Precisa de você",
  "sounds.event.failure": "Algo falhou",
  "sounds.preview.legend": "Ouvir um som",
  "sounds.preview.play": "Reproduzir: {name}",
  "sounds.preview.hint":
    "Uma prévia toca no volume acima mesmo com os sons desativados, e só depois de você ter usado a página.",
  "sounds.preview.muted": "O Fawkes está silenciado, então nada foi reproduzido.",
  "sounds.preview.silentVolume": "O volume é 0, então nada foi reproduzido.",
  "sounds.preview.quiet":
    "O modo silencioso, as horas de silêncio, a parada de emergência ou a demonstração estão ativos, então nada foi reproduzido.",
  "sounds.preview.noGesture": "Clique ou pressione uma tecla na página primeiro e tente de novo.",
  "sounds.preview.failed": "Não foi possível reproduzir o som neste dispositivo.",
  "sounds.saveFailed": "Não foi possível salvar as configurações de som.",
  "sounds.loadFailed": "Não foi possível carregar as configurações de som.",
  "sounds.note":
    "Uma pasta com seus próprios sons ainda não está disponível; só os tons integrados do Phoenix são usados.",
};
