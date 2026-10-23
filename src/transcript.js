// Lectura (solo lectura) del transcript de una sesión: ~/.claude/projects/<cwd codificado>/<sessionId>.jsonl
// Pueden pesar decenas de MB: se lee solo la cola, y la cabeza si hace falta el primer pedido.
const fs = require('fs');
const path = require('path');
const { DIR_CLAUDE } = require('./config');

const DIR = path.join(DIR_CLAUDE, 'projects');
const COLA = 512 * 1024;
const CABEZA = 256 * 1024;

const rutas = new Map(); // sessionId → ruta del .jsonl
const cache = new Map(); // ruta → { firma, info }

// La carpeta reemplaza por "-" todo lo que no es alfanumérico; la letra de unidad
// aparece en mayúscula o minúscula según cómo se abrió, así que se compara sin distinguir.
function ubicar(sessionId, cwd) {
  const conocida = rutas.get(sessionId);
  if (conocida && fs.existsSync(conocida)) return conocida;
  let carpetas;
  try {
    carpetas = fs.readdirSync(DIR);
  } catch {
    return null;
  }
  const esperada = cwd.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  carpetas.sort((a, b) => (b.toLowerCase() === esperada) - (a.toLowerCase() === esperada));
  for (const c of carpetas) {
    const p = path.join(DIR, c, `${sessionId}.jsonl`);
    if (fs.existsSync(p)) {
      rutas.set(sessionId, p);
      return p;
    }
  }
  return null;
}

function leerTramo(ruta, desde, largo) {
  const fd = fs.openSync(ruta, 'r');
  try {
    const buf = Buffer.alloc(largo);
    const n = fs.readSync(fd, buf, 0, largo, desde);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function registros(texto, descartarPrimera) {
  const lineas = texto.split('\n');
  if (descartarPrimera) lineas.shift(); // puede estar cortada a la mitad
  const out = [];
  for (const l of lineas) {
    if (!l) continue;
    try {
      out.push(JSON.parse(l));
    } catch {} // la última puede estar a medio escribir
  }
  return out;
}

// Pedido escrito por una persona: descarta tool_result, notificaciones de tareas, mensajes de sistema
// y "[Request interrupted…]". Las sesiones nuevas lo marcan con turnOrigin; las viejas, con promptSource.
function esPedidoHumano(r) {
  if (r.type !== 'user' || r.isMeta) return false;
  const c = r.message?.content;
  if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) return false;
  if (r.turnOrigin !== undefined) return r.turnOrigin === 'human';
  if (r.promptSource !== undefined) return r.promptSource === 'sdk';
  const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join(' ') : '';
  return /^\s*[^\s<[]/.test(t);
}

// Texto del pedido, sin los bloques de contexto que agrega VS Code (<ide_selection>, <ide_opened_file>…).
function textoDePedido(r) {
  if (!esPedidoHumano(r)) return null;
  const c = r.message?.content;
  const bloques = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text) : [];
  return bloques.filter((t) => !t.trimStart().startsWith('<')).join(' ').trim() || null;
}

function textoDeAsistente(r) {
  if (r.type !== 'assistant' || !Array.isArray(r.message?.content)) return null;
  return r.message.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ') || null;
}

// Si Claude trabajó mucho desde tu último pedido (capturas, salidas largas), el pedido queda fuera
// de la cola. Se lo busca hacia atrás en bloques, como texto, sin interpretar el JSON.
const MODO = /"permissionMode":"([A-Za-z]+)"/g;
function buscarModoHaciaAtras(ruta, hasta, maximo = 32 * 1024 * 1024) {
  const BLOQUE_MODO = 1024 * 1024;
  for (let fin = hasta; fin > 0 && hasta - fin < maximo; fin -= BLOQUE_MODO - 64) {
    const desde = Math.max(0, fin - BLOQUE_MODO);
    const coincidencias = [...leerTramo(ruta, desde, fin - desde).matchAll(MODO)];
    if (coincidencias.length) return coincidencias[coincidencias.length - 1][1];
  }
  return null;
}

// Ventana de contexto por modelo: 1M en los actuales, 200K en Haiku y los anteriores. Un modelo que
// no está en la lista y ya pasó los 200K tiene que tener la de 1M (si no, no habría llegado).
const DE_UN_MILLON = /^claude-(fable|mythos|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6)|\[1m\]/i;
function ventanaDe(modelo, usados) {
  return DE_UN_MILLON.test(modelo ?? '') || usados > 200000 ? 1000000 : 200000;
}

// Lo que tiene cargado la sesión: la entrada del último mensaje de Claude (sin caché, escritura y
// lectura de caché). Tras una compactación, lo que quedó (postTokens) hasta el mensaje siguiente.
function usoDeContexto(r, previo) {
  if (r.type === 'system' && r.subtype === 'compact_boundary' && Number.isFinite(r.compactMetadata?.postTokens)) {
    return { usados: r.compactMetadata.postTokens, modelo: previo?.modelo ?? null };
  }
  const u = r.type === 'assistant' && !r.isSidechain && r.message?.model !== '<synthetic>' ? r.message?.usage : null;
  if (!u) return previo;
  const usados = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  return usados > 0 ? { usados, modelo: r.message.model ?? null } : previo;
}

function analizar(ruta, tamano) {
  const regs = registros(leerTramo(ruta, Math.max(0, tamano - COLA), COLA), tamano > COLA);
  // modo: el permissionMode de tu último pedido (auto, acceptEdits, plan, default…). Si lo cambiás con
  // Shift+Tab sin escribir nada, el transcript no se entera hasta el pedido siguiente.
  const info = { titulo: null, ultimoMensaje: null, ultimaMarca: null, modo: null, huboTurno: tamano > COLA };
  let tituloIa = null;
  let uso = null;
  for (const r of regs) {
    uso = usoDeContexto(r, uso);
    if (r.type === 'custom-title' && r.customTitle) info.titulo = r.customTitle;
    if (r.type === 'ai-title' && r.aiTitle) tituloIa = r.aiTitle;
    const msj = textoDeAsistente(r);
    if (msj) info.ultimoMensaje = msj;
    if (r.type === 'assistant' || textoDePedido(r)) info.huboTurno = true;
    if (r.type === 'user' && typeof r.permissionMode === 'string') info.modo = r.permissionMode;
    if (r.timestamp) info.ultimaMarca = Date.parse(r.timestamp) || info.ultimaMarca;
  }
  info.titulo ??= tituloIa;
  info.contexto = uso ? { usados: uso.usados, ventana: ventanaDe(uso.modelo, uso.usados) } : null;
  if (!info.modo && tamano > COLA) info.modo = buscarModoHaciaAtras(ruta, tamano - COLA);
  if (!info.titulo) {
    // la cabeza tiene el primer pedido y, si la renombraste temprano, el título puesto a mano
    const cabeza = registros(leerTramo(ruta, 0, CABEZA), false);
    info.titulo =
      cabeza.findLast((r) => r.type === 'custom-title')?.customTitle ??
      cabeza.map(textoDePedido).find(Boolean) ??
      null;
  }
  return info;
}

// Devuelve { titulo, ultimoMensaje, ultimaMarca, modo, huboTurno, contexto: { usados, ventana } | null }
// o null si la sesión todavía no tiene transcript.
function info(sessionId, cwd) {
  const ruta = ubicar(sessionId, cwd);
  if (!ruta) return null;
  let st;
  try {
    st = fs.statSync(ruta);
  } catch {
    return null;
  }
  const firma = `${st.size}:${st.mtimeMs}`;
  const previo = cache.get(ruta);
  if (previo?.firma === firma) return previo.info;
  const nueva = analizar(ruta, st.size);
  cache.set(ruta, { firma, info: nueva });
  return nueva;
}

module.exports = { info, esPedidoHumano, ventanaDe };
