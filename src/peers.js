// Las otras PCs: cada pocos segundos se le pide a cada una su estado (GET /api/estado, con el token).
// Se guarda la última respuesta buena: si una PC deja de responder, sus tarjetas siguen a la vista,
// en gris, con "sin datos desde…", en vez de desaparecer y dar a entender que no hay nada pendiente.
const http = require('http');
const net = require('net');

const CADA_MS = 3000;
const ESPERA_MS = 2500;

const estados = new Map(); // dirección (como está en config) → { url, maquina, ok, ultimoOk, error, sesiones }

// Lo que llega de otra PC se valida campo por campo antes de usarlo: termina en el HTML del tablero, y
// una PC comprometida (o alguien con el token) no tiene que poder meter código ahí.
const ESTADOS = new Set(['trabajando', 'esperando', 'termino', 'inactiva', 'desconocido']);
const FECHA = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const texto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const numero = (v) => (Number.isFinite(v) ? v : 0);

function limpiarSesion(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    id: texto(s.id, 64),
    carpeta: texto(s.carpeta, 300) ?? '?',
    proyecto: texto(s.proyecto, 120) ?? '?',
    estado: ESTADOS.has(s.estado) ? s.estado : 'desconocido',
    motivo: texto(s.motivo, 80),
    desde: Number.isFinite(s.desde) ? s.desde : null,
    titulo: texto(s.titulo, 200),
    ultimoMensaje: texto(s.ultimoMensaje, 600),
    origen: texto(s.origen, 30),
    anfitrion: texto(s.anfitrion, 40),
    modo: texto(s.modo, 40),
    linea: typeof s.linea === 'string' && /^[rwdi]{60}$/.test(s.linea) ? s.linea : null,
    version: texto(s.version, 40),
    enfocable: false, // traer al frente solo funciona con las sesiones de esta PC
  };
}

// Una fila de métricas (total, proyecto, día u hora): solo números, y los campos que la identifican.
function limpiarFila(f) {
  if (!f || typeof f !== 'object') return null;
  const fila = {};
  for (const k of ['tuMs', 'claudeMs', 'activoMs', 'esperaMs', 'conEsperaMs', 'pedidos', 'aprobaciones', 'bloqueoMs']) fila[k] = numero(f[k]);
  fila.tokens = [0, 1, 2].map((i) => numero(f.tokens?.[i]));
  fila.respuestas = Array.isArray(f.respuestas) ? f.respuestas.filter(Number.isFinite).slice(0, 20000) : [];
  return fila;
}

function limpiarMetricas(d) {
  if (!d || typeof d !== 'object') throw new Error('métricas inválidas');
  const lista = (v) => (Array.isArray(v) ? v : []);
  return {
    desde: FECHA.test(d.desde) ? d.desde : null,
    hasta: FECHA.test(d.hasta) ? d.hasta : null,
    indexado: d.indexado === true,
    fuentes: {
      transcriptsDesde: FECHA.test(d.fuentes?.transcriptsDesde) ? d.fuentes.transcriptsDesde : null,
      actividadDesde: FECHA.test(d.fuentes?.actividadDesde) ? d.fuentes.actividadDesde : null,
      bitacoraDesde: FECHA.test(d.fuentes?.bitacoraDesde) ? d.fuentes.bitacoraDesde : null,
      actividadActiva: d.fuentes?.actividadActiva === true,
    },
    totales: limpiarFila(d.totales) ?? limpiarFila({}),
    proyectos: lista(d.proyectos).map((p) => ({ proyecto: texto(p?.proyecto, 120) ?? '?', ...limpiarFila(p) })),
    dias: lista(d.dias).filter((x) => FECHA.test(x?.dia)).map((x) => ({ dia: x.dia, ...limpiarFila(x) })),
    horas: lista(d.horas)
      .filter((x) => Number.isFinite(x?.inicio) && FECHA.test(x?.dia) && Number.isInteger(x?.hora) && x.hora >= 0 && x.hora < 24)
      .map((x) => ({ inicio: x.inicio, dia: x.dia, hora: x.hora, ...limpiarFila(x) })),
  };
}

// "notebook", "notebook:4590", "192.168.1.20" o "http://notebook:4590" → URL. Sin puerto, el de esta PC.
function normalizar(direccion, puertoPorDefecto) {
  const conEsquema = /^https?:\/\//i.test(direccion) ? direccion : `http://${direccion}`;
  const url = new URL(conEsquema);
  if (!url.port) url.port = String(puertoPorDefecto);
  return url;
}

function consultar(url, token, ruta = '/api/estado', espera = ESPERA_MS) {
  return new Promise((resolve, reject) => {
    // IPv4: el agente escucha solo ahí, y un nombre también puede resolver a IPv6 (que no contesta) y
    // hacer esperar cada consulta. Salvo que la dirección configurada sea una IPv6 literal.
    const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname; // IPv6 viene entre corchetes
    const familia = net.isIPv6(host) ? 6 : 4;
    const req = http.get(new URL(ruta, url), { headers: { Authorization: `Bearer ${token}` }, timeout: espera, agent: false, family: familia }, (res) => {
      let cuerpo = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        cuerpo += c;
        if (cuerpo.length > 8 * 1024 * 1024) req.destroy(new Error('respuesta demasiado grande'));
      });
      res.on('end', () => {
        if (res.statusCode === 401) return reject(Object.assign(new Error('token distinto'), { code: 'TOKEN' }));
        if (res.statusCode !== 200) return reject(Object.assign(new Error(`respondió ${res.statusCode}`), { code: `HTTP${res.statusCode}` }));
        try {
          resolve(JSON.parse(cuerpo));
        } catch {
          reject(new Error('respuesta inválida'));
        }
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('no responde'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

// Qué pasó, corto, y una ayuda con las causas posibles (la página la muestra en un ⓘ). Node 20 informa
// "conexión rechazada" como un AggregateError sin mensaje (probó IPv4 e IPv6): el código está adentro.
const APAGADA = 'Puede estar apagada, no estar en la misma red, o el firewall bloquea el puerto del agente.';
const FALLAS = {
  ECONNREFUSED: ['no responde', 'La PC contesta, pero el agente no está corriendo, o el firewall bloquea su puerto.'],
  ENOTFOUND: ['no la encuentro por nombre', 'Puede estar apagada o en otra red. Si el nombre no se resuelve en esta red, usá su IP (ver docs/varias-pcs.md).'],
  EAI_AGAIN: ['no la encuentro por nombre', 'Puede estar apagada o en otra red. Si el nombre no se resuelve en esta red, usá su IP (ver docs/varias-pcs.md).'],
  ETIMEDOUT: ['no responde', APAGADA],
  EHOSTUNREACH: ['no responde', APAGADA],
  ENETUNREACH: ['no responde', APAGADA],
  ECONNRESET: ['se cortó la conexión', 'Se cortó a mitad de la consulta; suele resolverse solo en la siguiente.'],
  TOKEN: ['token distinto', 'Las dos PCs tienen que tener el mismo "token" en config.json.'],
  VIEJA: ['tiene una versión anterior', 'Actualizala con git pull y reiniciá su agente.'],
};
function falla(e) {
  const codigo = e.code ?? e.errors?.find((x) => x.code)?.code;
  const [error, ayuda] = FALLAS[codigo] ?? [e.message || codigo || 'error desconocido', null];
  return { error, ayuda };
}
const motivo = (e) => falla(e).error;

async function sondearUna(direccion, cfg, log) {
  const previo = estados.get(direccion);
  let url;
  try {
    url = normalizar(direccion, cfg.puerto);
  } catch {
    estados.set(direccion, { maquina: direccion, ok: false, error: 'dirección inválida', sesiones: [] });
    return;
  }
  const t0 = Date.now();
  try {
    const j = await consultar(url, cfg.token);
    const t1 = Date.now();
    // Los relojes de las dos PCs pueden diferir: las marcas de tiempo de la otra se corrigen
    // con la diferencia entre su "generado" y el momento (local) en que llegó la respuesta.
    const desfase = (t0 + t1) / 2 - (Number(j.generado) || t1);
    const sesiones = (Array.isArray(j.sesiones) ? j.sesiones : []).slice(0, 500).map(limpiarSesion).filter(Boolean)
      .map((s) => ({ ...s, desde: s.desde === null ? t1 : s.desde + desfase }));
    if (previo && !previo.ok) log(`peers: ${direccion} volvió a responder`);
    estados.set(direccion, { url: url.href, maquina: texto(j.maquina, 60) || direccion, ok: true, ultimoOk: t1, error: null, ayuda: null, sesiones });
  } catch (e) {
    if (!previo || previo.ok) log(`peers: ${direccion}: ${motivo(e)}`);
    estados.set(direccion, { url: url.href, maquina: previo?.maquina ?? direccion, ok: false, ultimoOk: previo?.ultimoOk ?? null, ...falla(e), sesiones: previo?.sesiones ?? [] });
  }
}

function iniciar(cfg, log) {
  const lista = Array.isArray(cfg.peers) ? cfg.peers.filter((p) => typeof p === 'string' && p.trim()) : [];
  if (!lista.length) return;
  log(`peers: consultando ${lista.join(', ')}`);
  const sondear = () => Promise.all(lista.map((d) => sondearUna(d.trim(), cfg, log)));
  sondear();
  setInterval(sondear, CADA_MS).unref();
}

// Para /api/tablero: una entrada por PC, con lo último que se supo de ella.
function maquinas() {
  return [...estados.values()].map(({ maquina, ok, ultimoOk, error, ayuda, sesiones }) => ({
    maquina,
    local: false,
    ok,
    ultimoOk,
    error,
    ayuda: ayuda ?? null,
    sesiones,
  }));
}

// Las métricas de las otras PCs para un rango, solo de las máquinas pedidas (por nombre).
// Devuelve [{ maquina, ok, datos | error }]. Una PC que nunca respondió se identifica por su dirección.
async function pedirMetricas(cfg, desde, hasta, nombres) {
  const elegidas = [...estados.values()].filter((e) => e.url && nombres.includes(e.maquina));
  const ruta = `/api/metricas?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}&respuestas=1`;
  return Promise.all(elegidas.map(async (e) => {
    // Si la consulta de estado (cada 3 s) ya la ve caída, no se espera su tiempo límite otra vez.
    if (!e.ok) return { maquina: e.maquina, ok: false, error: e.error ?? 'no responde', ayuda: e.ayuda ?? null };
    try {
      return { maquina: e.maquina, ok: true, datos: limpiarMetricas(await consultar(new URL(e.url), cfg.token, ruta, 8000)) };
    } catch (err) {
      // Si su estado responde pero las métricas dan 403/404, tiene una versión anterior que no las comparte.
      return { maquina: e.maquina, ok: false, ...falla(/^HTTP40[34]$/.test(err.code) ? { code: 'VIEJA' } : err) };
    }
  }));
}

module.exports = { iniciar, maquinas, normalizar, sondearUna, pedirMetricas, limpiarSesion, limpiarMetricas };
