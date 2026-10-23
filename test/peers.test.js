// Consulta a las otras PCs, contra un servidor falso.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { entorno } = require('./ayuda');

entorno();
const peers = require('../src/peers');

const TOKEN = 'token-de-prueba-largo-123';
const nada = () => {};

function servidor(manejar) {
  return new Promise((resolve) => {
    const srv = http.createServer(manejar).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

test('trae las sesiones, corrige el desfase de reloj y no las deja clickear', async () => {
  const desfase = 60e3; // el reloj de la otra PC atrasa un minuto
  const srv = await servidor((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${TOKEN}`);
    const suAhora = Date.now() - desfase;
    res.end(JSON.stringify({ maquina: 'notebook', generado: suAhora, sesiones: [{ id: 'a', estado: 'termino', desde: suAhora - 5 * 60e3, enfocable: true }] }));
  });
  const direccion = `127.0.0.1:${srv.address().port}`;
  await peers.sondearUna(direccion, { puerto: 4590, token: TOKEN }, nada);
  const m = peers.maquinas().find((x) => x.maquina === 'notebook');
  assert.equal(m.ok, true);
  assert.equal(m.local, false);
  assert.equal(m.sesiones[0].enfocable, false);
  // "Terminó hace 5 min" en su reloj tiene que seguir siendo "hace 5 min" en el nuestro.
  assert.ok(Math.abs(Date.now() - m.sesiones[0].desde - 5 * 60e3) < 2000);

  // Se apaga: queda lo último que se supo, marcado como sin conexión.
  await new Promise((r) => srv.close(r));
  await peers.sondearUna(direccion, { puerto: 4590, token: TOKEN }, nada);
  const caida = peers.maquinas().find((x) => x.maquina === 'notebook');
  assert.equal(caida.ok, false);
  assert.equal(caida.sesiones.length, 1);
  assert.ok(caida.ultimoOk);
  assert.equal(caida.error, 'no responde');
  assert.match(caida.ayuda, /agente no está corriendo|firewall/);
});

test('token distinto: lo dice', async () => {
  const srv = await servidor((req, res) => {
    res.statusCode = 401;
    res.end('{}');
  });
  const direccion = `127.0.0.1:${srv.address().port}`;
  await peers.sondearUna(direccion, { puerto: 4590, token: TOKEN }, nada);
  srv.close();
  const m = peers.maquinas().find((x) => x.maquina === direccion);
  assert.equal(m.ok, false);
  assert.match(m.error, /token/);
});

test('direcciones: nombre, nombre:puerto, IP o URL', () => {
  assert.equal(peers.normalizar('notebook', 4590).href, 'http://notebook:4590/');
  assert.equal(peers.normalizar('notebook:4600', 4590).href, 'http://notebook:4600/');
  assert.equal(peers.normalizar('192.168.1.20', 4590).href, 'http://192.168.1.20:4590/');
  assert.equal(peers.normalizar('http://pc.tail1234.ts.net:4590', 4590).href, 'http://pc.tail1234.ts.net:4590/');
});

test('lo que manda otra PC se valida: no puede meter HTML ni datos con otra forma', async () => {
  const malo = '"><img src=x onerror=alert(1)>';
  const sesion = peers.limpiarSesion({ id: 'x', carpeta: 'd:/p', proyecto: 'p', estado: malo, linea: 'r'.repeat(59) + '"', desde: 'ayer', titulo: 't'.repeat(5000) });
  assert.equal(sesion.estado, 'desconocido');
  assert.equal(sesion.linea, null);
  assert.equal(sesion.desde, null);
  assert.equal(sesion.titulo.length, 200);
  assert.equal(sesion.enfocable, false);
  assert.equal(peers.limpiarSesion('no es un objeto'), null);

  const m = peers.limpiarMetricas({
    desde: malo, fuentes: { transcriptsDesde: malo },
    totales: { tuMs: malo, tokens: [1, malo] },
    proyectos: [{ proyecto: 'api-pagos', tuMs: 60 }],
    dias: [{ dia: malo, tuMs: 1 }, { dia: '2026-10-21', tuMs: 2 }],
    horas: [{ inicio: 0, dia: '2026-10-21', hora: malo }, { inicio: 0, dia: '2026-10-21', hora: 9 }],
  });
  assert.equal(m.desde, null);
  assert.equal(m.fuentes.transcriptsDesde, null);
  assert.equal(m.totales.tuMs, 0);
  assert.deepEqual(m.totales.tokens, [1, 0, 0]);
  assert.deepEqual(m.dias.map((d) => d.dia), ['2026-10-21']);
  assert.deepEqual(m.horas.map((h) => h.hora), [9]);
  assert.throws(() => peers.limpiarMetricas(null));
});

test('el contexto que manda otra PC: solo números, o nada', () => {
  assert.deepEqual(peers.limpiarSesion({ id: 'a', contexto: { usados: 412000, ventana: 1000000 } }).contexto, { usados: 412000, ventana: 1000000 });
  assert.equal(peers.limpiarSesion({ id: 'a', contexto: { usados: '<b>', ventana: 1000000 } }).contexto, null);
  assert.equal(peers.limpiarSesion({ id: 'a', contexto: { usados: 5, ventana: 0 } }).contexto, null);
  assert.equal(peers.limpiarSesion({ id: 'a' }).contexto, null);
});
