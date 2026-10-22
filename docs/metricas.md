# Métricas

La línea **hoy** de la cabecera del tablero y la página **Resumen** (`/resumen`: rangos, gráfico por día, tabla
por proyecto y exportación a CSV) muestran:

| Métrica | Qué es |
|---|---|
| Tu tiempo | Minutos que trabajaste en un proyecto (VS Code, pedidos a Claude y los programas que elijas). Opcional |
| Claude trabajando | Horas con al menos una sesión trabajando. "Suma" cuenta cada sesión por separado |
| Algo te esperaba | Horas con al menos una sesión esperándote (turno terminado, o aprobación o pregunta pendiente) |
| Respuesta mediana | Del fin de un turno a tu siguiente pedido, si volviste dentro de T2 (`minutosSinVer`, 60 min): más tarde la sesión ya estaba en pausa y volver es retomarla, no responder |
| Pedidos, tokens | Pedidos tuyos y tokens de entrada, caché y salida, subagentes incluidos |
| Aprobaciones | Veces que una sesión quedó esperando, y tiempo bloqueado |

Todo se calcula al consultar, a partir de señales guardadas en bruto (por minuto o con su hora
exacta): cambiar un umbral recalcula también la historia.

**Por día y por hora.** En un rango de varios días, el gráfico y el detalle van por día. En un solo
día ("Hoy", "Ayer") van por hora. La API devuelve siempre las dos agrupaciones (`dias` y `horas`),
así que una estadística de horario (en qué horas se trabaja más) sale de los mismos datos, también
hacia atrás.

## Varias PCs

Con varias PCs, el Resumen junta las métricas de todas, y arriba hay una casilla por máquina para
elegir cuáles ver. La elección se recuerda en ese navegador: se guardan las máquinas ocultas, así que
una máquina nueva aparece incluida. La línea "hoy" del tablero muestra siempre todas.

Al combinar:

- tu tiempo, el de Claude sumando sesiones, las esperas, los pedidos, los tokens y las aprobaciones
  se suman, por proyecto, día y hora;
- la respuesta mediana se calcula sobre las respuestas de todas las PCs juntas, no promediando
  medianas;
- "Claude trabajando" y "algo te esperaba" son horas con al menos una sesión, dentro de cada PC:
  entre PCs se suman, así que una hora en que trabajaron las dos cuenta dos veces;
- un proyecto que existe en varias PCs (misma carpeta de nombre) queda en una sola fila, con un punto
  del color de cada máquina en que se trabajó. El CSV trae esa lista en la columna "Máquinas".

El Resumen muestra primero los datos de esta PC, que están al instante, y suma los de las otras
cuando llegan ("Cargando los datos de…"). Si una PC no responde, lo dice y muestra solo las que
respondieron; si ya se sabía caída por el tablero, no la espera.

## Tu tiempo

Solo con `"registrarActividad": true` en `config.json`. Es **tiempo en proyectos**, no tiempo frente
a la PC. Cada 15 segundos el agente mira cuánto hace que no tocás el teclado ni el mouse y qué
programa tenés al frente. Por cada minuto:

1. Si no tocaste teclado ni mouse en más de `minutosInactividad` (5), el minuto no cuenta.
2. Si al frente había una ventana de VS Code con una carpeta abierta, el minuto es de ese proyecto.
3. Si en ese minuto le mandaste un pedido a Claude, es del proyecto del pedido (así cuenta también
   el trabajo en la terminal).
4. Cualquier otro programa **no cuenta**, salvo los que pongas en `programasQueSuman`, por ejemplo
   `["firefox", "windowsterminal"]` (el nombre del proceso, sin `.exe`, como figura en el
   Administrador de tareas).
5. Un programa de esa lista suma al **último proyecto** en que estuviste, si fue hace menos de
   `minutosArrastre` (10). Ese es el **arrastre**: buscar algo en el navegador a mitad de una tarea
   es parte de la tarea, pero si pasaron más de 10 minutos desde que dejaste VS Code ya no se puede
   saber de qué proyecto era, y no suma.
6. Cada minuto va a un solo proyecto, aunque haya varias sesiones trabajando: tus horas nunca
   suman más que el reloj.

No captura reuniones ni trabajo lejos de la PC. El proyecto sale del título de la ventana de VS
Code (`… - carpeta - Visual Studio Code`, el formato por defecto); del título se guarda solo ese
nombre, nunca el resto, que puede incluir nombres de archivos.

## Claude trabajando

Un **turno** va de un pedido tuyo (o de una notificación de una tarea de fondo que lo reanuda) a la
última actividad de Claude antes del siguiente pedido. Del turno se descuenta el tiempo en que
Claude en realidad te esperaba a vos:

- **Desde que corre el agente**, exacto: la bitácora anota cada vez que una sesión pasa a
  "esperando" y cuándo sale.
- **Para la historia anterior**, se infiere de los huecos de más de 2 min dentro del turno:
  - con una pregunta pendiente (`AskUserQuestion`, `ExitPlanMode`): el hueco entero es espera tuya;
  - con otra herramienta pendiente: lo que pase de 15 min se toma como una aprobación (un comando
    rara vez tarda más);
  - con un subagente pendiente: no se descuenta nada, porque puede estar trabajando de verdad.

Sin este descuento, una pregunta contestada a la mañana siguiente sumaba toda la noche como trabajo.

## Algo te esperaba

Después de cada turno, la sesión te espera hasta tu siguiente pedido, con un tope de T2 (`minutosSinVer`):
pasado eso, la sesión no te espera, quedó abandonada. Se suman también las esperas dentro del turno
(aprobaciones y preguntas), con el mismo tope.

"Algo te esperaba" es la unión: horas en que había al menos una sesión esperándote. "Suma" cuenta
cada sesión por separado. Con varias pestañas en paralelo la suma puede pasar las 24 h en un día.

## Los datos

Todo en `datos\`, solo en tu PC:

| Archivo | Qué guarda | Desde cuándo |
|---|---|---|
| `historial.json` | Turnos, huecos y tokens de cada transcript, sin contenido | Lo que haya en disco: Claude Code borra lo de más de `cleanupPeriodDays` (30 días por defecto). Lo indexado se conserva aunque se borre el transcript |
| `estados\AAAA-MM-DD.jsonl` | Cambios de estado de cada sesión | Desde que corre el agente |
| `actividad\AAAA-MM-DD.jsonl` | Por minuto: segundos sin teclado ni mouse y proyecto o programa al frente | Desde que se activa `registrarActividad` |

La primera indexación de los transcripts tarda unos segundos (unos 5 s para 3 GB); después solo se
lee lo nuevo.

## El CSV

Separado por `;`, con coma decimal y las horas en decimal, para abrirlo directo en una planilla en
castellano.
