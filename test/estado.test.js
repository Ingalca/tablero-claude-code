// Los cuatro estados del tablero y las reglas de T y T2.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { entorno } = require('./ayuda');

entorno();
const registro = require('../src/registro');
const transcript = require('../src/transcript');
const estado = require('../src/estado');

const M = 60e3;
const cfg = { minutosTrasVer: 5, minutosSinVer: 60, largoExtracto: 160 };
const id = '11111111-1111-1111-1111-111111111111';

// Una sesión del registro y lo que dice su transcript; visto = hace cuántos minutos se hizo click.
async function clasificar(sesion, info, vistoHaceMin = null) {
  const ahora = Date.now();
  registro.leer = async () => [{ pid: 1, sessionId: id, cwd: 'd:\\proyecto', startedAt: ahora - 9e6, entrypoint: 'claude-vscode', ...sesion }];
  transcript.info = () => info;
  const real = Date.now;
  if (vistoHaceMin !== null) Date.now = () => ahora - vistoHaceMin * M;
  estado.marcarVistas([id], new Set(vistoHaceMin !== null ? [id] : [])); // Set vacío: sin marca
  Date.now = real;
  const [s] = await estado.sesiones(cfg);
  return s?.estado ?? 'oculta';
}

const termino = (haceMin) => [{ status: 'idle', statusUpdatedAt: Date.now() - haceMin * M }, { huboTurno: true, ultimaMarca: Date.now() - haceMin * M }];

test('busy es trabajando', async () => assert.equal(await clasificar({ status: 'busy' }, { huboTurno: true }), 'trabajando'));
test('waiting es esperando', async () => assert.equal(await clasificar({ status: 'waiting', waitingFor: 'permission prompt' }, { huboTurno: true }), 'esperando'));
test('una pestaña sin pedidos (o de reserva) no se muestra', async () => assert.equal(await clasificar({ status: 'idle' }, null), 'oculta'));
test('una sesión arrancando, sin status, tampoco', async () => assert.equal(await clasificar({}, null), 'oculta'));
test('un status desconocido se muestra aunque no haya pedidos', async () => assert.equal(await clasificar({ status: 'raro' }, null), 'desconocido'));
test('terminó hace 10 min: terminó', async () => assert.equal(await clasificar(...termino(10)), 'termino'));
test('terminó hace 61 min sin click: inactiva (T2)', async () => assert.equal(await clasificar(...termino(61)), 'inactiva'));
test('click hace 2 min: sigue en terminó', async () => assert.equal(await clasificar(...termino(10), 2), 'termino'));
test('click hace 6 min: inactiva (T)', async () => assert.equal(await clasificar(...termino(10), 6), 'inactiva'));
test('un click anterior al turno no cuenta', async () => assert.equal(await clasificar(...termino(3), 20), 'termino'));
test('al recargar VS Code manda la última marca del transcript', async () =>
  assert.equal(await clasificar({ status: 'idle', statusUpdatedAt: Date.now() - 1000 }, { huboTurno: true, ultimaMarca: Date.now() - 5 * 3600e3 }), 'inactiva'));
test('"shell" (terminal de Claude Code) es una sesión parada, no un estado desconocido', async () => {
  const [sesion, info] = termino(10);
  assert.equal(await clasificar({ ...sesion, status: 'shell' }, info), 'termino');
});
