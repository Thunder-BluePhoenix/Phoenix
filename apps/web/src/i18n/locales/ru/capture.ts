// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { capture as encapture } from "../../en/capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const capture: Record<keyof typeof encapture, string> = {
  "capture.audio.connectionFailed": "Сбой аудиоподключения.",
  "capture.audio.connectionClosed": "Аудиоподключение закрыто.",
  "capture.audio.invalidReply": "Недопустимый ответ от Core.",
  "capture.audio.micUnavailable": "Микрофон недоступен: {reason}",
  "capture.audio.waitingForPermission": "Ожидание разрешения на микрофон…",
  "capture.audio.coreNotConnected": "Phoenix Core не подключён.",
  "capture.audio.emergencyStop": "Включена аварийная остановка.",
  "capture.audio.recognizerAvailable": "Распознавание речи: доступно. {detail}",
  "capture.audio.recognizerUnavailable": "Распознавание речи: недоступно. {detail}",
  "capture.audio.onDisk":
    "Звук на диске: этот движок записывает звук во временный личный файл на время распознавания и сразу стирает его.",
  "capture.mic.unsupported": "Этот браузер не поддерживает микрофон",
  "capture.mic.sampleRate": "Это устройство не может предоставить звук с микрофона 16 kHz",
  "capture.notetaker.settings.title": "Заметки по звонку",
  "capture.notetaker.settings.savedOn": "Заметки по звонку включены.",
  "capture.notetaker.settings.savedOff": "Заметки по звонку выключены.",
  "capture.notetaker.settings.intro":
    "Заметки по звонку записывают звонок на этом компьютере без подключения бота и превращают его в расшифровку, сводку и задачи, которые можно проверить. Эта функция {off}, пока вы не включите её здесь. Включение {not} согласием на запись кого-либо: перед каждой записью вас спросят снова.",
  "capture.notetaker.settings.introOff": "выключена",
  "capture.notetaker.settings.introNot": "не является",
  "capture.notetaker.settings.audio.lead": "Аудио никогда не сохраняется.",
  "capture.notetaker.settings.audio.body":
    "Оно хранится только в памяти, преобразуется в текст короткими фрагментами на этом устройстве и удаляется сразу после обработки каждого фрагмента или остановки записи.",
  "capture.notetaker.settings.kept.lead": "Что сохраняется:",
  "capture.notetaker.settings.kept.body":
    "расшифровка, которая создаётся по ходу звонка, и сводка, подготовленная моделью на этом устройстве. Если модель не ответит, вы получите расшифровку без сводки.",
  "capture.notetaker.settings.speakers.lead": "Участники:",
  "capture.notetaker.settings.speakers.body":
    "только «Вы» и «Другие». Phoenix не различает других людей.",
  "capture.notetaker.settings.captured.lead": "Что записывается:",
  "capture.notetaker.settings.banner":
    "Fawkes показывает «Запись» и кнопку «Остановить» во всех представлениях на протяжении всей записи.",
  "capture.notetaker.settings.toggle": "Включить заметки по звонку",
  "capture.notetaker.settings.killSwitch": "Включена аварийная остановка: запись заблокирована.",
  "capture.notetaker.banner.title": "Запись звонка",
  "capture.notetaker.banner.stop": "Остановить запись",
  "capture.notetaker.banner.stopping": "Остановка…",
  "capture.notetaker.micOnly":
    "Записывается только ваш микрофон; другие участники не записываются.",
  "capture.notetaker.consent.title": "Перед записью",
  "capture.notetaker.consent.notice":
    "Сообщите всем участникам звонка, что он записывается. Запись без согласия может быть незаконной там, где живёте вы или они.",
  "capture.notetaker.consent.checkbox": "Все участники звонка предупреждены о записи",
  "capture.notetaker.consent.titleField": "Название {optional}",
  "capture.notetaker.consent.optional": "(необязательно)",
  "capture.notetaker.consent.start": "Начать запись",
  "capture.notetaker.blocked.unavailable": "Статус заметок по звонку недоступен.",
  "capture.notetaker.blocked.off":
    "Заметки по звонку выключены. Включите их в «Настройках», в разделе «Заметки по звонку».",
  "capture.notetaker.blocked.noConsentChannel":
    "Для записи нужен надёжный способ сначала спросить вас. {detail}",
  "capture.notetaker.blocked.inProgress": "Запись уже идёт.",
  "capture.notetaker.record.title": "Записать звонок",
  "capture.notetaker.record.intro":
    "Записывает микрофон этого компьютера без бота. Аудио никогда не сохраняется; вы получите расшифровку и, если ответит модель на этом устройстве, сводку.",
  "capture.notetaker.record.saved": "Запись сохранена.",
  "capture.notetaker.record.openMeeting": "Открыть встречу",
  "capture.notetaker.recorder.stopped":
    "Запись остановлена. Всё расшифрованное к этому моменту сохранено.",
  "capture.notetaker.recorder.stoppedWithReason":
    "Запись остановлена: {reason}. Всё расшифрованное к этому моменту сохранено.",
  "capture.voice.phase.idle": "Голосовой режим выключен",
  "capture.voice.phase.starting": "Запуск микрофона…",
  "capture.voice.phase.waiting": "Ожидание «OK Fawkes»",
  "capture.voice.phase.awake": "Fawkes слушает ваш запрос",
  "capture.voice.phase.thinking": "Обработка вашего запроса…",
  "capture.voice.banner.label": "Голосовой помощник",
  "capture.voice.banner.live": "Микрофон включён. {phase}.",
  "capture.voice.banner.stop": "Перестать слушать",
  "capture.voice.banner.fawkes": "Fawkes:",
  "capture.voice.banner.openDraft": "Открыть черновик письма",
  "capture.voice.blocked.unavailable": "Статус голосового помощника недоступен.",
  "capture.voice.blocked.off":
    "Голосовой помощник выключен. Включите его в «Настройках», в разделе «Голос».",
  "capture.voice.reason.stopped": "Голосовой режим остановлен.",
  "capture.voice.reason.disabled": "Голосовой режим выключен.",
  "capture.voice.reason.killSwitch": "Голосовой режим остановлен: включена аварийная остановка.",
  "capture.voice.reason.badFrame":
    "Голосовой режим остановлен: микрофон передал недопустимый звук.",
  "capture.voice.reason.tooFast":
    "Голосовой режим остановлен: микрофон передавал звук слишком быстро.",
  "capture.voice.reason.connectionClosed": "Голосовой режим остановлен: подключение закрыто.",
  "capture.voice.reason.streamNotOpened":
    "Голосовой режим остановлен: микрофон не запустился вовремя.",
  "capture.voice.reason.recogniserFailed":
    "Голосовой режим остановлен: не удалось распознать речь.",
  "capture.voice.reason.shutdown": "Голосовой режим остановлен: Phoenix Core останавливается.",
  "capture.voice.reason.refused": "Голосовой режим остановлен: Core отклонил аудио.",
  "capture.voice.micCouldNotStart": "Не удалось запустить микрофон: {reason}",
  "capture.voice.settings.titleShort": "Голос",
  "capture.voice.settings.title": "Голос («OK Fawkes»)",
  "capture.voice.settings.unavailable": "Настройки голоса недоступны из Phoenix Core.",
  "capture.voice.settings.savedOn": "Голосовой режим включён.",
  "capture.voice.settings.savedOff": "Голосовой режим выключен. Микрофон освобождён.",
  "capture.voice.settings.intro":
    "Скажите «OK Fawkes» и спросите о своих сервисах. Голосовой режим {off}, пока вы не включите его здесь; включение означает ваше согласие только на голосовой режим.",
  "capture.voice.settings.introOff": "выключен",
  "capture.voice.settings.whileOn.lead": "Пока он включён:",
  "capture.voice.settings.whileOn.body":
    "эта страница держит микрофон открытым и всё время показывает «Микрофон включён». На этом устройстве в каждый момент звука выполняется простая проверка громкости; только когда кто-то говорит, короткий фрагмент передаётся распознавателю речи на этом устройстве.",
  "capture.voice.settings.leaves.lead": "Что покидает это устройство:",
  "capture.voice.settings.leaves.body":
    "ничего. Распознавание выполняется локально; облачного пути для речи нет. Phoenix не создаёт аудио: ответы озвучивает ваш браузер, если может.",
  "capture.voice.settings.kept.lead": "Что сохраняется:",
  "capture.voice.settings.kept.body":
    "аудио остаётся в памяти на несколько секунд и удаляется, когда оно распознано, когда вы останавливаете режим или используете аварийную остановку. Оно никогда не записывается на диск, и расшифровка не сохраняется. Журнал аудита фиксирует факт запроса и использованный инструмент, но никогда не то, что вы сказали.",
  "capture.voice.settings.canDo.lead": "Что он может:",
  "capture.voice.settings.canDo.body":
    "читать статус включённых вами сервисов, открывать компактную панель и готовить черновик письма для вашей проверки. Он ничего не может изменить и никогда не может одобрить действие: это можете только вы, в панели питомца. Он может сказать «отклонить».",
  "capture.voice.settings.limits.lead": "Ограничения:",
  "capture.voice.settings.limits.body":
    "фраза активации находится путём расшифровки коротких фрагментов речи (это не отдельный детектор ключевых слов), поэтому она может быть пропущена, а похожие слова могут быть поняты неверно.",
  "capture.voice.settings.toggle": "Включить «OK Fawkes»",
  "capture.voice.settings.killSwitch":
    "Включена аварийная остановка: голосовой режим заблокирован.",
  "capture.voice.settings.notListening":
    "Голосовой режим включён, но эта страница ещё не слушает (после перезагрузки браузер снова спросит разрешение).",
  "capture.voice.settings.start": "Начать слушать",
  "capture.multimodal.title": "Одноразовый захват с устройства",
  "capture.multimodal.intro":
    "Запрошено: пользователем. Core проверяет разрешение возможности и запрашивает одобрение каждого использования до того, как браузер запросит доступ к устройству. Ничего не захватывается в фоне; облачного резервного варианта нет.",
  "capture.multimodal.statusUnavailable": "Статус захвата Core недоступен.",
  "capture.multimodal.killSwitch": "Захват недоступен: включена аварийная остановка.",
  "capture.multimodal.kind.microphone": "Микрофон · одна секунда аудио WAV",
  "capture.multimodal.kind.screen": "Экран · один кадр PNG",
  "capture.multimodal.modality":
    "{label}. Модель: {model}; провайдер: {provider}; расположение: {locality}. {detail}",
  "capture.multimodal.notReported": "не сообщено Core",
  "capture.multimodal.modalityUnavailable": "недоступно",
  "capture.multimodal.statusPending": "Статус пока недоступен.",
  "capture.multimodal.grant.microphone":
    "разрешение возможности микрофона недоступно; включите её в разделе «Возможности» до захвата.",
  "capture.multimodal.grant.screen":
    "разрешение возможности захвата экрана недоступно; включите её в разделе «Возможности» до захвата.",
  "capture.multimodal.capture.microphone": "Захватить микрофон",
  "capture.multimodal.capture.screen": "Захватить экран",
  "capture.multimodal.stop": "Остановить захват",
  "capture.multimodal.phase.waitingApproval":
    "Ожидание одобрения Core. Проверьте запрос ниже; устройство ещё не активно.",
  "capture.multimodal.phase.approvedMicrophone":
    "Core одобрил. Запрашивается доступ к микрофону на одну секунду.",
  "capture.multimodal.phase.approvedScreen": "Core одобрил. Запрашивается один кадр экрана.",
  "capture.multimodal.phase.processing": "Локальная обработка; устройство остановлено.",
  "capture.multimodal.error.connectionUnavailable": "Подключение для захвата недоступно.",
  "capture.multimodal.error.invalidResponse": "Недопустимый ответ Core на захват.",
  "capture.multimodal.error.browserUnavailable": "Захват в браузере недоступен.",
  "capture.multimodal.error.frameSize": "Захват превышает допустимый размер кадра.",
  "capture.multimodal.error.deviceDenied": "Браузер отклонил доступ к устройству.",
  "capture.multimodal.error.invalidResult":
    "Core вернул недопустимый результат локального захвата.",
  "capture.multimodal.error.refused": "Core отклонил захват.",
  "capture.multimodal.error.unexpected": "Неожиданный ответ Core на захват.",
  "capture.multimodal.error.connectionFailed": "Сбой подключения для захвата.",
  "capture.multimodal.error.ended": "Захват завершился без результата или одобрения.",
  "capture.multimodal.result.heading": "{what} · {provider} ({locality})",
  "capture.multimodal.result.transcript": "Расшифровка",
  "capture.multimodal.result.screen": "Описание экрана",
  "capture.multimodal.result.clear": "Очистить результат",
  "capture.dictation.mode.asSaid": "Как сказано (без очистки)",
  "capture.dictation.mode.natural": "Естественно (убрать слова-паразиты)",
  "capture.dictation.mode.polished": "Отредактировано (исправить и грамматику)",
  "capture.dictation.duration.minutesSeconds": "{minutes} мин {seconds} с",
  "capture.dictation.duration.seconds": "{seconds} с",
  "capture.dictation.blocked.statusUnavailable": "Статус диктовки недоступен.",
  "capture.dictation.blocked.off":
    "Диктовка выключена. Включите её в «Настройках», в разделе «Диктовка».",
  "capture.dictation.stopped.plain": "Диктовка остановлена.",
  "capture.dictation.stopped.reason": "Диктовка остановлена: {reason}.",
  "capture.dictation.nothingRecognised": "Ничего не распознано.",
  "capture.dictation.button.start": "Диктовать",
  "capture.dictation.button.starting": "Запуск…",
  "capture.dictation.button.recognising": "Распознавание…",
  "capture.dictation.button.stop": "Остановить диктовку",
  "capture.dictation.button.cancel": "Отменить диктовку",
  "capture.dictation.hint":
    "Использует ваш микрофон только во время диктовки; аудио не сохраняется.",
  "capture.dictation.indicator.listening": "Слушает: ваш микрофон включён.",
  "capture.dictation.settings.title": "Диктовка",
  "capture.dictation.settings.unavailable": "Настройки диктовки недоступны из Phoenix Core.",
  "capture.dictation.settings.intro":
    "Диктовка преобразует вашу речь в текст на этом устройстве. Она {off}, пока вы не включите её здесь; включение означает ваше согласие только на диктовку.",
  "capture.dictation.settings.intro.off": "выключена",
  "capture.dictation.settings.enable": "Включить диктовку",
  "capture.dictation.privacy.leaves.lead": "Что покидает это устройство:",
  "capture.dictation.privacy.leaves.body":
    "ничего. Речь распознаётся на этом устройстве; необязательная очистка использует только модель на этом устройстве и никогда не отправляется облачному провайдеру, даже если вы разрешили облачный ИИ для других задач.",
  "capture.dictation.privacy.memory.lead": "Что остаётся в памяти:",
  "capture.dictation.privacy.memory.body":
    "аудио на время одной диктовки (не более {seconds, plural, one {# секунды} few {# секунд} many {# секунд} other {# секунды}}). Оно никогда не записывается на диск и удаляется, когда диктовка заканчивается, отменяется или используется аварийная остановка.",
  "capture.dictation.privacy.stored.lead": "Что хранится:",
  "capture.dictation.privacy.stored.body":
    "ваши настройки и списки слов ниже, а также показатели по дням и приложениям (слова, время речи, число диктовок). Никогда не текст, который вы диктуете, и не аудио.",
  "capture.dictation.privacy.microphone":
    "Микрофон включён только во время диктовки, и Fawkes всё это время показывает «Слушает».",
  "capture.dictation.killSwitch": "Включена аварийная остановка: диктовка заблокирована.",
  "capture.dictation.saved.on": "Диктовка включена.",
  "capture.dictation.saved.off": "Диктовка выключена.",
  "capture.dictation.saved.defaultMode": "Очистка по умолчанию сохранена.",
  "capture.dictation.saved.appModes": "Режимы очистки для приложений сохранены.",
  "capture.dictation.saved.typing": "Скорость набора сохранена.",
  "capture.dictation.saved.vocabulary": "Списки слов сохранены.",
  "capture.dictation.saved.statsDeleted": "Вся статистика диктовки удалена.",
  "capture.dictation.cleanup.heading": "Очистка",
  "capture.dictation.cleanup.default": "Очистка по умолчанию",
  "capture.dictation.typing.heading": "Скорость набора",
  "capture.dictation.typing.label": "Как быстро вы печатаете? (слов в минуту)",
  "capture.dictation.typing.save": "Сохранить скорость набора",
  "capture.dictation.typing.invalid": "Введите целое число от {min} до {max}.",
  "capture.dictation.appModes.summary":
    "Очистка для приложений ({count} из {max}). Для приложения не из списка используется настройка по умолчанию.",
  "capture.dictation.appModes.entry": "{app}: {mode}",
  "capture.dictation.appModes.remove": "Удалить {app}",
  "capture.dictation.appModes.idLabel": "Идентификатор приложения (например, bundle id)",
  "capture.dictation.appModes.modeLabel": "Очистка для этого приложения",
  "capture.dictation.appModes.set": "Задать очистку для приложения",
  "capture.dictation.appModes.invalid":
    "Используйте буквы, цифры, точку, дефис или подчёркивание (не более {max}).",
  "capture.dictation.problem.plainWords":
    "Используйте обычные слова, разделённые одиночными пробелами (без знаков препинания).",
  "capture.dictation.problem.maxChars":
    "{n, plural, one {Не более # символа.} few {Не более # символов.} many {Не более # символов.} other {Не более # символа.}}",
  "capture.dictation.problem.maxWords":
    "{n, plural, one {Не более # слова.} few {Не более # слов.} many {Не более # слов.} other {Не более # слова.}}",
  "capture.dictation.problem.term":
    "{n, plural, one {Не более # видимого символа, без пробелов по краям.} few {Не более # видимых символов, без пробелов по краям.} many {Не более # видимых символов, без пробелов по краям.} other {Не более # видимого символа, без пробелов по краям.}}",
  "capture.dictation.problem.soundsLike":
    "«Звучит как» нужно, когда термин состоит не из обычных слов: {problem}",
  "capture.dictation.problem.replacement":
    "{n, plural, one {Не более # видимого символа.} few {Не более # видимых символов.} many {Не более # видимых символов.} other {Не более # видимого символа.}}",
  "capture.dictation.problem.snippet":
    "{n, plural, one {Не более # символа; без управляющих и скрытых символов.} few {Не более # символов; без управляющих и скрытых символов.} many {Не более # символов; без управляющих и скрытых символов.} other {Не более # символа; без управляющих и скрытых символов.}}",
  "capture.dictation.vocabulary.heading": "Словарь, замены и фрагменты",
  "capture.dictation.vocabulary.intro":
    "Здесь всё — буквальный текст: шаблонов нет. При сопоставлении регистр не учитывается, и оно работает по целым словам.",
  "capture.dictation.vocabulary.save": "Сохранить списки слов",
  "capture.dictation.dictionary.heading": "Словарь ({count} из {max})",
  "capture.dictation.dictionary.intro": "Укажите, как должно писаться имя или термин.",
  "capture.dictation.dictionary.entry": "«{soundsLike}» → {term}",
  "capture.dictation.dictionary.remove": "Удалить запись словаря {term}",
  "capture.dictation.dictionary.term": "Термин",
  "capture.dictation.dictionary.soundsLike": "Звучит как (необязательно)",
  "capture.dictation.dictionary.add": "Добавить запись в словарь",
  "capture.dictation.replacements.heading": "Замены ({count} из {max})",
  "capture.dictation.replacements.entry": "«{from}» → «{to}»",
  "capture.dictation.replacements.entryRemoved": "«{from}» → (удалено)",
  "capture.dictation.replacements.remove": "Удалить замену {from}",
  "capture.dictation.replacements.from": "Заменить слова",
  "capture.dictation.replacements.to": "На (пустое значение удаляет их)",
  "capture.dictation.replacements.add": "Добавить замену",
  "capture.dictation.snippets.heading": "Фрагменты ({count} из {max})",
  "capture.dictation.snippets.intro":
    "Фрагмент разворачивается, только если вся диктовка в точности совпадает с его триггером.",
  "capture.dictation.snippets.entry": "«{trigger}» → {text}",
  "capture.dictation.snippets.remove": "Удалить фрагмент {trigger}",
  "capture.dictation.snippets.trigger": "Когда я говорю",
  "capture.dictation.snippets.text": "Вставить этот текст",
  "capture.dictation.snippets.add": "Добавить фрагмент",
  "capture.dictation.stats.heading": "Статистика",
  "capture.dictation.stats.none": "Диктовок ещё не было.",
  "capture.dictation.stats.words": "Надиктовано слов",
  "capture.dictation.stats.sessions": "Диктовки",
  "capture.dictation.stats.saved": "Сэкономлено времени",
  "capture.dictation.stats.savedValue":
    "{duration} (набор со скоростью {wpm, plural, one {# слово в минуту} few {# слова в минуту} many {# слов в минуту} other {# слова в минуту}})",
  "capture.dictation.stats.average": "Средняя скорость речи",
  "capture.dictation.stats.wordsPerMinute":
    "{n, plural, one {# слово в минуту} few {# слова в минуту} many {# слов в минуту} other {# слова в минуту}}",
  "capture.dictation.stats.streak": "Серия",
  "capture.dictation.stats.days":
    "{n, plural, one {# день} few {# дня} many {# дней} other {# дня}}",
  "capture.dictation.stats.topApps": "Популярные приложения",
  "capture.dictation.stats.noApps": "нет",
  "capture.dictation.stats.unknownApp": "неизвестное приложение",
  "capture.dictation.stats.appWords":
    "{app} ({n, plural, one {# слово} few {# слова} many {# слов} other {# слова}})",
  "capture.dictation.stats.note":
    "Это только показатели. Названия приложений доступны только вам и никуда не отправляются. Core хранит их, пока вы их не удалите.",
  "capture.dictation.stats.confirmGroup": "Подтвердить удаление статистики",
  "capture.dictation.stats.confirmText": "Удалить всю статистику диктовки? Это нельзя отменить.",
  "capture.dictation.stats.confirmYes": "Да, удалить всё",
  "capture.dictation.stats.confirmKeep": "Оставить",
  "capture.dictation.stats.delete": "Удалить всю статистику диктовки",
  "capture.pill.waiting": "Ожидание микрофона…",
  "capture.pill.listening": "Слушает: ваш микрофон включён",
  "capture.pill.recognising": "Распознавание…",
  "capture.pill.ready": "Готово",
  "capture.pill.stop": "Остановить",
  "capture.pill.recordCall": "Записать звонок",
  "capture.pill.recordCall.title": "Записать звонок: открывает запись звонков в Phoenix",
  "capture.pill.openPhoenix": "Открыть Phoenix",
  "capture.pill.pasteFailed": "Не удалось вставить текст.",
  "capture.pill.outcome.typed": "Введено",
  "capture.pill.outcome.pasted": "Вставлено",
  "capture.attachments.kind.text": "Текст",
  "capture.attachments.kind.image": "Изображение",
  "capture.attachments.kind.folder": "Папка",
  "capture.attachments.origin.drop": "перетащено",
  "capture.attachments.origin.window": "окно",
  "capture.attachments.origin.paste": "вставлено",
  "capture.attachments.localOnly": "Только локально",
  "capture.attachments.dropZone.label": "Перетащите файлы на {label}",
  "capture.attachments.dropZone.over": "Отпустите, чтобы прикрепить.",
  "capture.attachments.dropZone.hint":
    "Перетащите сюда текстовые файлы, изображения PNG/JPEG или папку либо {attach} Прикрепление ничего не отправляет.",
  "capture.attachments.dropZone.attachFiles": "прикрепите файлы…",
  "capture.attachments.dropZone.choose": "Выберите файлы для прикрепления",
  "capture.attachments.dropZone.reading": "Чтение перетащенного…",
  "capture.attachments.preview.imageAlt": "Предпросмотр {name}",
  "capture.attachments.preview.listingBroken": "Сохранённый список невозможно показать.",
  "capture.attachments.preview.filesIn": "Файлы в {name}",
  "capture.attachments.preview.contentsOf": "Содержимое {name}",
  "capture.attachments.chip.include": "Включить {name} в вопрос",
  "capture.attachments.chip.meta": "{kind} · {size} · {origin}",
  "capture.attachments.chip.metaFiles":
    "{kind}, {files, plural, one {# файл} few {# файла} many {# файлов} other {# файла}} · {size} · {origin}",
  "capture.attachments.chip.previewLabel": "Предпросмотр {name}",
  "capture.attachments.chip.removeLabel": "Убрать {name}",
  "capture.attachments.chip.preview": "Предпросмотр",
  "capture.attachments.chip.hide": "Скрыть",
  "capture.attachments.tray.label": "Вложения",
  "capture.attachments.tray.heading": "Вложения ({n})",
  "capture.attachments.tray.localOnlyTitle":
    "Прикреплённые файлы читает только модель на этом устройстве",
  "capture.attachments.tray.clearAll": "Очистить всё",
  "capture.attachments.tray.noteTicked":
    "Хранится только в памяти Phoenix Core (никогда не сохраняется на диск) не более {minutes, plural, one {# минуты} few {# минут} many {# минут} other {# минуты}}. При нажатии «Спросить о вложениях» модели на этом устройстве передаётся целиком: {n, plural, one {выбранный элемент} few {# выбранных элемента} many {# выбранных элементов} other {# выбранного элемента}}. Ничто не покидает это устройство.",
  "capture.attachments.tray.noteNone":
    "Хранится только в памяти Phoenix Core (никогда не сохраняется на диск) не более {minutes, plural, one {# минуты} few {# минут} many {# минут} other {# минуты}}. Ничего не отправляется, пока вы не спросите.",
  "capture.attachments.tray.tooMany":
    "В вопросе можно использовать не более {max, plural, one {# элемента} few {# элементов} many {# элементов} other {# элемента}}. Чтобы задать вопрос, снимите отметки с лишних элементов: {n}.",
  "capture.attachments.draft.open": "Черновик письма",
  "capture.attachments.draft.to": "Кому (необязательно)",
  "capture.attachments.draft.message": "Сообщение (именно этот текст попадёт в черновик)",
  "capture.attachments.draft.count":
    "{n} / {max} символов. Открывает приложение почты с черновиком. Phoenix его не отправляет.",
  "capture.attachments.draft.submit": "Открыть черновик письма",
  "capture.attachments.draft.openFailed": "Не удалось открыть приложение почты.",
  "capture.attachments.answer.local": "бесплатно, на этом устройстве",
  "capture.attachments.answer.cloud": "облако",
  "capture.attachments.answer.processed": "Обработано: {by} · {where}",
  "capture.attachments.answer.processedVision":
    "Обработано: {by} · изображения прочитаны {vision} на этом устройстве · {where}",
  "capture.attachments.answer.from": "Из: {names}. Сгенерированный текст, не сохранённый факт.",
  "capture.attachments.fawkesDrop.heading": "Дайте Fawkes файл",
  "capture.attachments.fawkesDrop.hint":
    "Перетащите файл, изображение или папку на Fawkes, затем спросите о них на вкладке «Чат».",
  "capture.attachments.fawkesDrop.count": "Прикреплено: {n}.",
  "capture.attachments.file.badName":
    "{name}: имя пустое, слишком длинное или содержит скрытые символы",
  "capture.attachments.file.imageTooBig": "{name}: изображение может быть не больше 5 MiB",
  "capture.attachments.file.unreadable": "{name}: не удалось прочитать файл",
  "capture.attachments.file.unsupported":
    "{name}: неподдерживаемый тип (текстовые файлы, изображения PNG/JPEG или папка)",
  "capture.attachments.file.tooLargeBytes":
    "{name}: слишком большой (текстовый файл может содержать не более {max} символов)",
  "capture.attachments.file.empty": "{name}: файл пуст",
  "capture.attachments.file.tooLarge":
    "{name}: слишком большой ({chars} символов; ограничение — {max})",
  "capture.attachments.skip.unreadableFolder":
    "{label}: пропущено папок, которые не удалось прочитать: {n}",
  "capture.attachments.skip.unusualName": "{label}: пропущено элементов с необычным именем: {n}",
  "capture.attachments.skip.hidden":
    "{label}: пропущено скрытых файлов и папок: {n} (имена с точкой, node_modules, .git)",
  "capture.attachments.skip.longPath":
    "{label}: пропущено элементов с путём длиннее {pathChars} символов: {n}",
  "capture.attachments.skip.tooDeep":
    "{label}: пропущено папок, вложенных глубже {depth} уровней: {n}",
  "capture.attachments.skip.special":
    "{label}: пропущено элементов, не являющихся ни файлом, ни папкой: {n}",
  "capture.attachments.skip.unreadableFile":
    "{label}: пропущено файлов, которые не удалось прочитать: {n}",
  "capture.attachments.skip.longText":
    "{label}: пропущено текстовых файлов, слишком длинных для включения (указаны без содержимого): {n}",
  "capture.attachments.folder.capped": "{label}: указаны только первые {max} файлов",
  "capture.attachments.folder.noFiles": "{label}: читаемых файлов не найдено",
  "capture.attachments.folder.badName": "{label}: имя папки нельзя использовать",
  "capture.attachments.notice.uploadFailed": "{name}: {reason}",
  "capture.attachments.notice.attached":
    "Прикреплено: {n, plural, one {# элемент} few {# элемента} many {# элементов} other {# элемента}}. Пока ничего никуда не отправлено.",
  "capture.attachments.notice.nothingAttached": "Ничего не прикреплено.",
  "capture.attachments.notice.withProblems": "{head} {problems}",
  "capture.attachments.nativeDrop.folder":
    "{name}: сюда нельзя перетащить папку. Используйте поле чата или Pet Panel.",
  "capture.attachments.nativeDrop.skipped":
    "Используются только первые {max} файлов; ещё {n} проигнорировано.",
  "capture.attachments.mail.subject": "О: {name}",
  "capture.attachments.mail.empty": "Сначала напишите, чем хотите поделиться.",
  "capture.attachments.mail.tooLong":
    "Сообщение превышает лимит в {limit} символов; лишних символов: {over}. Сократите его.",
  "capture.attachments.mail.badAddress":
    "Введите один адрес электронной почты или оставьте получателя пустым.",
  "capture.attachments.mail.urlTooLong":
    "Почтовые ссылки такой длины ненадёжны ({length} из {limit} символов после кодирования). Сократите сообщение.",
  "capture.chat.ciForm.badRepository":
    "Введите репозиторий в формате «владелец/имя», например «acme/app».",
  "capture.chat.ciForm.badRunId":
    "Идентификатор запуска должен быть положительным целым числом; для последнего неудачного запуска оставьте поле пустым.",
  "capture.chat.ciForm.label": "Диагностика сбоя CI",
  "capture.chat.ciForm.intro":
    "Fawkes прочитает неудачный запуск GitHub Actions и вашу локальную историю git. Он ничего не изменит.",
  "capture.chat.ciForm.repository": "Репозиторий (владелец/имя)",
  "capture.chat.ciForm.runId":
    "Идентификатор запуска (необязательно; пусто — последний неудачный запуск)",
  "capture.chat.ciForm.start": "Начать диагностику",
  "capture.chat.who.you": "Вы",
  "capture.chat.status": "Fawkes: {state}.",
  "capture.chat.intro":
    "Спросите, что помнит Fawkes. В ответах сначала перечислены сохранённые факты с источниками; всё сгенерированное помечено. Этот разговор хранится только на этой странице и исчезнет после перезагрузки.",
  "capture.chat.empty": "Сообщений пока нет.",
  "capture.chat.conversation": "Разговор",
  "capture.chat.waiting": "Ожидание ответа Phoenix Core…",
  "capture.chat.dropLabel": "поле чата",
  "capture.chat.message": "Сообщение для Fawkes",
  "capture.chat.count": "{n} / {max} символов · Enter отправляет, Shift+Enter переносит строку",
  "capture.chat.send": "Отправить",
  "capture.chat.sending": "Отправка…",
  "capture.chat.askAttachments": "Спросить о вложениях",
  "capture.chat.askAttachmentsNone": "Сначала прикрепите что-нибудь или отметьте вложение",
  "capture.chat.askAttachmentsTitle":
    "Отправляет ваш вопрос и отмеченные вложения модели на этом устройстве",
  "capture.chat.diagnose": "Диагностика сбоя CI",
  "capture.chat.automationOff":
    "Автоматизация выключена, поэтому Fawkes не может запускать задачи. Включите её в «Настройках», в разделе «Автоматизация».",
  "capture.chat.attachmentQuestion": "{text}\n(о: {names})",
  "capture.chat.error.askMemory": "Не удалось запросить память: {reason}.",
  "capture.chat.error.askAttachments": "Не удалось спросить о вложениях: {reason}.",
  "capture.chat.error.automationOff":
    "Автоматизация выключена, поэтому задача не запущена. Включите её в «Настройках», в разделе «Автоматизация».",
  "capture.chat.error.startTask": "Не удалось запустить задачу: {reason}.",
  "capture.chat.ciUser.latest": "Диагностика сбоя CI в {repository} (последний неудачный запуск)",
  "capture.chat.ciUser.run": "Диагностика сбоя CI в {repository} (запуск {run})",
  "capture.answer.sensitivity.public": "Публичное",
  "capture.answer.sensitivity.internal": "Внутреннее",
  "capture.answer.sensitivity.sensitive": "Конфиденциальное",
  "capture.answer.classification.storedFact": "Сохранённый факт",
  "capture.answer.classification.retrievedEvidence":
    "Найденное свидетельство, не утверждённый факт",
  "capture.answer.classification.storedInterpretation": "Сохранённая интерпретация, не факт",
  "capture.answer.freshness.stale": "Устаревшее наблюдение",
  "capture.answer.freshness.fresh": "Свежее наблюдение",
  "capture.answer.confidenceUnknown": "неизвестно",
  "capture.answer.record":
    "{classification} · идентификатор источника {id} · {domain} · из {source}{ref} · наблюдалось {observed} · {sensitivity} · {freshness} · уверенность {confidence}",
  "capture.answer.attribution.whereLocal": "на этом устройстве",
  "capture.answer.attribution.whereCloud": "в облаке (покидает это устройство)",
  "capture.answer.attribution.costUnknown": "стоимость неизвестна",
  "capture.answer.attribution.costFree": "бесплатно, на этом устройстве",
  "capture.answer.attribution.costAbout": "около ${amount} (по вашим ценам)",
  "capture.answer.attribution.defaultModel": "модель по умолчанию",
  "capture.answer.attribution.line": "Ответ: {model} через {provider} · {where} · {cost}",
  "capture.answer.facts.heading": "Сохранённые факты",
  "capture.answer.facts.empty": "Сохранённых фактов, подходящих к вашему вопросу, нет.",
  "capture.answer.evidence.heading": "Найденные свидетельства (не сохранённые факты)",
  "capture.answer.evidence.empty": "Подходящих найденных свидетельств нет.",
  "capture.answer.interpretations.heading": "Прежние сохранённые интерпретации (не факты)",
  "capture.answer.interpretations.empty": "Подходящих прежних интерпретаций нет.",
  "capture.answer.hypothesis.heading": "Сгенерированная гипотеза",
  "capture.answer.hypothesis.label":
    "Сгенерированная гипотеза от {by}, не сохранённый факт и не установленный вывод.",
  "capture.answer.hypothesis.anAiModel": "модель ИИ",
  "capture.answer.hypothesis.noInterpretation": "ИИ использовался, но не дал интерпретации.",
  "capture.answer.hypothesis.noAi": "ИИ не использовался.",
  "capture.retrieval.hybrid": "Найдено по ключевым словам и по смыслу (умный поиск).",
  "capture.retrieval.keywordsOnly": "Найдено только по ключевым словам.",
  "capture.retrieval.notUsed": "Умный поиск не использовался: {reason}.",
  "capture.retrieval.skipped.aiDisabled": "ИИ выключен",
  "capture.retrieval.truncated": "Самые старые записи памяти пропущены ради скорости.",
};
