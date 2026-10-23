# Cómo funciona

Todo lo de esta página se verificó con Claude Code 2.1.283 y 2.1.292 (extensión de VS Code) y 2.1.306
(terminal) en Windows 11.
Son formatos internos, sin documentar: una actualización puede cambiarlos.

## Las piezas

```
 VS Code + Claude Code ──escribe──▶ ~/.claude/sessions/<pid>.json    (estado vivo)
                                    ~/.claude/projects/…/<id>.jsonl  (transcripts)
                                              │ lee
                                              ▼
 navegador ◀──localhost:4590──  agente (Node, sin dependencias)  ──▶ datos/ (métricas, fijadas)
```

El **agente** corre en cada PC, arranca solo al iniciar sesión y sirve el tablero en `localhost`.
No modifica nada de Claude Code.

## De dónde sale el estado

### El registro de sesiones: `~/.claude/sessions/<pid>.json`

Claude Code mantiene un archivo por sesión abierta y lo borra al cerrarla:

```json
{
  "pid": 22236,
  "sessionId": "99896147-…",
  "cwd": "d:\\desarrollo\\tienda-online",
  "entrypoint": "claude-vscode",
  "kind": "interactive",
  "status": "waiting",
  "waitingFor": "permission prompt",
  "statusUpdatedAt": 1792511953951,
  "procStart": "134369802944787858",
  "version": "2.1.283"
}
```

- `status`: `busy` (trabajando), `idle` (parada) o `waiting` (te espera).
- `waitingFor`, cuando espera: `permission prompt` (una aprobación), `input needed` (una pregunta),
  `dialog open`, `sandbox request`, entre otros.
- `statusUpdatedAt`: cuándo cambió, que es el "hace cuánto" del tablero.

Si Claude se cuelga, su archivo queda huérfano, y tras reiniciar Windows el pid puede pertenecer a
otro proceso. Por eso, además de verificar que el pid esté vivo, el agente compara la hora de inicio
real del proceso con `procStart` (un FILETIME).

**Pestañas sin pedidos.** Al cerrar una pestaña vacía, la extensión deja su proceso de reserva para
que la próxima abra rápido: sigue en el registro aunque no haya pestaña. El tablero no muestra
sesiones que nunca recibieron un pedido.

### El transcript: `~/.claude/projects/<carpeta>/<sessionId>.jsonl`

`<carpeta>` es el `cwd` con todo lo no alfanumérico reemplazado por `-` (`d:\desarrollo\tienda-online` →
`d--desarrollo-tienda-online`). La letra de unidad puede estar en mayúscula o minúscula, así que el agente
lo busca por `sessionId`. Pueden pesar decenas de MB: se lee solo la cola.

De ahí salen:

- **El título**: `custom-title` (puesto a mano), si no `ai-title` (generado), si no el primer pedido.
- **El último mensaje de Claude**: el último registro `assistant` con texto.
- **Los pedidos tuyos**: registros `user` con `turnOrigin: "human"`; en sesiones viejas, con
  `promptSource: "sdk"`. VS Code agrega adelante bloques `<ide_selection>` y `<ide_opened_file>` que
  no son parte del pedido.
- **El contexto**: la entrada del último mensaje de Claude (`input_tokens`, más las de caché escrita
  y leída), que es lo que ocupa la conversación en ese momento. No cuentan los de subagentes
  (`isSidechain`) ni los mensajes `<synthetic>`; después de un `compact_boundary`, vale su
  `postTokens`. La ventana sale del modelo: 1 M en los actuales (Fable, Opus 4.6 en adelante,
  Sonnet 5 y 4.6, o un modelo con `[1m]`), 200 K en Haiku y los anteriores. El transcript no la trae,
  así que un modelo desconocido que ya pasó los 200 K se toma como de 1 M.

**Una aprobación pendiente no deja rastro en el transcript**: queda un `tool_use` sin su
`tool_result`, igual que un comando largo en curso. Por eso el estado sale del registro.

### Las cinco reglas

| Estado | Regla |
|---|---|
| trabajando | `status = busy` |
| esperando | `status = waiting` |
| terminó | `idle` después de un turno, hasta T min tras el click en la tarjeta o T2 min tras terminar |
| inactiva | `idle` y ya vista o vencida |
| desconocido | un `status` que el agente no conoce: probablemente cambió el formato |

Al recargar VS Code, las sesiones arrancan en `idle` con un `statusUpdatedAt` nuevo. Para que no
aparezcan todas como recién terminadas, el momento en que terminó un turno sale de la última marca
de tiempo del transcript.

### ¿Y los hooks?

Se probaron todos en la extensión: `Stop`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`PermissionRequest` y `Notification` se disparan (incluso `Notification` con
`notification_type: "permission_prompt"`). No hacen falta: el registro da lo mismo sin tocar la
configuración de nadie.

### Sesiones fuera de VS Code

Las sesiones de la terminal (`claude` en PowerShell, Windows Terminal o Git Bash) se registran
igual, con `entrypoint: "cli"`, y usan el mismo formato de transcript: se ven con su estado, título y
métricas. La interfaz de terminal usa además un estado `shell`, que el tablero trata como sesión
parada. Las de la app de escritorio de Claude (`claude-desktop`) se ven pero no se pueden traer al
frente.

### El modo de permisos

Cada pedido tuyo queda en el transcript con su `permissionMode`: `default` (pide permiso),
`acceptEdits`, `plan`, `auto`, `bypassPermissions`. El tablero muestra el del último pedido. Si lo
cambiás con Shift+Tab sin escribir nada, el transcript no se entera hasta el pedido siguiente.

## Traer una ventana al frente

1. **Activar la ventana.** Windows no deja que un programa en segundo plano le quite el foco a la
   aplicación que estás usando: en ese caso solo sube la ventana o hace titilar su botón. Por eso
   `code <carpeta>` a veces dejaba VS Code detrás de otra ventana. El agente busca la ventana por su
   título (`… - <carpeta> - Visual Studio Code`), envía un evento de mouse vacío (el mismo recurso
   que usa PowerToys) y la activa.
2. **Abrir la pestaña.** Con la ventana activa, abre
   `vscode://anthropic.claude-code/open?session=<id>`. La extensión revela la pestaña de esa sesión
   si ya está abierta. VS Code le pasa el URI a la última ventana activa, así que el agente solo lo
   manda si el paso 1 funcionó; si no, el URI podría caer en otra ventana y abrir ahí una copia.
   La primera vez, VS Code pide permiso: *"Allow 'Claude Code' extension to open this URI?"*, con
   la casilla *"Do not ask me again for this extension"*. Es una protección de VS Code para los
   enlaces que llegan desde afuera; con la casilla marcada no vuelve a preguntar.
3. **Si no encuentra la ventana** (por ejemplo, con un `window.title` personalizado), usa
   `code <carpeta>`, que enfoca la ventana existente sin abrir otra.

**Sesiones de terminal.** El agente se adjunta un instante a la consola del proceso `claude` y le
pide a Windows su ventana. En la consola clásica es la ventana visible. En Windows Terminal es una
ventana oculta cuya dueña es la ventana de Windows Terminal que tiene esa pestaña, así que distingue
dos ventanas de Windows Terminal aunque tengan el mismo título. Git Bash (mintty) no usa una consola
de Windows: ahí busca la ventana de mintty por el título que le pone Claude Code (si hay varias y
no puede distinguirlas, avisa). En la terminal integrada de VS Code, activa la ventana de esa
carpeta. Trae la ventana, no la pestaña: dentro de una terminal no hay forma de elegirla.

## Otros sistemas

El registro y los transcripts son iguales en macOS y Linux. Lo que depende de Windows está aislado
en `src/plataforma/`, detrás de cuatro funciones; `otros.js` es el punto de partida, con lo que
falta marcado:

| Función | Windows | Para portar |
|---|---|---|
| `horaInicioProceso(pid)` | `Get-Process` | `ps -o lstart= -p <pid>` |
| `iniciarMuestreoActividad` | `GetLastInputInfo` + ventana al frente | macOS: `ioreg` + `osascript`; Linux/X11: `xprintidle` + `xdotool` |
| `activarVentana(carpeta)` | Win32 (`ventanas.ps1`) | macOS: `osascript`; Linux/X11: `wmctrl` |
| `code(args)` | `Code.exe` + `cli.js` | `code` en el PATH (ya funciona) |
