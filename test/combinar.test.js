// Combinación de las métricas de varias PCs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { entorno } = require('./ayuda');

entorno();
const { combinar, enCero } = require('../src/metricas');

const M = 60e3;
const fila = (extra) => ({ tuMs: 0, claudeMs: 0, activoMs: 0, esperaMs: 0, conEsperaMs: 0, pedidos: 0, aprobaciones: 0, bloqueoMs: 0, tokens: [0, 0, 0], respuestas: [], ...extra });
const datos = (proyectos, respuestas, horaInicio) => ({
  desde: '2026-10-21',
  hasta: '2026-10-21',
  indexado: true,
  fuentes: { transcriptsDesde: '2026-09-01', actividadDesde: '2026-10-21', bitacoraDesde: '2026-10-21', actividadActiva: true },
  totales: fila({ tuMs: proyectos.reduce((s, p) => s + p.tuMs, 0), pedidos: proyectos.reduce((s, p) => s + p.pedidos, 0), tokens: [1, 2, 3], respuestas }),
  proyectos: proyectos.map((p) => fila({ ...p, respuestas })),
  dias: [fila({ dia: '2026-10-21', tuMs: proyectos.reduce((s, p) => s + p.tuMs, 0) })],
  horas: [fila({ inicio: horaInicio, dia: '2026-10-21', hora: 10, tuMs: 30 * M })],
});

const hora10 = new Date(2026, 9, 21, 10).getTime();
const ws = { maquina: 'workstation', datos: datos([{ proyecto: 'api-pagos', tuMs: 60 * M, pedidos: 3 }, { proyecto: 'app-movil', tuMs: 10 * M, pedidos: 1 }], [1 * M, 2 * M, 3 * M], hora10) };
const nb = { maquina: 'notebook', datos: datos([{ proyecto: 'Api-Pagos', tuMs: 20 * M, pedidos: 2 }], [10 * M, 20 * M], hora10) };

test('suma por proyecto, y un proyecto de las dos máquinas queda en una fila', () => {
  const r = combinar([ws, nb]);
  const pagos = r.proyectos.find((p) => p.proyecto.toLowerCase() === 'api-pagos');
  assert.equal(pagos.tuMs, 80 * M);
  assert.equal(pagos.pedidos, 5);
  assert.deepEqual(pagos.maquinas, ['notebook', 'workstation']);
  assert.deepEqual(r.proyectos.find((p) => p.proyecto === 'app-movil').maquinas, ['workstation']);
  assert.equal(r.totales.tuMs, 90 * M);
  assert.deepEqual(r.totales.tokens, [2, 4, 6]);
});

test('la mediana sale de todas las respuestas juntas, no del promedio de medianas', () => {
  // workstation: 1, 2, 3 (mediana 2); notebook: 10, 20 (mediana 15). Juntas: 1, 2, 3, 10, 20 → 3.
  assert.equal(combinar([ws, nb]).totales.respuestaMedianaMs, 3 * M);
});

test('días y horas se suman por su clave, y no viajan las respuestas crudas', () => {
  const r = combinar([ws, nb]);
  assert.equal(r.dias.length, 1);
  assert.equal(r.dias[0].tuMs, 90 * M);
  assert.equal(r.horas.length, 1);
  assert.equal(r.horas[0].tuMs, 60 * M);
  assert.equal(r.totales.respuestas, undefined);
});

test('una sola máquina queda igual que estaba', () => {
  const r = combinar([ws]);
  assert.equal(r.totales.tuMs, 70 * M);
  assert.equal(r.totales.respuestaMedianaMs, 2 * M);
});

test('en cero: mismos días y horas, sin datos', () => {
  const r = combinar([{ maquina: 'workstation', datos: enCero(ws.datos) }]);
  assert.equal(r.totales.tuMs, 0);
  assert.equal(r.proyectos.length, 0);
  assert.equal(r.dias.length, 1);
  assert.equal(r.horas.length, 1);
  assert.equal(r.totales.respuestaMedianaMs, null);
});
