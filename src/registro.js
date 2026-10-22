// Registro vivo de sesiones que mantiene Claude Code: ~/.claude/sessions/<pid>.json
// Un archivo por sesión abierta; Claude Code lo borra al cerrarla. Formato interno, probado con 2.1.283.
const fs = require('fs');
const path = require('path');
const { DIR_CLAUDE } = require('./config');
const plataforma = require('./plataforma');

const DIR = path.join(DIR_CLAUDE, 'sessions');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// En el modo demo los pids son inventados: no se verifica que estén vivos.
const DEMO = process.env.TABLERO_DEMO === '1';

// "pid:procStart" → Promise<boolean>. Si Claude se colgó, su archivo queda huérfano y el pid
// puede reutilizarse (sobre todo tras reiniciar): se compara la hora de inicio del proceso.
const verificados = new Map();

function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function esElMismoProceso(e) {
  const inicio = e.procStartFt ?? e.procStart;
  if (inicio === undefined || !/^\d+$/.test(String(inicio))) return Promise.resolve(true);
  const clave = `${e.pid}:${inicio}`;
  if (!verificados.has(clave)) {
    verificados.set(
      clave,
      plataforma.horaInicioProceso(e.pid).then((real) => {
        if (real === null) return true; // no se pudo leer: se confía en que está vivo
        const dif = BigInt(real) - BigInt(inicio);
        return (dif < 0n ? -dif : dif) < 10_000_000n; // 1 s, en unidades de 100 ns
      }),
    );
  }
  return verificados.get(clave);
}

async function leer() {
  let archivos;
  try {
    archivos = fs.readdirSync(DIR);
  } catch {
    return [];
  }
  const sesiones = [];
  for (const f of archivos) {
    if (!/^\d+\.json$/.test(f)) continue;
    let e;
    try {
      e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    } catch {
      continue; // a medio escribir: entra en la próxima lectura
    }
    if (!Number.isInteger(e.pid) || !UUID.test(e.sessionId ?? '') || typeof e.cwd !== 'string') continue;
    if (e.kind !== undefined && e.kind !== 'interactive') continue;
    if (!DEMO && (!vivo(e.pid) || !(await esElMismoProceso(e)))) continue;
    sesiones.push(e);
  }
  return sesiones;
}

module.exports = { leer };
