// Bitácora de cambios de estado de las sesiones: datos/estados/AAAA-MM-DD.jsonl
// Es la única fuente de las aprobaciones (el transcript no deja rastro) y no se puede
// reconstruir hacia atrás: cuenta desde que el agente empezó a anotar.
const fs = require('fs');
const path = require('path');
const registro = require('./registro');
const { DIR_DATOS } = require('./config');
const { diaDe } = require('./fechas');

const DIR = path.join(DIR_DATOS, 'estados');

let previo = new Map(); // sessionId → { s, m, c }

function anotar(lineas) {
  fs.mkdirSync(DIR, { recursive: true });
  for (const l of lineas) fs.appendFileSync(path.join(DIR, `${diaDe(l.t)}.jsonl`), JSON.stringify(l) + '\n');
}

async function muestrear() {
  const ahora = Date.now();
  const actuales = new Map();
  for (const e of await registro.leer()) {
    actuales.set(e.sessionId, { s: e.status ?? 'idle', m: e.waitingFor ?? null, c: e.cwd, u: e.statusUpdatedAt });
  }
  const lineas = [];
  for (const [id, v] of actuales) {
    const p = previo.get(id);
    if (p && p.s === v.s && p.m === v.m) continue;
    // statusUpdatedAt es el momento exacto del cambio; si no es creíble, el de la muestra
    const t = Number.isFinite(v.u) && v.u <= ahora && v.u > ahora - 60e3 ? v.u : ahora;
    lineas.push({ t, id, c: v.c, s: v.s, m: v.m });
  }
  for (const [id, p] of previo) if (!actuales.has(id)) lineas.push({ t: ahora, id, c: p.c, s: 'cerrada', m: null });
  previo = actuales;
  if (lineas.length) anotar(lineas);
}

function iniciar(log, cadaMs = 3000) {
  setInterval(() => muestrear().catch((e) => log(`bitácora: ${e.message}`)), cadaMs).unref();
}

function leerDias(dias) {
  const out = [];
  for (const d of dias) {
    let texto;
    try {
      texto = fs.readFileSync(path.join(DIR, `${d}.jsonl`), 'utf8');
    } catch {
      continue;
    }
    for (const l of texto.split('\n')) {
      try {
        if (l) out.push(JSON.parse(l));
      } catch {}
    }
  }
  return out;
}

// Los días se releen solo si cambió el archivo: la línea de tiempo se pide cada pocos segundos.
const cache = new Map(); // día → { size, entradas }
function entradasDe(dia) {
  const ruta = path.join(DIR, `${dia}.jsonl`);
  let size;
  try {
    size = fs.statSync(ruta).size;
  } catch {
    return [];
  }
  const previo = cache.get(dia);
  if (previo?.size === size) return previo.entradas;
  const entradas = leerDias([dia]);
  cache.set(dia, { size, entradas });
  if (cache.size > 4) cache.delete(cache.keys().next().value);
  return entradas;
}

// La última hora de cada sesión, minuto a minuto: un texto de 60 letras, la primera es hace una hora.
//   r trabajando · w esperando · d terminó (parada, hasta T2 después de trabajar) · i inactiva o sin datos
// En cada minuto gana lo que más importa ver: una espera de aprobación de segundos igual pinta el minuto.
const MIN = 60e3;
const PRIORIDAD = { w: 3, r: 2, d: 1, i: 0 };
function lineasDeTiempo(ahora, T2) {
  const ini = ahora - 60 * MIN;
  const margen = ini - T2 - 60 * MIN; // para saber cómo venía cada sesión al empezar la hora
  const dias = [...new Set([diaDe(margen), diaDe(ini), diaDe(ahora)])];
  const porSesion = new Map();
  for (const e of dias.flatMap(entradasDe)) {
    if (e.t < margen || e.t > ahora) continue;
    if (!porSesion.has(e.id)) porSesion.set(e.id, []);
    porSesion.get(e.id).push(e);
  }
  const out = new Map();
  for (const [id, entradas] of porSesion) {
    entradas.sort((a, b) => a.t - b.t);
    const tramos = []; // [desde, hasta, letra]
    let finTrabajo = null;
    entradas.forEach((e, i) => {
      const hasta = entradas[i + 1]?.t ?? ahora;
      const activo = e.s === 'busy' || e.s === 'waiting';
      if (activo) {
        tramos.push([e.t, hasta, e.s === 'busy' ? 'r' : 'w']);
        finTrabajo = hasta;
      } else if (e.s === 'cerrada' || finTrabajo === null) {
        tramos.push([e.t, hasta, 'i']);
        if (e.s === 'cerrada') finTrabajo = null;
      } else {
        const corte = Math.min(hasta, finTrabajo + T2);
        if (corte > e.t) tramos.push([e.t, corte, 'd']);
        if (hasta > corte) tramos.push([Math.max(e.t, corte), hasta, 'i']);
      }
    });
    let linea = '';
    for (let k = 0; k < 60; k++) {
      const a = ini + k * MIN;
      const b = a + MIN;
      let mejor = 'i';
      for (const [x, y, letra] of tramos) if (x < b && y > a && PRIORIDAD[letra] > PRIORIDAD[mejor]) mejor = letra;
      linea += mejor;
    }
    out.set(id, linea);
  }
  return out;
}

function desde() {
  try {
    return fs.readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort()[0]?.slice(0, 10) ?? null;
  } catch {
    return null;
  }
}

module.exports = { iniciar, leerDias, desde, lineasDeTiempo };
