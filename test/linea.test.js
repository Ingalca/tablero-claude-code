// La línea de tiempo de la última hora, armada desde la bitácora.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { entorno } = require('./ayuda');

const { datos } = entorno();
const bitacora = require('../src/bitacora');
const { diaDe } = require('../src/fechas');

const M = 60e3;
const ahora = Date.now();
const id = 'aaaaaaaa-0000-0000-0000-000000000000';
const entradas = [
  [-90, 'idle'], // antes de la hora: sin trabajo previo, inactiva
  [-50, 'busy'],
  [-30, 'waiting'],
  [-29.5, 'busy'], // una espera de 30 s: igual pinta su minuto
  [-20, 'idle'], // terminó: "d" hasta T2 (10 min en la prueba), después "i"
];
const dir = path.join(datos, 'estados');
fs.mkdirSync(dir, { recursive: true });
for (const [min, s] of entradas) {
  const t = ahora + min * M;
  fs.appendFileSync(path.join(dir, `${diaDe(t)}.jsonl`), JSON.stringify({ t, id, c: 'd:/x', s, m: null }) + '\n');
}

test('minuto a minuto: inactiva, trabajando, la espera corta, terminó y vuelve a inactiva', () => {
  const linea = bitacora.lineasDeTiempo(ahora, 10 * M).get(id);
  assert.equal(linea.length, 60);
  assert.equal(linea.slice(0, 10), 'iiiiiiiiii'); // -60 a -50
  assert.equal(linea.slice(10, 30), 'r'.repeat(20)); // -50 a -30
  assert.equal(linea[30], 'w'); // la espera de 30 s
  assert.equal(linea.slice(31, 40), 'r'.repeat(9));
  assert.equal(linea.slice(40, 50), 'd'.repeat(10)); // T2 = 10 min
  assert.equal(linea.slice(50), 'i'.repeat(10));
});

test('una sesión sin entradas no tiene línea', () => {
  assert.equal(bitacora.lineasDeTiempo(ahora, 10 * M).get('bbbbbbbb-0000-0000-0000-000000000000'), undefined);
});
