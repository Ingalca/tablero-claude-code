const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const estado = require('./estado');
const fijadas = require('./fijadas');
const metricas = require('./metricas');
const peers = require('./peers');
const { diaDe } = require('./fechas');
const { enfocar } = require('./enfocar');

const PAGINA = path.join(__dirname, '..', 'web', 'index.html');
const PAGINAS = { '/': PAGINA, '/resumen': path.join(__dirname, '..', 'web', 'resumen.html') };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Versiones de Claude Code con las que se verificó el formato del registro de sesiones.
// Con otra versión el tablero avisa: el formato es interno y puede cambiar.
const VERSIONES_PROBADAS = ['2.1.283', '2.1.292', '2.1.306'];

// Desde la red solo se acepta LAN y Tailscale: privadas, 100.64.0.0/10 (CGNAT de Tailscale) y equivalentes IPv6.
const permitidas = new net.BlockList();
permitidas.addSubnet('127.0.0.0', 8, 'ipv4');
permitidas.addSubnet('10.0.0.0', 8, 'ipv4');
permitidas.addSubnet('172.16.0.0', 12, 'ipv4');
permitidas.addSubnet('192.168.0.0', 16, 'ipv4');
permitidas.addSubnet('169.254.0.0', 16, 'ipv4');
permitidas.addSubnet('100.64.0.0', 10, 'ipv4');
permitidas.addAddress('::1', 'ipv6');
permitidas.addSubnet('fe80::', 10, 'ipv6');
permitidas.addSubnet('fc00::', 7, 'ipv6');

function ipv4(ip = '') {
  return ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1] ?? ip;
}

function origenPermitido(ip) {
  const v = ipv4(ip);
  return permitidas.check(v, net.isIPv6(v) ? 'ipv6' : 'ipv4');
}

// El tablero y las acciones (enfocar, visto) son solo para el navegador de esta misma PC.
// Se exige también el Host, para que una página web cualquiera no pueda usar DNS rebinding.
function esLocal(req) {
  const ip = ipv4(req.socket.remoteAddress);
  return (ip === '127.0.0.1' || ip === '::1') && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host ?? '');
}

// Un header propio obliga al navegador a hacer preflight CORS, que no se contesta: otra página no puede llamar a la API.
function esDelTablero(req) {
  return esLocal(req) && req.headers['x-tablero'] === '1';
}

function tokenValido(req, token) {
  const m = (req.headers.authorization ?? '').match(/^Bearer (.+)$/);
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1]).digest();
  const b = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

function responder(res, codigo, cuerpo) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (c) => {
      datos += c;
      if (datos.length > 64 * 1024) reject(new Error('cuerpo demasiado grande'));
    });
    req.on('end', () => {
      try {
        resolve(datos ? JSON.parse(datos) : {});
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
  });
}

function crear(cfg, log) {
  return http.createServer(async (req, res) => {
    try {
      if (!origenPermitido(req.socket.remoteAddress)) return responder(res, 403, { error: 'origen no permitido' });
      const { pathname } = new URL(req.url, 'http://x');

      if (req.method === 'GET' && pathname === '/api/salud') return responder(res, 200, { ok: true });

      if (req.method === 'GET' && PAGINAS[pathname]) {
        if (!esLocal(req)) return responder(res, 403, { error: 'el tablero se abre en http://localhost:' + cfg.puerto });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(PAGINAS[pathname]));
      }

      // Métricas. Al tablero de esta PC: las de todas las máquinas menos las de ?ocultar=a,b, combinadas.
      // Se pide qué ocultar y no qué mostrar: así una máquina nueva entra sola. A otra PC, con el token: solo las de esta, con las respuestas crudas para
      // que las pueda combinar. Nunca se reenvía a otras PCs: no hay consultas en círculo.
      if (req.method === 'GET' && pathname === '/api/metricas') {
        const local = esDelTablero(req);
        if (!local && !tokenValido(req, cfg.token)) return responder(res, 401, { error: 'token inválido' });
        const q = new URL(req.url, 'http://x').searchParams;
        const hoy = diaDe(Date.now());
        const desde = q.get('desde') ?? hoy;
        const hasta = q.get('hasta') ?? hoy;
        if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) return responder(res, 400, { error: 'rango inválido' });
        if (!local) return responder(res, 200, { maquina: cfg.maquina, ...metricas.calcular(cfg, desde, hasta, { conRespuestas: true }) });

        const otras = peers.maquinas();
        const disponibles = [cfg.maquina, ...otras.map((m) => m.maquina)];
        const ocultar = (q.get('ocultar') ?? '').split(',').filter(Boolean);
        let elegidas = disponibles.filter((n) => !ocultar.includes(n));
        if (!elegidas.length) elegidas = disponibles; // nunca ninguna: la página no lo permite, pero por las dudas
        // ?remotas=0: solo esta PC, al instante. La página lo pide primero para mostrar algo enseguida y
        // después pide todo; las otras PCs quedan como "cargando" (ok: null) hasta la segunda respuesta.
        const conRemotas = q.get('remotas') !== '0';
        const partes = [];
        if (elegidas.includes(cfg.maquina)) {
          partes.push({ maquina: cfg.maquina, ok: true, datos: metricas.calcular(cfg, desde, hasta, { conRespuestas: true }) });
        }
        if (conRemotas) partes.push(...(await peers.pedirMetricas(cfg, desde, hasta, elegidas.filter((n) => n !== cfg.maquina))));
        const buenas = partes.filter((p) => p.ok);
        // Si ninguna elegida respondió: todo en cero (con sus días y horas), nunca los datos de otra máquina.
        const combinadas = metricas.combinar(buenas.length ? buenas : [{ maquina: cfg.maquina, datos: metricas.enCero(metricas.calcular(cfg, desde, hasta, { conRespuestas: true })) }]);
        return responder(res, 200, {
          ...combinadas,
          maquinas: disponibles.map((n) => {
            const p = partes.find((x) => x.maquina === n);
            const cargando = !conRemotas && n !== cfg.maquina && elegidas.includes(n);
            return { maquina: n, local: n === cfg.maquina, incluida: elegidas.includes(n), ok: p ? p.ok : null, cargando, error: p?.error ?? null, ayuda: p?.ayuda ?? null };
          }),
        });
      }

      // Lo que consume el tablero: las sesiones de todas las máquinas.
      if (req.method === 'GET' && pathname === '/api/tablero') {
        if (!esDelTablero(req)) return responder(res, 403, { error: 'solo desde esta PC' });
        return responder(res, 200, {
          generado: Date.now(),
          pagina: fs.statSync(PAGINA).mtimeMs, // si cambia, el tablero se recarga solo
          horasInactivasVisibles: cfg.horasInactivasVisibles,
          horasInactivasPlegadas: cfg.horasInactivasPlegadas,
          versionesProbadas: VERSIONES_PROBADAS,
          fijadas: fijadas.leer(),
          maquinas: [{ maquina: cfg.maquina, local: true, ok: true, sesiones: await estado.sesiones(cfg) }, ...peers.maquinas()],
        });
      }

      if (req.method === 'POST' && pathname === '/api/fijadas') {
        if (!esDelTablero(req)) return responder(res, 403, { error: 'solo desde esta PC' });
        const { fijadas: lista } = await leerCuerpo(req);
        try {
          return responder(res, 200, { fijadas: fijadas.guardar(lista) });
        } catch (e) {
          return responder(res, 400, { error: e.message });
        }
      }

      // Click en una tarjeta: trae la ventana al frente y da por vistas todas las sesiones de esa carpeta.
      if (req.method === 'POST' && pathname === '/api/enfocar') {
        if (!esDelTablero(req)) return responder(res, 403, { error: 'solo desde esta PC' });
        const { sessionId } = await leerCuerpo(req);
        const activas = await estado.sesiones(cfg);
        const sesion = activas.find((s) => s.id === sessionId);
        if (!sesion) return responder(res, 404, { error: 'sesión no encontrada' });
        if (!sesion.enfocable) return responder(res, 409, { error: 'esta sesión no se puede traer al frente' });
        const misma = (s) => s.carpeta.toLowerCase() === sesion.carpeta.toLowerCase();
        estado.marcarVistas(activas.filter(misma).map((s) => s.id), new Set(activas.map((s) => s.id)));
        const resultado = await enfocar(sesion);
        log(`enfocar ${sesion.carpeta} (${sesion.id.slice(0, 8)}): ${resultado}`);
        return responder(res, 200, { ok: true, resultado });
      }

      // Lo que se pide entre PCs: solo lectura, con token.
      if (req.method === 'GET' && pathname === '/api/estado') {
        if (!tokenValido(req, cfg.token)) return responder(res, 401, { error: 'token inválido' });
        return responder(res, 200, { maquina: cfg.maquina, generado: Date.now(), sesiones: await estado.sesiones(cfg) });
      }

      responder(res, 404, { error: 'no existe' });
    } catch (e) {
      log(`error en ${req.method} ${req.url}: ${e.message}`);
      // El detalle (puede tener rutas del disco) solo para esta PC; afuera, un mensaje genérico.
      responder(res, 500, { error: esLocal(req) ? e.message : 'error interno del agente' });
    }
  });
}

module.exports = { crear };
