// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ports as enports } from "../../en/ports";

/** Machine-translated; unreviewed (see ../../README.md). */
export const ports: Record<keyof typeof enports, string> = {
  "ports.title": "Radar de puertos",
  "ports.intro":
    "Muestra qué programas escuchan en puertos de red en este ordenador, en qué proyecto se ejecutan y cuánto tiempo llevan en marcha. El análisis solo lee; no se cambia nada a menos que detengas un programa y lo apruebes.",
  "ports.disabled":
    "El radar de puertos está desactivado. Activa la capacidad Radar de puertos y procesos para usarlo.",
  "ports.scan": "Analizar ahora",
  "ports.scanning": "Analizando…",
  "ports.notScanned": "Todavía no se ha analizado nada. Elige Analizar ahora.",
  "ports.empty": "Ningún programa escucha en un puerto.",
  "ports.loadError": "No se pudieron leer los puertos.",
  "ports.scannedAt": "Analizado a las {time}",
  "ports.count": "{count, plural, one {# puerto en escucha} other {# puertos en escucha}}",
  "ports.table.caption": "Puertos en escucha",
  "ports.col.port": "Puerto",
  "ports.col.process": "Programa",
  "ports.col.project": "Proyecto",
  "ports.col.age": "En marcha desde hace",
  "ports.col.notes": "Notas",
  "ports.col.actions": "Acciones",
  "ports.pid": "proceso {pid}",
  "ports.age.unknown": "desconocido",
  "ports.age.minutes": "{count, plural, one {# minuto} other {# minutos}}",
  "ports.age.hours": "{count, plural, one {# hora} other {# horas}}",
  "ports.age.days": "{count, plural, one {# día} other {# días}}",
  "ports.project.none": "sin proyecto",
  "ports.exposure.all": "accesible desde la red",
  "ports.exposure.loopback": "solo este ordenador",
  "ports.exposure.interface": "una dirección de red",
  "ports.flag.forgotten": "Quizá olvidado",
  "ports.flag.heavy": "Pesado",
  "ports.flag.core": "El propio Phoenix",
  "ports.usage": "CPU {percent} %, memoria {mb} MB",
  "ports.help.forgotten":
    "Quizá olvidado: se ejecuta en una carpeta de proyecto y lleva en marcha más de {hours, plural, one {# hora} other {# horas}}. Phoenix no puede saber si alguien aún lo usa.",
  "ports.help.heavy":
    "Pesado: CPU de {cpu} % o más, o memoria de {mb} MB o más, según ps (un promedio, no una lectura en vivo).",
  "ports.open": "Abrir en el navegador",
  "ports.open.label": "Abrir {name} en el puerto {port} en tu navegador predeterminado",
  "ports.openNote":
    "Los enlaces abren http://127.0.0.1 en tu navegador predeterminado. Phoenix todavía no tiene un navegador propio.",
  "ports.stop": "Detener…",
  "ports.stop.label": "Detener {name} en el puerto {port}",
  "ports.refusal.self": "Este es el propio Phoenix, que nunca se detiene a sí mismo.",
  "ports.refusal.other_user": "Pertenece a otro usuario.",
  "ports.refusal.system": "Es un proceso del sistema.",
  "ports.refusal.not_dev_tool": "No es una herramienta de desarrollo que Phoenix pueda detener.",
  "ports.refusal.unsupported": "Detener no está disponible en este sistema.",
  "ports.refusal.unknown": "Phoenix no pudo comprobar este proceso, así que no lo detendrá.",
  "ports.confirm.title": "¿Detener {name} en el puerto {port}?",
  "ports.confirm.body":
    "Después de que lo apruebes, Phoenix pedirá a {name} (proceso {pid}) que se cierre. El programa puede perder trabajo sin guardar.",
  "ports.confirm.go": "Pedir que se detenga",
  "ports.confirm.cancel": "Cancelar",
  "ports.stop.waiting": "Esperando tu aprobación en Aprobaciones…",
  "ports.stop.exited": "{name} se detuvo.",
  "ports.stop.stillRunning":
    "Se pidió a {name} que se cerrara y sigue en marcha. Forzar la detención lo termina de inmediato, no se puede deshacer y puede perder datos.",
  "ports.force": "Forzar detención…",
  "ports.force.label": "Forzar la detención de {name} en el puerto {port}",
  "ports.force.hint":
    "Phoenix rechaza forzar la detención durante los primeros segundos tras la petición de cerrar.",
  "ports.force.confirm": "Forzar detención",
  "ports.restart": "Reiniciar…",
  "ports.restart.label": "Reiniciar {name} en el puerto {port}",
  "ports.restart.title": "¿Reiniciar {name} en el puerto {port}?",
  "ports.restart.body":
    "Tras tu aprobación, Phoenix pide a {name} (proceso {pid}) que se cierre y, solo si termina, inicia la receta de reinicio que configuraste, exactamente como se muestra abajo. El programa puede perder trabajo sin guardar. Si el inicio falla, el programa queda detenido.",
  "ports.restart.recipe": "Receta",
  "ports.restart.argv": "Programa y argumentos",
  "ports.restart.cwd": "Carpeta",
  "ports.restart.go": "Pedir reinicio",
  "ports.restart.started":
    "{name} se detuvo y se inició la receta {recipe} (proceso {pid}). Phoenix aún no puede saber si vuelve a escuchar; analiza de nuevo.",
  "ports.restart.note":
    "Reiniciar solo se ofrece para un programa en un puerto para el que escribiste una receta de reinicio en los ajustes de esta capacidad. Phoenix nunca reconstruye un comando a partir de un programa en ejecución.",
  "ports.watch.label": "Actualizar automáticamente mientras Phoenix está abierto",
  "ports.watch.help":
    "Desactivado por defecto. Si se activa, Phoenix lee la lista de puertos cada 15 segundos, solo mientras haya una ventana de Phoenix abierta.",
  "ports.noProcessTable":
    "No se pudo leer la lista de procesos, así que no se muestran las duraciones ni se puede detener nada.",
  "ports.parseWarnings":
    "Algunas líneas de la lista de procesos o puertos del sistema no se entendieron y se omitieron (el nombre de un programa puede contener saltos de línea). Pueden faltar programas o no poder detenerse aquí; al detener uno se vuelve a comprobar todo.",
  "ports.windows.note":
    "En Windows el radar solo muestra puertos y nombres de programas; no hay duraciones, proyectos ni detención.",
};
