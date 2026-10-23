// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { sounds as ensounds } from "../../en/sounds";

/** Machine-translated; unreviewed (see ../../README.md). */
export const sounds: Record<keyof typeof ensounds, string> = {
  "sounds.title": "Fawkes 声音",
  "sounds.intro":
    "事情发生时 Fawkes 发出的简短提示音。默认关闭。它们由 Phoenix 自己生成，在安静模式、安静时段、静音、紧急停止或演示期间绝不会播放。",
  "sounds.enabled": "允许 Fawkes 发出声音",
  "sounds.volume": "音量",
  "sounds.volumeValue": "百分之 {percent}",
  "sounds.event.launch": "你好",
  "sounds.event.poke": "戳一下",
  "sounds.event.dizzy": "头晕",
  "sounds.event.recover": "恢复",
  "sounds.event.completion": "任务完成",
  "sounds.event.needsYou": "需要你",
  "sounds.event.failure": "出错了",
  "sounds.preview.legend": "试听声音",
  "sounds.preview.play": "播放：{name}",
  "sounds.preview.hint":
    "即使声音已关闭，试听也会按上面的音量播放，并且只在你使用过页面之后才会播放。",
  "sounds.preview.muted": "Fawkes 已静音，所以没有播放。",
  "sounds.preview.silentVolume": "音量为 0，所以没有播放。",
  "sounds.preview.quiet": "安静模式、安静时段、紧急停止或演示已开启，所以没有播放。",
  "sounds.preview.noGesture": "请先在页面上点击或按一个键，然后再试。",
  "sounds.preview.failed": "无法在此设备上播放声音。",
  "sounds.saveFailed": "无法保存声音设置。",
  "sounds.loadFailed": "无法加载声音设置。",
  "sounds.note": "暂不支持使用你自己的声音文件夹；只使用 Phoenix 内置的提示音。",
};
