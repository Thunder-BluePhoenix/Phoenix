// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { follow as enFollow } from "../../en/follow";

/** Machine-translated; unreviewed (see ../../README.md). */
export const follow: Record<keyof typeof enFollow, string> = {
  "follow.label":
    "Разрешить плавающему Fawkes следовать за указателем мыши (только в приложении для компьютера)",
  "follow.hint":
    "По умолчанию выключено. Двигается только плавающий Fawkes в приложении для компьютера; он летит домой, когда что-то требует вашего внимания, и стоит на месте, пока скрыт, в тихом режиме и в тихие часы, во время аварийной остановки и в демо. При уменьшенной анимации он перескакивает, а не скользит. В браузере недоступно.",
};
