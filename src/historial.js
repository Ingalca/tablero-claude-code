// Índice de turnos y tokens de todos los transcripts, para las métricas.
// Lee cada archivo una sola vez y después solo lo que se le agrega. Guarda solo números y marcas de
// tiempo (nada de contenido) en datos/historial.json, y los conserva aunque Claude Code borre el
// transcript a los 30 días: así la historia va más allá de lo que queda en disco.
const fs = require('fs');
const path = require('path');
const { esPedidoHumano } = require('./transcript');
const { DIR_DATOS, DIR_CLAUDE } = require('./config');

const DIR = path.join(DIR_CLAUDE, 'projects');
const RUTA = path.join(DIR_DATOS, 'historial.json');
const BLOQUE = 8 * 1024 * 1024;
const HORA = 3600e3;
const VERSION = 3; // si cambia lo que se guarda, se reindexa todo (tarda segundos)
const HUECO_MINIMO = 2 * 60e3;
// Tipo de cada hueco dentro de un turno, según lo último que hizo Claude antes:
//   p: te preguntó algo (la espera es tuya), l: subagente (puede estar trabajando), h: otra herramienta
const PREGUNTAS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const LARGAS = new Set(['Agent', 'Task']);

let cache = { version: VERSION, archivos: {} };
try {
  const leido = JSON.parse(fs.readFileSync(RUTA, 'utf8'));
  if (leido.version === VERSION) cache = leido;
} catch {}

let indexando = false;
let primeraPasadaHecha = false;

const pausa = () => new Promise((r) => setImmediate(r));

function listarArchivos() {
  const out = [];
  let proyectos = [];
  try {
    proyectos = fs.readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  for (const p of proyectos) {
    const base = path.join(DIR, p.name);
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push({ ruta: path.join(base, e.name), sub: false });
      // Los subagentes viven en <sesión>/subagents/*.jsonl: su tiempo ya está dentro del turno
      // de la sesión que los lanzó; de ellos solo se suman los tokens.
      const subs = path.join(base, e.name, 'subagents');
      if (e.isDirectory() && fs.existsSync(subs)) {
        for (const s of fs.readdirSync(subs)) if (s.endsWith('.jsonl')) out.push({ ruta: path.join(subs, s), sub: true });
      }
    }
  }
  return out;
}

function nuevaEntrada(sub) {
  return { sub, size: 0, mtimeMs: 0, offset: 0, sesion: null, carpeta: null, turnos: [], abierto: null, pendientes: {}, ultimoMsg: null, tokensPorHora: {} };
}

function tokensDe(r) {
  const u = r.message?.usage;
  if (!u) return null;
  return [(u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), u.cache_read_input_tokens ?? 0, u.output_tokens ?? 0];
}

function sumar(a, b) {
  a[0] += b[0];
  a[1] += b[1];
  a[2] += b[2];
}

// Turno: arranca con un pedido tuyo (o con una notificación de tarea que lo reanuda) y termina en
// la última actividad de Claude antes del siguiente.
// turnos: [inicio, fin, humano 0/1, [entrada, caché, salida], huecos: [[desde, hasta, tipo]]]
// Los huecos (más de 2 min sin registros dentro del turno) se guardan en bruto: si Claude esperó una
// aprobación o una respuesta tuya, eso no es trabajo; las métricas deciden cuánto descontar.
function procesar(entrada, r) {
  const ts = Date.parse(r.timestamp ?? '');
  if (!ts) return;
  entrada.carpeta ??= typeof r.cwd === 'string' ? r.cwd : null;
  entrada.sesion ??= typeof r.sessionId === 'string' ? r.sessionId : null;

  const tokens = r.type === 'assistant' ? tokensDe(r) : null;
  const msgNuevo = tokens && r.message?.id !== entrada.ultimoMsg; // un mensaje se reparte en varios registros con el mismo usage
  if (msgNuevo) entrada.ultimoMsg = r.message?.id;

  if (entrada.sub) {
    if (msgNuevo) {
      const hora = Math.floor(ts / HORA) * HORA;
      sumar((entrada.tokensPorHora[hora] ??= [0, 0, 0]), tokens);
    }
    return;
  }

  const humano = esPedidoHumano(r);
  const reanuda = r.type === 'user' && !humano && !r.isMeta && (r.turnOrigin === 'task_notification' || r.promptSource === 'system');
  if (humano || reanuda) {
    if (entrada.abierto) entrada.turnos.push(entrada.abierto);
    entrada.abierto = [ts, ts, humano ? 1 : 0, [0, 0, 0], []];
    entrada.pendientes = {};
    return;
  }
  const bloques = Array.isArray(r.message?.content) ? r.message.content : [];
  const deClaude = r.type === 'assistant' || (r.type === 'user' && bloques.some((b) => b.type === 'tool_result'));
  if (!deClaude) return;
  const t = (entrada.abierto ??= [ts, ts, 0, [0, 0, 0], []]);
  // Un hueco con herramientas pendientes de resultado es espera (aprobación, pregunta o ejecución);
  // sin herramientas pendientes es Claude generando, y no se anota.
  const pendientes = Object.values(entrada.pendientes ?? {});
  if (ts - t[1] > HUECO_MINIMO && pendientes.length) {
    const tipo = pendientes.some((n) => PREGUNTAS.has(n)) ? 'p' : pendientes.some((n) => LARGAS.has(n)) ? 'l' : 'h';
    t[4].push([t[1], ts, tipo]);
  }
  t[1] = Math.max(t[1], ts);
  if (msgNuevo) sumar(t[3], tokens);
  entrada.pendientes ??= {};
  for (const b of bloques) {
    if (b.type === 'tool_use' && b.id) entrada.pendientes[b.id] = b.name;
    if (b.type === 'tool_result') delete entrada.pendientes[b.tool_use_id];
  }
}

async function leerDesde(entrada, ruta, size) {
  const fd = fs.openSync(ruta, 'r');
  try {
    let resto = Buffer.alloc(0);
    let pos = entrada.offset;
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(BLOQUE, size - pos));
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      pos += n;
      const datos = resto.length ? Buffer.concat([resto, buf.subarray(0, n)]) : buf.subarray(0, n);
      let inicio = 0;
      let i;
      while ((i = datos.indexOf(10, inicio)) !== -1) {
        const linea = datos.toString('utf8', inicio, i);
        inicio = i + 1;
        if (!linea) continue;
        try {
          procesar(entrada, JSON.parse(linea));
        } catch {}
      }
      resto = datos.subarray(inicio);
      entrada.offset = pos - resto.length; // solo hasta la última línea completa
      await pausa(); // que el servidor siga atendiendo mientras indexa
    }
  } finally {
    fs.closeSync(fd);
  }
}

async function actualizar() {
  if (indexando) return;
  indexando = true;
  let cambios = false;
  try {
    for (const { ruta, sub } of listarArchivos()) {
      let st;
      try {
        st = fs.statSync(ruta);
      } catch {
        continue;
      }
      let entrada = cache.archivos[ruta];
      if (entrada && entrada.size === st.size && entrada.mtimeMs === st.mtimeMs) continue;
      if (!entrada || st.size < entrada.offset) entrada = cache.archivos[ruta] = nuevaEntrada(sub); // nuevo o reescrito
      await leerDesde(entrada, ruta, st.size);
      entrada.size = st.size;
      entrada.mtimeMs = st.mtimeMs;
      cambios = true;
    }
    if (cambios) fs.writeFileSync(RUTA, JSON.stringify({ ...cache, version: VERSION }));
  } finally {
    indexando = false;
    primeraPasadaHecha = true;
  }
}

function iniciar(log, cadaMs = 60e3) {
  const correr = () =>
    actualizar().catch((e) => log(`historial: ${e.message}`));
  correr();
  setInterval(correr, cadaMs).unref();
}

function datos() {
  return { archivos: cache.archivos, listo: primeraPasadaHecha };
}

module.exports = { iniciar, actualizar, datos };
