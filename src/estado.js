const fs = require('fs');
const path = require('path');
const registro = require('./registro');
const transcript = require('./transcript');
const { DIR_DATOS } = require('./config');
const plataforma = require('./plataforma');
const bitacora = require('./bitacora');

const MIN = 60 * 1000;
// Desde dónde corre la sesión. Se pueden traer al frente las de VS Code y las de la terminal;
// las de la app de escritorio de Claude, no.
const ORIGENES = { 'claude-vscode': 'vscode', cli: 'terminal', 'claude-desktop': 'escritorio' };
const RUTA_VISTOS = path.join(DIR_DATOS, 'vistos.json');

// sessionId → momento del último click en su tarjeta
let vistos = {};
try {
  vistos = JSON.parse(fs.readFileSync(RUTA_VISTOS, 'utf8'));
} catch {}

function marcarVistas(ids, activas) {
  for (const id of ids) vistos[id] = Date.now();
  for (const id of Object.keys(vistos)) if (!activas.has(id)) delete vistos[id];
  fs.writeFileSync(RUTA_VISTOS, JSON.stringify(vistos));
}

function extracto(texto, largo) {
  if (!texto) return null;
  const limpio = texto
    .replace(/```[\s\S]*?```/g, ' [código] ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio.length > largo ? limpio.slice(0, largo - 1).trimEnd() + '…' : limpio;
}

// Los cuatro estados del tablero. "termino" dura hasta T minutos después del click en la
// tarjeta, o hasta T2 minutos después de terminar si no hubo click (lo que llegue primero).
function clasificar(e, inf, cfg, ahora) {
  if (e.status === 'busy') return { estado: 'trabajando', desde: e.statusUpdatedAt };
  if (e.status === 'waiting') return { estado: 'esperando', motivo: e.waitingFor ?? null, desde: e.statusUpdatedAt };
  // "shell": la terminal de Claude Code lo usa en lugar de "idle" en algunos casos; es una sesión parada.
  if (e.status !== undefined && e.status !== 'idle' && e.status !== 'shell') return { estado: 'desconocido', motivo: String(e.status), desde: e.statusUpdatedAt };
  if (!inf?.huboTurno) return { estado: 'inactiva', desde: e.startedAt };
  // Al recargar VS Code la sesión arranca en idle con statusUpdatedAt nuevo: manda la última marca del transcript.
  const termino = Math.min(e.statusUpdatedAt ?? Infinity, inf.ultimaMarca ?? Infinity);
  if (termino === Infinity) return { estado: 'inactiva', desde: e.startedAt };
  const visto = vistos[e.sessionId];
  let vence = termino + cfg.minutosSinVer * MIN;
  if (visto >= termino) vence = Math.min(vence, visto + cfg.minutosTrasVer * MIN);
  return { estado: ahora < vence ? 'termino' : 'inactiva', desde: termino };
}

async function sesiones(cfg) {
  const ahora = Date.now();
  const lista = [];
  // La última hora de cada sesión, minuto a minuto (ver bitacora.lineasDeTiempo).
  let lineas = new Map();
  try {
    lineas = bitacora.lineasDeTiempo(ahora, cfg.minutosSinVer * MIN);
  } catch {}
  for (const e of await registro.leer()) {
    let inf = null;
    try {
      inf = transcript.info(e.sessionId, e.cwd);
    } catch {} // transcript ilegible: se muestra igual, sin texto
    // Sin ningún pedido todavía: una pestaña sin usar, o un proceso que la extensión deja de reserva
    // al cerrar una pestaña vacía (para que la siguiente abra rápido). No es una sesión para mirar;
    // aparece en cuanto le escribís algo.
    if (!inf?.huboTurno && (e.status === undefined || e.status === 'idle')) continue;
    const origen = ORIGENES[e.entrypoint] ?? e.entrypoint ?? null;
    const anfitrion = origen === 'terminal' && process.env.TABLERO_DEMO !== '1' ? await plataforma.anfitrionTerminal(e.pid) : null;
    lista.push({
      id: e.sessionId,
      carpeta: e.cwd,
      proyecto: e.cwd.split(/[\\/]/).filter(Boolean).pop(),
      ...clasificar(e, inf, cfg, ahora),
      titulo: extracto(inf?.titulo ?? null, 90) ?? e.name ?? null,
      ultimoMensaje: extracto(inf?.ultimoMensaje ?? null, cfg.largoExtracto),
      pid: e.pid,
      origen,
      // Para una terminal, qué programa la muestra: WindowsTerminal, mintty (Git Bash), conhost, Code.
      anfitrion,
      enfocable: origen === 'vscode' || origen === 'terminal',
      modo: inf?.modo ?? null,
      linea: lineas.get(e.sessionId) ?? null,
      version: typeof e.version === 'string' ? e.version : null,
    });
  }
  return lista;
}

module.exports = { sesiones, marcarVistas };
