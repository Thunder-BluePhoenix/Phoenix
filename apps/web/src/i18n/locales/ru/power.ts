// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { power as enpower } from "../../en/power";

/** Machine-translated; unreviewed (see ../../README.md). */
export const power: Record<keyof typeof enpower, string> = {
  "power.awake.duration.minutes":
    "{minutes, plural, one {# минута} few {# минуты} many {# минут} other {# минуты}}",
  "power.awake.duration.hours":
    "{hours, plural, one {# час} few {# часа} many {# часов} other {# часа}}",
  "power.awake.heading": "Не засыпать",
  "power.awake.disabled": "«Не засыпать» выключено. Включите возможность, чтобы пользоваться ею.",
  "power.awake.waiting": "Ожидание вашего подтверждения…",
  "power.awake.idle":
    "Компьютер засыпает как обычно. Запустите сеанс с таймером, чтобы он не засыпал.",
  "power.awake.start.heading": "Не засыпать в течение",
  "power.awake.custom.label": "Минуты",
  "power.awake.reason.label": "Причина (необязательно)",
  "power.awake.custom.start": "Начать",
  "power.awake.custom.invalid": "Введите целое число минут от {min} до {max}.",
  "power.awake.agents.start": "Пока работают агенты",
  "power.awake.agents.help":
    "Не даёт засыпать, пока работает любой кодовый агент, и заканчивается через несколько минут после завершения последнего (используются минуты выше).",
  "power.awake.agents.working":
    "{count, plural, one {# агент работает} few {# агента работают} many {# агентов работают} other {# агента работают}}",
  "power.awake.agents.grace":
    "Заканчивается через {minutes, plural, one {# минуту} few {# минуты} many {# минут} other {# минуты}} после завершения последнего агента.",
  "power.awake.running": "Компьютер не засыпает",
  "power.awake.remaining": "Осталось: {time}",
  "power.awake.endsAt": "Закончится в {time}",
  "power.awake.extend.label": "Добавить время",
  "power.awake.extend.button": "+{duration}",
  "power.awake.end.hold": "Удерживайте, чтобы завершить",
  "power.awake.end.holding": "Продолжайте удерживать…",
  "power.awake.end.hint":
    "Удерживайте кнопку 1,5 секунды (или удерживайте пробел или Enter), чтобы завершить сеанс.",
  "power.awake.battery":
    "Сеанс также закончится, если заряд упадёт ниже {percent}% при работе от батареи.",
  "power.awake.lid":
    "Закрытая крышка всё равно переводит компьютер в сон; чтобы не засыпать с закрытой крышкой, нужен отдельный режим закрытой крышки.",
  "power.awake.indicator": "Не спит {time}",
  "power.recovery.heading": "Режим закрытой крышки и восстановление",
  "power.recovery.waiting": "Ожидание вашего подтверждения…",
  "power.recovery.unreadable": "Не удалось прочитать состояние восстановления.",
  "power.recovery.journal.clean": "Нечего отменять.",
  "power.recovery.journal.pending":
    "Phoenix не смог вернуть {count, plural, one {# изменение системы} few {# изменения системы} many {# изменений системы} other {# изменения системы}}. Настройки сна могут остаться изменёнными.",
  "power.recovery.journal.kind.disablesleep": "Не засыпать с закрытой крышкой",
  "power.recovery.journal.kind.lowpowermode": "Режим низкого энергопотребления",
  "power.recovery.journal.kind.other": "Другое изменение",
  "power.recovery.journal.at": "с {time}",
  "power.recovery.journal.undo": "Отменить сейчас",
  "power.recovery.journal.untrusted":
    "{count, plural, one {Пропущена # нечитаемая строка журнала} few {Пропущено # нечитаемые строки журнала} many {Пропущено # нечитаемых строк журнала} other {Пропущено # нечитаемой строки журнала}}, им нет доверия.",
  "power.recovery.journal.cannotQuit": "Выход из Phoenix запрещён, пока это не отменено.",
  "power.recovery.lid.open": "Крышка открыта.",
  "power.recovery.lid.closed": "Крышка закрыта.",
  "power.recovery.lid.unknown": "Состояние крышки неизвестно.",
  "power.recovery.lid.unsupported":
    "У этого компьютера нет датчика крышки, поэтому режим закрытой крышки недоступен.",
  "power.recovery.helper.installed": "Привилегированный помощник установлен",
  "power.recovery.helper.missing":
    "Привилегированный помощник не установлен (режим закрытой крышки недоступен). См. docs/awake-helper.md.",
  "power.recovery.helper.unknown": "Неизвестно, установлен ли привилегированный помощник.",
  "power.recovery.floors.off": "Пороги выключены",
  "power.recovery.floors.rule":
    "Режим низкого энергопотребления ниже {low} %, завершение сеанса ниже {end} %; нагрев: режим низкого энергопотребления при {heatLow}, завершение при {heatEnd}.",
  "power.recovery.floors.lowPowerActive": "Режим низкого энергопотребления включён",
  "power.recovery.floors.battery.none": "Батарея: нет",
  "power.recovery.floors.battery.unknown": "Батарея: неизвестно",
  "power.recovery.floors.battery.level": "Батарея {percent} %",
  "power.recovery.floors.battery.unplugged": "Батарея {percent} %, от батареи",
  "power.recovery.floors.battery.plugged": "Батарея {percent} %, от сети",
  "power.recovery.floors.thermal.nominal": "норма",
  "power.recovery.floors.thermal.fair": "тепло",
  "power.recovery.floors.thermal.serious": "горячо",
  "power.recovery.floors.thermal.critical": "критично",
  "power.recovery.floors.thermal.level": "Нагрев: {level}",
  "power.recovery.floors.thermal.unsupported": "Нагрев: не сообщается",
  "power.recovery.floors.thermal.unknown": "Нагрев: неизвестно",
  "power.recovery.safety.warning":
    "Никогда не носите компьютер в сумке, чехле или другом закрытом пространстве при включённом режиме закрытой крышки: он может перегреться. Не закрывайте вентиляционные отверстия.",
  "power.recovery.safety.understand": "Я понимаю",
  "power.recovery.safety.acknowledge": "Подтвердить",
  "power.recovery.safety.done":
    "Вы подтвердили предупреждение о безопасности режима закрытой крышки.",
  "power.recovery.start": "Включить режим закрытой крышки",
  "power.recovery.end": "Выключить режим закрытой крышки",
  "power.recovery.engaged": "Режим закрытой крышки включён.",
  "power.recovery.engagedSince": "Режим закрытой крышки включён с {time}.",
  "power.recovery.needsSession":
    "Сначала начните сеанс «Не засыпать»; режиму закрытой крышки он нужен.",
  "power.recovery.journal.discard": "Отбросить эту запись",
  "power.recovery.lockBlocked":
    "Блокировку удерживает другой процесс восстановления, поэтому пока ничего не отменено. Изменение всё ещё ожидает отмены.",
  "power.recovery.sleepUnjournaled":
    "На этом компьютере отключён сон, но у Phoenix нет записи о том, что он его отключал. Это изменило что-то другое.",
  "power.recovery.journalPath": "Журнал: {path}",
  "power.continuity.heading": "Непрерывность работы агентов",
  "power.continuity.intro":
    "Дополнения для долгих запусков агентов. Каждое из них выключено, пока вы его не включите, и ни одно не выбирает за вас сеть, терминал или программу.",
  "power.continuity.needsAwake":
    "Эти настройки действуют только при включённой возможности «Не засыпать».",
  "power.continuity.saved": "Сохранено. Изменения применятся при следующем запуске «Не засыпать».",
  "power.continuity.applyNote":
    "Изменения сохраняются в возможности «Не засыпать» и применяются при её следующем включении.",
  "power.continuity.network.title": "Наблюдение за сетью",
  "power.continuity.network.help":
    "Каждые несколько секунд проверяет, доступен ли указанный вами компьютер, и сообщает Phoenix, когда сеть пропадает и когда возвращается. Он только подключается; ничего не отправляет и не читает.",
  "power.continuity.hosts.label": "Хосты для проверки (имя или имя:порт)",
  "power.continuity.hotspot.title": "Переключение на точку доступа",
  "power.continuity.hotspot.help":
    "Если Wi-Fi пропадает во время сеанса «Не засыпать», подключиться к указанной вами точке доступа iPhone. Требуется наблюдение за сетью выше и список хостов. Работает только в macOS и не проверялось на настоящем Mac.",
  "power.continuity.hotspot.ssid": "Имя точки доступа (SSID)",
  "power.continuity.hotspot.disclosure":
    "Прежде чем включать: macOS может подключиться к уже известной ей сети без пароля в командной строке, поэтому сначала один раз подключитесь к своей точке доступа вручную. Только если вы дополнительно разрешите сохранённый ниже пароль, Phoenix передаст его инструменту macOS networksetup, и тогда любая программа на этом Mac сможет прочитать его в этой командной строке в течение нескольких секунд, пока идёт подключение. Более безопасного встроенного способа сделать это без вашего участия нет. Откажитесь, если это неприемлемо.",
  "power.continuity.hotspot.allowPassword":
    "Я согласен: использовать сохранённый пароль точки доступа в командной строке",
  "power.continuity.hotspot.passwordSaved": "Пароль точки доступа сохранён в keychain.",
  "power.continuity.hotspot.passwordMissing":
    "Пароль точки доступа не сохранён. Сохраните его как секрет «hotspot_password» возможности «Не засыпать» или оставьте этот флажок выключенным и один раз подключитесь к точке доступа вручную.",
  "power.continuity.hotspot.join": "Подключиться к точке доступа сейчас",
  "power.continuity.hotspot.rejoin": "Вернуться к предыдущей сети",
  "power.continuity.hotspot.confirmNote":
    "Подключение к сети меняет Wi-Fi, который использует этот Mac. Phoenix каждый раз просит вас подтвердить это.",
  "power.continuity.hotspot.joined": "Подключено.",
  "power.continuity.nudge.title": "Подтолкнуть агентов",
  "power.continuity.nudge.help":
    "Если сети нет дольше указанного ниже времени, ввести «continue» в перечисленные вами терминалы. Во время встречи или диктовки ничего не вводится, и каждый терминал получает это не более одного раза за сбой.",
  "power.continuity.nudge.after": "Секунд без сети до подталкивания (от 30 до 3600)",
  "power.continuity.nudge.panes": "Панели tmux (например, %12)",
  "power.continuity.nudge.sessions": "Сеансы агентов Phoenix (ph- и 16 шестнадцатеричных цифр)",
  "power.continuity.nudge.sessionsNote":
    "Пока недоступно: у Phoenix нет безопасного способа вводить текст в отслеживаемый сеанс, поэтому перечисленные сеансы пропускаются, о чём сообщается. Подталкиваются только панели tmux.",
  "power.continuity.nudge.commands": "Программы, которые может выполнять панель (например, claude)",
  "power.continuity.nudge.commandsNote":
    "Перед вводом Phoenix проверяет, что панель всё ещё существует и выполняет одну из этих программ. При пустом списке ничего никогда не вводится.",
  "power.continuity.nudge.enter": "Также нажимать Enter",
  "power.continuity.nudge.enterHelp":
    "По умолчанию выключено. Без этого «continue» вводится, но не отправляется, и Enter нужно нажать самому.",
  "power.continuity.throttle.title": "Проверка замедления браузеров",
  "power.continuity.throttle.help":
    "Chrome, Arc, Comet, Edge и Brave замедляют фоновые вкладки, из-за чего веб-страница агента может зависнуть. Здесь перечислены браузеры, работающие в таком режиме. Браузер никогда не изменяется, пока вы не выберете «Перезапустить» и не подтвердите.",
  "power.continuity.throttle.unsupported": "Проверка браузеров работает только в macOS.",
  "power.continuity.throttle.notRunning": "не запущен",
  "power.continuity.throttle.throttled": "работает с замедлением фоновых вкладок",
  "power.continuity.throttle.fine": "работает без замедления",
  "power.continuity.throttle.relaunch": "Перезапустить {name} без замедления",
  "power.continuity.throttle.confirm":
    "Перезапустить {name} без замедления фоновых вкладок? {name} закроется и откроется снова, его вкладки перезагрузятся, а всё несохранённое на странице может быть потеряно. Во время встречи или диктовки это отклоняется.",
  "power.continuity.throttle.confirmYes": "Закрыть и перезапустить",
  "power.continuity.throttle.relaunched": "{name} перезапущен.",
  "power.continuity.outage.title": "Последний сбой сети",
  "power.continuity.outage.none": "Сбоев сети пока не было.",
  "power.continuity.outage.down": "Сеть недоступна с {time}.",
  "power.continuity.outage.ended": "Сеть была недоступна с {from} до {to}.",
  "power.continuity.outage.nudged":
    "{count, plural, one {# терминал подтолкнут} few {# терминала подтолкнуты} many {# терминалов подтолкнуты} other {# терминала подтолкнуты}}",
  "power.continuity.outage.hotspot.joined": "К точке доступа подключились",
  "power.continuity.outage.hotspot.failed": "Не удалось подключиться к точке доступа",
  "power.continuity.outage.hotspot.skipped":
    "Подключение к точке доступа не пробовали (выключено или нет запущенного сеанса)",
  "power.continuity.outage.hotspot.notTried": "Подключение к точке доступа ещё не пробовали",
  "power.continuity.list.empty": "Список пуст.",
  "power.continuity.list.remove": "Удалить {item}",
  "power.continuity.invalid.host":
    "Укажите имя хоста или адрес, при желании с :портом (от 1 до 65535).",
  "power.continuity.invalid.pane":
    "Укажите идентификатор панели tmux, например %12: знак процента и до шести цифр.",
  "power.continuity.invalid.session": "Укажите идентификатор сеанса, например ph-0123456789abcdef.",
  "power.continuity.invalid.command":
    "Укажите имя программы, например claude: только буквы, цифры и символы . _ + -",
  "power.continuity.invalid.ssid":
    "Используйте от 1 до 32 байт видимого текста, не начинающегося с дефиса.",
  "power.continuity.invalid.seconds": "Введите целое число секунд от {min} до {max}.",
  "power.continuity.problem.duplicate": "Эта запись уже есть в списке.",
  "power.continuity.problem.full": "Список заполнен (не более {max} записей).",
  "power.continuity.reason.unsupported_platform": "Это работает только в macOS.",
  "power.continuity.reason.no_wifi_device": "Phoenix не удалось найти устройство Wi-Fi этого Mac.",
  "power.continuity.reason.no_hotspot_configured":
    "Нет подходящей точки доступа или предыдущей сети для подключения.",
  "power.continuity.reason.bad_password":
    "Сохранённый пароль использовать нельзя. Проверьте его в keychain.",
  "power.continuity.reason.join_failed": "macOS не удалось подключиться к сети.",
  "power.continuity.reason.unknown_browser": "Этим браузером Phoenix не управляет.",
  "power.continuity.reason.protected": "Сейчас нельзя: идёт встреча или диктовка.",
  "power.continuity.reason.not_running": "Этот браузер не запущен.",
  "power.continuity.reason.already_unthrottled":
    "Этот браузер уже работает без замедления фоновых вкладок.",
  "power.continuity.reason.unavailable": "Сейчас это недоступно.",
  "power.continuity.reason.quit_failed": "Браузер не принял запрос на закрытие.",
  "power.continuity.reason.still_running":
    "Браузер всё ещё открыт, поэтому он не был открыт заново. Закройте его сами и повторите попытку.",
  "power.continuity.reason.open_failed": "Браузер закрылся, но открыть его заново не удалось.",
  "power.continuity.reason.other": "Не получилось.",
  "power.lid.heading": "Действия при закрытии крышки",
  "power.lid.intro":
    "Пока идёт сеанс «Не засыпать» и вы закрываете крышку, Phoenix может экономить энергию и приглушать компьютер. Всё отменяется, когда вы открываете крышку, когда сеанс заканчивается и когда Phoenix запускается снова после сбоя.",
  "power.lid.needsAwake":
    "Эти действия выполняются только при включённой возможности «Не засыпать».",
  "power.lid.master.title": "Выполнять действия при закрытии крышки",
  "power.lid.master.help":
    "Главный переключатель. Если выключен, ничего из списка ниже не выполняется.",
  "power.lid.display.title": "Выключить дисплей",
  "power.lid.display.help":
    "Переводит дисплей в спящий режим. Яркость сохраняется и восстанавливается, если установлен бесплатный инструмент яркости.",
  "power.lid.freeze.title": "Заморозить приложения чатов",
  "power.lid.freeze.help":
    "Приостанавливает выбранные приложения чатов, чтобы они не тратили энергию, а затем возобновляет их. Никогда во время встречи, записи или диктовки и никогда для терминалов, редакторов и работающих агентов программирования.",
  "power.lid.freeze.apps": "Приложения для заморозки",
  "power.lid.mute.title": "Отключить звук",
  "power.lid.mute.help":
    "Отключает вывод звука и восстанавливает его точно как было, даже если вы между делом переключили устройство вывода.",
  "power.lid.lowPower.title": "Режим энергосбережения",
  "power.lid.lowPower.help":
    "Включает режим энергосбережения. Нужен необязательный привилегированный помощник; без него пропускается.",
  "power.lid.docker.title": "Заморозить Docker Desktop",
  "power.lid.docker.help":
    "Приостанавливает Docker Desktop, пока не запущен ни один контейнер. Никогда, если контейнер работает или состояние Docker неизвестно.",
  "power.lid.nap.title": "Не усыплять приложения агентов (App Nap)",
  "power.lid.nap.help":
    "Не даёт macOS замедлять перечисленные приложения. Их прежняя настройка сохраняется и возвращается в точности.",
  "power.lid.nap.apps": "Приложения (bundle id, например com.example.App)",
  "power.lid.protected.title": "Никогда не замораживаются",
  "power.lid.protected.help":
    "Их всегда оставляют в покое. Можно добавлять в список, но встроенную защиту убрать нельзя.",
  "power.lid.protected.builtIn": "Встроенные",
  "power.lid.protected.extra": "Добавить имя программы или приложения",
  "power.lid.list.empty": "Ничего не добавлено.",
  "power.lid.list.remove": "Удалить {item}",
  "power.lid.list.duplicate": "Это уже есть в списке.",
  "power.lid.list.full": "Список заполнен (записей: {max}).",
  "power.lid.invalid.bundle":
    "Используйте bundle id вида com.example.App: буквы, цифры и дефисы, минимум одна точка.",
  "power.lid.invalid.name":
    "Используйте простое имя программы или приложения: буквы, цифры, пробелы и . _ + -",
  "power.lid.unsupported": "Здесь недоступно: {reason}",
  "power.lid.gapNote":
    "Некоторые из них работают на этом компьютере лишь частично. См. README-lid.md, что поддерживается, а что нет.",
  "power.lid.last.title": "Последнее событие крышки",
  "power.lid.last.closed": "Крышка закрыта в {time}.",
  "power.lid.last.opened": "Крышка открыта в {time}.",
  "power.lid.last.none": "Пока ничего не происходило.",
  "power.lid.last.mismatched":
    "{count, plural, other {Процессов не возобновлено: #, так как они больше не совпадали с тем, что заморозил Phoenix.}}",
  "power.lid.last.stillClosed": "Крышка сейчас закрыта, действия выше применены.",
  "power.lid.outcome.applied": "Выполнено",
  "power.lid.outcome.skipped": "Пропущено",
  "power.lid.outcome.failed": "Сбой",
  "power.lid.outcome.undone": "Отменено",
  "power.lid.outcome.undo_failed": "Не удалось отменить (Phoenix повторит попытку)",
  "power.lid.reason.unsupported_platform": "Поддерживается только на Mac.",
  "power.lid.reason.helper_unavailable": "Привилегированный помощник не установлен.",
  "power.lid.reason.tool_missing": "Нужный инструмент не установлен.",
  "power.lid.reason.already_on": "Уже включено по другой причине.",
  "power.lid.reason.state_unknown":
    "Phoenix не может определить, идёт ли у вас встреча, поэтому ничего не сделал.",
  "power.lid.reason.protected_state": "Идёт встреча, запись или диктовка.",
  "power.lid.reason.docker_busy": "Работает контейнер.",
  "power.lid.reason.docker_unknown": "Состояние Docker неизвестно.",
  "power.lid.reason.process_list_unavailable": "Не удалось прочитать список запущенных программ.",
  "power.lid.reason.audio_unavailable": "Не удалось прочитать устройства вывода звука.",
  "power.lid.reason.no_targets": "Менять было нечего.",
  "power.lid.reason.nothing_to_do": "Менять было нечего.",
  "power.lid.reason.journal_unwritable":
    "Журнал восстановления не удалось записать, поэтому ничего не изменено.",
  "power.lid.reason.not_applied": "Ничего не изменено.",
  "power.lid.reason.apply_failed": "Изменение не удалось выполнить.",
  "power.lid.reason.undo_failed": "Изменение не удалось отменить.",
  "power.lid.reason.assertions_unknown":
    "Phoenix не может определить, идёт ли в приложении звонок, поэтому ничего не заморозил.",
  "power.lid.reason.holds_assertion":
    "Все чат-приложения используются (звонок или воспроизведение), поэтому ни одно не заморожено.",
  "power.lid.reason.output_changed":
    "Выход звука переключили, пока крышка была закрыта, поэтому Phoenix не тронул новый выход. Выход, который он отключил, остаётся отключённым, пока снова не станет выходом по умолчанию.",
  "power.lid.reason.retry_or_alert":
    "Замороженное приложение, похоже, перезапустили, поэтому Phoenix его не возобновил. Проверьте, что ваши чат-приложения работают нормально.",
  "power.lid.reason.not_ours":
    "Некоторые процессы не удалось возобновить: Phoenix не вправе ими управлять.",
  "power.lid.limit.output_identity_unknown":
    "Phoenix не может прочитать название выхода звука, поэтому не может понять, изменился ли он.",
  "power.lid.limit.brightness_tool_untrusted":
    "Файл утилиты яркости небезопасен (чужой владелец или запись для других), поэтому он не использовался.",
  "power.lid.reason.other": "Не получилось.",
  "power.lid.limit.brightness_tool_missing":
    "Бесплатный инструмент яркости не установлен, поэтому используется только сон дисплея, а яркость не меняется.",
  "power.lid.limit.keyboard_backlight_unsupported":
    "Подсветкой клавиатуры нельзя управлять без стороннего ПО.",
  "power.lid.limit.default_output_only":
    "Отключить звук можно только на текущем устройстве вывода по умолчанию.",
  "power.lid.applyNote":
    "Изменения вступят в силу, когда сеанс в следующий раз увидит закрытие крышки. Всё записывается в журнал до выполнения.",
  "power.lid.saved": "Сохранено.",
  "power.lid.glance.closed": "Крышка закрыта: действия при закрытии применены.",
  "power.lid.glance.failed":
    "Одно из действий при закрытии крышки не удалось отменить. Подробности в «Не засыпать».",
};
