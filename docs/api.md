# API del agente

## Entre PCs

Desde la red solo se puede leer, y solo desde loopback, una red privada o Tailscale.

- `GET /api/salud` → `{ ok: true }`
- `GET /api/metricas?desde=…&hasta=…&respuestas=1`, con el token → las métricas de esa PC sola,
  con los tiempos de respuesta crudos (`respuestas`) para combinarlas. Nunca reenvía a otras PCs.
- `GET /api/estado`, con `Authorization: Bearer <token>` → `{ maquina, generado, sesiones: [...] }`.
  Cada sesión trae `id`, `carpeta`, `proyecto`, `estado`, `motivo`, `desde` (ms), `titulo`,
  `ultimoMensaje`, `pid`, `origen` (`vscode`, `terminal`, `escritorio`), `anfitrion` (para una
  terminal: `WindowsTerminal`, `mintty`, `conhost`, `Code`), `enfocable`, `modo` (el
  `permissionMode` de tu último pedido), `linea` (la última hora, 60 letras, una por minuto: `r`
  trabajando, `w` esperando, `d` terminó, `i` inactiva) y `version` (de Claude Code).

## Solo desde esta PC

Se atienden solo desde `127.0.0.1` con `Host: localhost`, y las rutas `/api/` además con el header
`X-Tablero: 1`.

- `GET /`: el tablero. `GET /resumen`: las métricas.
- `GET /api/tablero` → `{ generado, pagina, horasInactivasVisibles, horasInactivasPlegadas,
  versionesProbadas, fijadas, maquinas: [{ maquina, local, ok, ultimoOk, error, sesiones }] }`. La
  primera es esta PC; las demás, las de `peers`, con lo último que se supo de cada una (`ok: false`
  si dejó de responder, `ultimoOk` = cuándo respondió por última vez). Sus `desde` vienen corregidos
  por la diferencia de reloj entre las PCs.
- `POST /api/enfocar` `{ sessionId }` → trae al frente la ventana y la pestaña de esa sesión (ver
  [cómo funciona](como-funciona.md#traer-una-ventana-al-frente)) y marca como vistas todas las
  sesiones de esa carpeta. Responde `{ ok, resultado }`, con `resultado` `pestaña`, `ventana`,
  `sin-foco` (Windows no dejó activarla), `no-encontrada` o `ambigua` (varias ventanas de Git Bash).
- `POST /api/fijadas` `{ fijadas: [{ maquina, carpeta, proyecto }] }` → reemplaza la lista de
  tarjetas fijadas, en orden.
- `GET /api/metricas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&ocultar=a,b` (por defecto, hoy y todas las
  máquinas) → `{ totales, proyectos, dias, horas, fuentes, indexado, maquinas }`, combinando esta PC y
  las de `peers` menos las de `ocultar`. `maquinas` dice de cada una si está `incluida` y si respondió
  (`ok`, `error`); cada proyecto trae `maquinas` con las PCs donde se trabajó. `horas` trae cada hora del rango con `inicio` (ms),
  `dia` y `hora` (0 a 23, hora local). Duraciones en ms; tokens como `[entrada, caché, salida]`.
- `GET /resumen?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` abre el resumen en ese rango (sirve como marcador).

## Variables de entorno

Para pruebas y desarrollo:

| Variable | Qué cambia |
|---|---|
| `CLAUDE_CONFIG_DIR` | Dónde buscar las sesiones (la misma variable que usa Claude Code) |
| `TABLERO_DATOS` | Carpeta de datos del agente |
| `TABLERO_CONFIG` | Ruta de `config.json` |
| `TABLERO_DEMO=1` | Modo demo: acepta pids inventados y no toca ventanas reales |

Log: `datos\agente.log`.
