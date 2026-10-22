// Atribución de "tu tiempo" a proyectos, minuto a minuto, y lectura del título de la ventana.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { entorno } = require('./ayuda');

entorno();
const { atribuirTuTiempo } = require('../src/metricas');
const { focoDe } = require('../src/actividad');

const M = 60e3;
const cfg = { minutosInactividad: 5, minutosArrastre: 10 };
const base = Date.parse('2026-10-21T12:00:00');
const min = (i, idle, foco) => ({ t: base + i * M, idle, foco });

function atribuir(minutos, pedidos = [], programasQueSuman = []) {
  const out = [];
  atribuirTuTiempo(minutos, pedidos, { ...cfg, programasQueSuman }, (p) => out.push(p));
  return out;
}

test('VS Code al frente: el minuto es de ese proyecto', () => assert.deepEqual(atribuir([min(0, 3, 'p:tienda-online')]), ['tienda-online']));
test('más de 5 min sin teclado ni mouse: no cuenta', () => assert.deepEqual(atribuir([min(0, 400, 'p:tienda-online')]), []));
test('otro programa: no cuenta', () =>
  assert.deepEqual(atribuir([min(0, 3, 'p:api-pagos'), min(1, 3, 'a:whatsapp.root'), min(2, 3, 'a:firefox')]), ['api-pagos']));
test('programa de la lista, poco después: suma al último proyecto', () =>
  assert.deepEqual(atribuir([min(0, 3, 'p:api-pagos'), min(5, 3, 'a:firefox'), min(6, 3, 'a:whatsapp.root')], [], ['firefox']), ['api-pagos', 'api-pagos']));
test('programa de la lista, pasados 10 min: no cuenta', () =>
  assert.deepEqual(atribuir([min(0, 3, 'p:api-pagos'), min(11, 3, 'a:firefox')], [], ['Firefox.exe']), ['api-pagos']));
test('un pedido a Claude en ese minuto cuenta para su proyecto (la terminal)', () =>
  assert.deepEqual(atribuir([min(1, 3, 'a:windowsterminal'), min(2, 3, 'a:windowsterminal')], [{ t: base + M + 20e3, proyecto: 'app-movil' }]), ['app-movil']));
test('un minuto inactivo igual actualiza el contexto', () =>
  assert.deepEqual(atribuir([min(0, 900, 'p:app-movil'), min(2, 3, 'a:firefox')], [], ['firefox']), ['app-movil']));
test('ventana de VS Code sin carpeta: no cuenta', () => assert.deepEqual(atribuir([min(0, 3, 'a:code')]), []));

test('título de VS Code → proyecto', () => {
  assert.equal(focoDe({ proceso: 'Code', titulo: 'Cupones en el carrito… - tienda-online - Visual Studio Code' }), 'p:tienda-online');
  assert.equal(focoDe({ proceso: 'Code', titulo: 'tienda-online - Visual Studio Code' }), 'p:tienda-online');
  assert.equal(focoDe({ proceso: 'Code', titulo: 'a - b - c - mi-proyecto - Visual Studio Code' }), 'p:mi-proyecto');
  assert.equal(focoDe({ proceso: 'Code', titulo: 'Visual Studio Code' }), 'a:code');
  assert.equal(focoDe({ proceso: 'firefox', titulo: 'x' }), 'a:firefox');
});
