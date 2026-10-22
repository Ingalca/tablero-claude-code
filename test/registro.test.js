// Registro de sesiones: qué archivos se toman y cuáles se descartan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { entorno } = require('./ayuda');

const { claude } = entorno();
const registro = require('../src/registro');

const dir = path.join(claude, 'sessions');
const sesion = (n) => `${String(n).repeat(8)}-0000-0000-0000-000000000000`;
const escribir = (nombre, contenido) => fs.writeFileSync(path.join(dir, nombre), typeof contenido === 'string' ? contenido : JSON.stringify(contenido));
const base = { cwd: 'd:\\proyecto', kind: 'interactive', status: 'idle', entrypoint: 'claude-vscode' };

escribir('1.json', { ...base, pid: process.pid, sessionId: sesion(1) }); // vivo, sin procStart
escribir('2.json', { ...base, pid: 999999, sessionId: sesion(2) }); // muerto
escribir('3.json', { ...base, pid: process.pid, sessionId: sesion(3), kind: 'bg' }); // de fondo
escribir('4.json', { ...base, pid: process.pid, sessionId: 'no-es-un-uuid' });
escribir('5.json', '{"pid": 5, "sessio'); // a medio escribir
escribir('6.json', { ...base, pid: process.pid, sessionId: sesion(6), procStart: '1' }); // pid reutilizado: arrancó en 1601
escribir('otra-cosa.txt', 'x');

test('toma solo sesiones interactivas vivas y bien formadas', async () => {
  const ids = (await registro.leer()).map((s) => s.sessionId).sort();
  // En Windows se verifica la hora de inicio del proceso, y el 6 queda afuera por huérfano.
  const esperado = process.platform === 'win32' ? [sesion(1)] : [sesion(1), sesion(6)];
  assert.deepEqual(ids, esperado);
});
