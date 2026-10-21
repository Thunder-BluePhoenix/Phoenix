// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { power as enpower } from "../../en/power";

/** Machine-translated; unreviewed (see ../../README.md). */
export const power: Record<keyof typeof enpower, string> = {
  "power.awake.duration.minutes": "{minutes, plural, one {# minuto} other {# minutos}}",
  "power.awake.duration.hours": "{hours, plural, one {# hora} other {# horas}}",
  "power.awake.heading": "Mantener despierto",
  "power.awake.disabled": "Mantener despierto está desactivado. Activa la capacidad para usarlo.",
  "power.awake.waiting": "Esperando tu aprobación…",
  "power.awake.idle":
    "El equipo se suspende con normalidad. Inicia una sesión con tiempo para mantenerlo despierto.",
  "power.awake.start.heading": "Mantener despierto durante",
  "power.awake.custom.label": "Minutos",
  "power.awake.reason.label": "Motivo (opcional)",
  "power.awake.custom.start": "Iniciar",
  "power.awake.custom.invalid": "Introduce un número entero de minutos entre {min} y {max}.",
  "power.awake.agents.start": "Mientras trabajan los agentes",
  "power.awake.agents.help":
    "Se mantiene despierto mientras algún agente de código trabaja y termina unos minutos después de que acabe el último (usa los minutos de arriba).",
  "power.awake.agents.working":
    "{count, plural, one {# agente trabajando} other {# agentes trabajando}}",
  "power.awake.agents.grace":
    "Termina {minutes, plural, one {# minuto} other {# minutos}} después de que acabe el último agente.",
  "power.awake.running": "Manteniendo el equipo despierto",
  "power.awake.remaining": "Tiempo restante: {time}",
  "power.awake.endsAt": "Termina a las {time}",
  "power.awake.extend.label": "Añadir tiempo",
  "power.awake.extend.button": "+{duration}",
  "power.awake.end.hold": "Mantén pulsado para terminar",
  "power.awake.end.holding": "Sigue pulsando…",
  "power.awake.end.hint":
    "Mantén pulsado el botón 1,5 segundos (o mantén Espacio o Intro) para terminar la sesión.",
  "power.awake.battery":
    "La sesión también termina si la batería baja del {percent} % sin estar enchufado.",
  "power.awake.lid":
    "Cerrar la tapa sigue suspendiendo el equipo; mantenerlo despierto con la tapa cerrada requiere el modo de tapa cerrada.",
  "power.awake.indicator": "Despierto {time}",
  "power.recovery.heading": "Modo de tapa cerrada y recuperación",
  "power.recovery.waiting": "Esperando tu aprobación…",
  "power.recovery.unreadable": "No se pudo leer el estado de recuperación.",
  "power.recovery.journal.clean": "No hay nada pendiente de deshacer.",
  "power.recovery.journal.pending":
    "Phoenix no pudo restaurar {count, plural, one {# cambio del sistema} other {# cambios del sistema}}. Es posible que los ajustes de suspensión sigan modificados.",
  "power.recovery.journal.kind.disablesleep": "Sin suspensión con la tapa cerrada",
  "power.recovery.journal.kind.lowpowermode": "Modo de bajo consumo",
  "power.recovery.journal.kind.other": "Otro cambio",
  "power.recovery.journal.at": "desde las {time}",
  "power.recovery.journal.undo": "Deshacer ahora",
  "power.recovery.journal.untrusted":
    "{count, plural, one {Se ignoró # línea ilegible del registro} other {Se ignoraron # líneas ilegibles del registro}}; no son de fiar.",
  "power.recovery.journal.cannotQuit": "Phoenix se negará a cerrarse hasta que esto se deshaga.",
  "power.recovery.lid.open": "La tapa está abierta.",
  "power.recovery.lid.closed": "La tapa está cerrada.",
  "power.recovery.lid.unknown": "Se desconoce el estado de la tapa.",
  "power.recovery.lid.unsupported":
    "Este equipo no tiene sensor de tapa, así que el modo de tapa cerrada no está disponible.",
  "power.recovery.helper.installed": "Ayudante con privilegios instalado",
  "power.recovery.helper.missing":
    "Ayudante con privilegios no instalado (modo de tapa cerrada no disponible). Consulta docs/awake-helper.md.",
  "power.recovery.helper.unknown": "Se desconoce si el ayudante con privilegios está instalado.",
  "power.recovery.floors.off": "Los límites están desactivados",
  "power.recovery.floors.rule":
    "Modo de bajo consumo por debajo del {low} %, terminar la sesión por debajo del {end} %; calor: modo de bajo consumo en {heatLow}, terminar en {heatEnd}.",
  "power.recovery.floors.lowPowerActive": "El modo de bajo consumo está activado",
  "power.recovery.floors.battery.none": "Batería: ninguna",
  "power.recovery.floors.battery.unknown": "Batería: desconocida",
  "power.recovery.floors.battery.level": "Batería {percent} %",
  "power.recovery.floors.battery.unplugged": "Batería {percent} %, desenchufado",
  "power.recovery.floors.battery.plugged": "Batería {percent} %, enchufado",
  "power.recovery.floors.thermal.nominal": "normal",
  "power.recovery.floors.thermal.fair": "templado",
  "power.recovery.floors.thermal.serious": "caliente",
  "power.recovery.floors.thermal.critical": "crítico",
  "power.recovery.floors.thermal.level": "Calor: {level}",
  "power.recovery.floors.thermal.unsupported": "Calor: no se informa",
  "power.recovery.floors.thermal.unknown": "Calor: desconocido",
  "power.recovery.safety.warning":
    "No lleves nunca el equipo en una bolsa, funda u otro espacio cerrado mientras el modo de tapa cerrada esté activado: puede sobrecalentarse. Mantén las rejillas despejadas.",
  "power.recovery.safety.understand": "Lo entiendo",
  "power.recovery.safety.acknowledge": "Confirmar",
  "power.recovery.safety.done": "Has confirmado la advertencia de seguridad de la tapa cerrada.",
  "power.recovery.start": "Iniciar modo de tapa cerrada",
  "power.recovery.end": "Terminar modo de tapa cerrada",
  "power.recovery.engaged": "El modo de tapa cerrada está activado.",
  "power.recovery.engagedSince": "El modo de tapa cerrada está activado desde las {time}.",
  "power.recovery.needsSession":
    "Inicia antes una sesión de mantener despierto; el modo de tapa cerrada la necesita.",
  "power.recovery.journal.discard": "Descartar esta entrada",
  "power.recovery.lockBlocked":
    "Otro proceso de recuperación tiene el bloqueo, así que todavía no se deshizo nada. El cambio sigue pendiente.",
  "power.recovery.sleepUnjournaled":
    "La suspensión está desactivada en este equipo, pero Phoenix no tiene registro de haberla desactivado. Otra cosa la cambió.",
  "power.recovery.journalPath": "Diario: {path}",
  "power.continuity.heading": "Continuidad del agente",
  "power.continuity.intro":
    "Extras para ejecuciones largas de agentes. Cada uno está desactivado hasta que lo actives, y ninguno elige por ti una red, una terminal ni un programa.",
  "power.continuity.needsAwake":
    "Estos ajustes solo surten efecto mientras la capacidad Mantener activo esté habilitada.",
  "power.continuity.saved":
    "Guardado. Los cambios se aplicarán la próxima vez que se inicie Mantener activo.",
  "power.continuity.applyNote":
    "Los cambios se guardan en la capacidad Mantener activo y se aplican la próxima vez que se habilite.",
  "power.continuity.network.title": "Vigilancia de red",
  "power.continuity.network.help":
    "Comprueba cada pocos segundos que se pueda llegar a un equipo que indiques, y avisa a Phoenix cuando la red se cae y cuando vuelve. Solo se conecta; no envía ni lee nada.",
  "power.continuity.hosts.label": "Hosts que comprobar (nombre o nombre:puerto)",
  "power.continuity.hotspot.title": "Conmutación por error a punto de acceso",
  "power.continuity.hotspot.help":
    "Cuando el Wi-Fi se cae mientras se ejecuta una sesión de mantener activo, se une al punto de acceso del iPhone que indiques. Requiere la vigilancia de red de arriba y una lista de hosts. Funciona solo en macOS y no se ha probado en un Mac real.",
  "power.continuity.hotspot.ssid": "Nombre del punto de acceso (SSID)",
  "power.continuity.hotspot.disclosure":
    "Antes de activar esto: macOS puede unirse a una red que ya conoce sin ninguna contraseña en una línea de comandos, así que une primero tu punto de acceso una vez a mano. Solo si además permites la contraseña guardada que aparece abajo, Phoenix se la pasa a la herramienta networksetup de macOS, y entonces cualquier programa de este Mac puede leerla en esa línea de comandos durante los pocos segundos que dura la unión. No hay una forma integrada más segura de hacerlo sin preguntarte. Recházalo si esto no es aceptable.",
  "power.continuity.hotspot.allowPassword":
    "Lo acepto: usar la contraseña guardada del punto de acceso en la línea de comandos",
  "power.continuity.hotspot.passwordSaved":
    "Hay una contraseña del punto de acceso guardada en el llavero.",
  "power.continuity.hotspot.passwordMissing":
    "No hay ninguna contraseña del punto de acceso guardada. Guarda una como el secreto “hotspot_password” de la capacidad Mantener activo, o deja esta casilla desactivada y une el punto de acceso una vez a mano.",
  "power.continuity.hotspot.join": "Unirse al punto de acceso ahora",
  "power.continuity.hotspot.rejoin": "Volver a mi red anterior",
  "power.continuity.hotspot.confirmNote":
    "Unirse a una red cambia el Wi-Fi que usa este Mac. Phoenix te pide confirmación cada vez.",
  "power.continuity.hotspot.joined": "Conectado.",
  "power.continuity.nudge.title": "Empujar a los agentes",
  "power.continuity.nudge.help":
    "Si no hay red durante el tiempo indicado abajo, escribe “continue” en las terminales que enumeres. No se escribe nada durante una reunión o un dictado, y cada terminal lo recibe como máximo una vez por interrupción.",
  "power.continuity.nudge.after": "Segundos sin red antes de empujar (de 30 a 3600)",
  "power.continuity.nudge.panes": "Paneles de tmux (por ejemplo %12)",
  "power.continuity.nudge.sessions":
    "Sesiones de agente de Phoenix (ph- y 16 dígitos hexadecimales)",
  "power.continuity.nudge.sessionsNote":
    "Aún no disponible: Phoenix no tiene una forma segura de escribir en una sesión rastreada, por lo que las sesiones enumeradas se omiten y se informa de ello. Solo se empuja a los paneles de tmux.",
  "power.continuity.nudge.commands":
    "Programas que puede estar ejecutando un panel (por ejemplo claude)",
  "power.continuity.nudge.commandsNote":
    "Phoenix comprueba que el panel siga existiendo y que ejecute uno de estos programas antes de escribir. Con la lista vacía nunca se escribe nada.",
  "power.continuity.nudge.enter": "Pulsar también Enter",
  "power.continuity.nudge.enterHelp":
    "Desactivado por defecto. Sin esto, “continue” se escribe pero no se envía, así que pulsas Enter tú mismo.",
  "power.continuity.throttle.title": "Comprobación de limitación del navegador",
  "power.continuity.throttle.help":
    "Chrome, Arc, Comet, Edge y Brave ralentizan las pestañas en segundo plano, lo que puede bloquear una página web de un agente. Aquí se enumeran los que se ejecutan así. Nunca modifica un navegador a menos que elijas Reiniciar y lo confirmes.",
  "power.continuity.throttle.unsupported": "La comprobación de navegadores solo funciona en macOS.",
  "power.continuity.throttle.notRunning": "no se está ejecutando",
  "power.continuity.throttle.throttled": "en ejecución con limitación en segundo plano",
  "power.continuity.throttle.fine": "en ejecución sin limitación",
  "power.continuity.throttle.relaunch": "Reiniciar {name} sin limitación",
  "power.continuity.throttle.confirm":
    "¿Reiniciar {name} sin limitación en segundo plano? {name} se cerrará y se volverá a abrir, sus pestañas se recargarán y se podría perder lo que no esté guardado en una página. Esto se rechaza durante una reunión o un dictado.",
  "power.continuity.throttle.confirmYes": "Cerrar y reiniciar",
  "power.continuity.throttle.relaunched": "{name} se reinició.",
  "power.continuity.outage.title": "Última interrupción de red",
  "power.continuity.outage.none": "Aún no se ha detectado ninguna interrupción de red.",
  "power.continuity.outage.down": "La red está caída desde {time}.",
  "power.continuity.outage.ended": "La red estuvo caída desde {from} hasta {to}.",
  "power.continuity.outage.nudged":
    "{count, plural, one {# terminal empujada} other {# terminales empujadas}}",
  "power.continuity.outage.hotspot.joined": "Conectado al punto de acceso",
  "power.continuity.outage.hotspot.failed": "Falló la conexión al punto de acceso",
  "power.continuity.outage.hotspot.skipped":
    "No se intentó el punto de acceso (desactivado, o sin sesión en ejecución)",
  "power.continuity.outage.hotspot.notTried": "Aún no se ha intentado el punto de acceso",
  "power.continuity.list.empty": "No hay nada en la lista.",
  "power.continuity.list.remove": "Quitar {item}",
  "power.continuity.invalid.host":
    "Usa un nombre de host o una dirección, opcionalmente con :puerto (de 1 a 65535).",
  "power.continuity.invalid.pane":
    "Usa un id de panel de tmux como %12: un signo de porcentaje y hasta seis dígitos.",
  "power.continuity.invalid.session": "Usa un id de sesión como ph-0123456789abcdef.",
  "power.continuity.invalid.command":
    "Usa un nombre de programa como claude: solo letras, dígitos y . _ + -",
  "power.continuity.invalid.ssid":
    "Usa de 1 a 32 bytes de texto visible que no empiece por un guion.",
  "power.continuity.invalid.seconds": "Introduce un número entero de segundos de {min} a {max}.",
  "power.continuity.problem.duplicate": "Esa entrada ya está en la lista.",
  "power.continuity.problem.full": "La lista está llena (máximo {max} entradas).",
  "power.continuity.reason.unsupported_platform": "Esto solo funciona en macOS.",
  "power.continuity.reason.no_wifi_device":
    "Phoenix no pudo encontrar el dispositivo Wi-Fi de este Mac.",
  "power.continuity.reason.no_hotspot_configured":
    "No hay ningún punto de acceso ni red anterior utilizable a la que unirse.",
  "power.continuity.reason.bad_password":
    "No se puede usar la contraseña guardada. Compruébala en el llavero.",
  "power.continuity.reason.join_failed": "macOS no pudo unirse a la red.",
  "power.continuity.reason.unknown_browser": "Ese navegador no es uno de los que gestiona Phoenix.",
  "power.continuity.reason.protected": "Ahora no: hay una reunión o un dictado en curso.",
  "power.continuity.reason.not_running": "Ese navegador no se está ejecutando.",
  "power.continuity.reason.already_unthrottled":
    "Ese navegador ya se ejecuta sin limitación en segundo plano.",
  "power.continuity.reason.unavailable": "Esto no está disponible en este momento.",
  "power.continuity.reason.quit_failed": "El navegador no aceptó la petición de cerrarse.",
  "power.continuity.reason.still_running":
    "El navegador sigue abierto, por lo que no se volvió a abrir. Ciérralo tú mismo y vuelve a intentarlo.",
  "power.continuity.reason.open_failed": "El navegador se cerró pero no se pudo volver a abrir.",
  "power.continuity.reason.other": "Eso no funcionó.",
  "power.lid.heading": "Acciones al cerrar la tapa",
  "power.lid.intro":
    "Mientras una sesión de mantener activo está en marcha y cierras la tapa, Phoenix puede ahorrar energía y silenciar este equipo. Todo se deshace al abrir la tapa, al terminar la sesión y cuando Phoenix se inicia de nuevo tras un fallo.",
  "power.lid.needsAwake":
    "Estas acciones solo se ejecutan mientras la capacidad Mantener activo está habilitada.",
  "power.lid.master.title": "Ejecutar acciones al cerrar la tapa",
  "power.lid.master.help":
    "El interruptor principal. Desactivado, no se ejecuta nada de lo siguiente.",
  "power.lid.display.title": "Apagar la pantalla",
  "power.lid.display.help":
    "Pone la pantalla en reposo. El brillo se guarda y se restaura si la herramienta gratuita de brillo está instalada.",
  "power.lid.freeze.title": "Congelar apps de chat",
  "power.lid.freeze.help":
    "Pausa las apps de chat elegidas para que no consuman energía y luego las reanuda. Nunca mientras estás en una reunión, grabando o dictando, ni para terminales, editores o agentes de programación en ejecución.",
  "power.lid.freeze.apps": "Apps que congelar",
  "power.lid.mute.title": "Silenciar el sonido",
  "power.lid.mute.help":
    "Silencia la salida de sonido y la restaura tal como estaba, incluso si cambiaste de salida entretanto.",
  "power.lid.lowPower.title": "Modo de bajo consumo",
  "power.lid.lowPower.help":
    "Activa el modo de bajo consumo. Necesita el asistente con privilegios opcional; sin él se omite.",
  "power.lid.docker.title": "Congelar Docker Desktop",
  "power.lid.docker.help":
    "Pausa Docker Desktop mientras no se ejecuta ningún contenedor. Nunca si hay un contenedor en marcha o se desconoce el estado de Docker.",
  "power.lid.nap.title": "Evitar App Nap en apps de agentes",
  "power.lid.nap.help":
    "Impide que macOS ralentice las apps que indiques. Su ajuste anterior se guarda y se restaura exactamente.",
  "power.lid.nap.apps": "Apps (bundle ids, por ejemplo com.example.App)",
  "power.lid.protected.title": "Nunca se congelan",
  "power.lid.protected.help":
    "Estas siempre se dejan en paz. Puedes añadir a la lista, pero las protecciones integradas no se pueden quitar.",
  "power.lid.protected.builtIn": "Integradas",
  "power.lid.protected.extra": "Añadir un nombre de programa o app",
  "power.lid.list.empty": "No se ha añadido nada.",
  "power.lid.list.remove": "Quitar {item}",
  "power.lid.list.duplicate": "Ya está en la lista.",
  "power.lid.list.full": "La lista está llena ({max} entradas).",
  "power.lid.invalid.bundle":
    "Usa un bundle id como com.example.App: letras, dígitos y guiones, con al menos un punto.",
  "power.lid.invalid.name":
    "Usa un nombre sencillo de programa o app: letras, dígitos, espacios y . _ + -",
  "power.lid.unsupported": "No disponible aquí: {reason}",
  "power.lid.gapNote":
    "Algunas funcionan solo en parte en este equipo. Consulta README-lid.md para saber qué se admite y qué no.",
  "power.lid.last.title": "Último evento de la tapa",
  "power.lid.last.closed": "La tapa se cerró a las {time}.",
  "power.lid.last.opened": "La tapa se abrió a las {time}.",
  "power.lid.last.none": "Todavía no ha pasado nada.",
  "power.lid.last.mismatched":
    "{count, plural, other {# procesos no se reanudaron porque ya no coincidían con lo que Phoenix congeló.}}",
  "power.lid.last.stillClosed": "La tapa está cerrada y las acciones anteriores están aplicadas.",
  "power.lid.outcome.applied": "Hecho",
  "power.lid.outcome.skipped": "Omitido",
  "power.lid.outcome.failed": "Falló",
  "power.lid.outcome.undone": "Deshecho",
  "power.lid.outcome.undo_failed": "No se pudo deshacer (Phoenix lo intentará de nuevo)",
  "power.lid.reason.unsupported_platform": "Solo es compatible con Mac.",
  "power.lid.reason.helper_unavailable": "El asistente con privilegios no está instalado.",
  "power.lid.reason.tool_missing": "Falta una herramienta necesaria.",
  "power.lid.reason.already_on": "Ya estaba activado por otro motivo.",
  "power.lid.reason.state_unknown":
    "Phoenix no puede saber si estás en una reunión, así que no hizo nada.",
  "power.lid.reason.protected_state": "Hay una reunión, grabación o dictado en curso.",
  "power.lid.reason.docker_busy": "Hay un contenedor en ejecución.",
  "power.lid.reason.docker_unknown": "Se desconoce el estado de Docker.",
  "power.lid.reason.process_list_unavailable":
    "No se pudo leer la lista de programas en ejecución.",
  "power.lid.reason.audio_unavailable": "No se pudieron leer las salidas de sonido.",
  "power.lid.reason.no_targets": "No había nada que cambiar.",
  "power.lid.reason.nothing_to_do": "No había nada que cambiar.",
  "power.lid.reason.journal_unwritable":
    "No se pudo escribir el diario de recuperación, así que no se cambió nada.",
  "power.lid.reason.not_applied": "No se cambió nada.",
  "power.lid.reason.apply_failed": "No se pudo hacer el cambio.",
  "power.lid.reason.undo_failed": "No se pudo deshacer el cambio.",
  "power.lid.reason.assertions_unknown":
    "Phoenix no puede saber si una app está en una llamada, así que no congeló nada.",
  "power.lid.reason.holds_assertion":
    "Todas las apps de chat están en uso (una llamada o reproducción), así que no se congeló ninguna.",
  "power.lid.reason.output_changed":
    "La salida de sonido cambió mientras la tapa estaba cerrada, así que Phoenix no tocó la nueva salida. La salida que silenció sigue silenciada hasta que vuelva a ser la predeterminada.",
  "power.lid.reason.retry_or_alert":
    "Una app congelada parece haberse reiniciado, así que Phoenix no la reanudó. Comprueba que tus apps de chat funcionan con normalidad.",
  "power.lid.reason.not_ours":
    "Algunos procesos no se pudieron reanudar porque Phoenix no puede controlarlos.",
  "power.lid.limit.output_identity_unknown":
    "Phoenix no puede leer el nombre de la salida de sonido, así que no puede saber si cambió.",
  "power.lid.limit.brightness_tool_untrusted":
    "El archivo de la herramienta de brillo no es seguro (propietario incorrecto o editable por otros), así que no se usó.",
  "power.lid.reason.other": "Eso no funcionó.",
  "power.lid.limit.brightness_tool_missing":
    "La herramienta gratuita de brillo no está instalada, así que solo se usa el reposo de la pantalla y no se cambia el brillo.",
  "power.lid.limit.keyboard_backlight_unsupported":
    "La luz del teclado no se puede controlar sin software de terceros.",
  "power.lid.limit.default_output_only": "Solo se puede silenciar la salida predeterminada actual.",
  "power.lid.applyNote":
    "Los cambios surten efecto la próxima vez que una sesión vea cerrarse la tapa. Todo se anota en el diario antes de hacerse.",
  "power.lid.saved": "Guardado.",
  "power.lid.glance.closed":
    "La tapa está cerrada: las acciones de cierre de tapa están aplicadas.",
  "power.lid.glance.failed":
    "No se pudo deshacer una acción de cierre de tapa. Abre Mantener activo para ver los detalles.",
};
