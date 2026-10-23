// Lectura de transcripts: título, último mensaje e índice de turnos, huecos y tokens.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { entorno, escribirTranscript, pedido, usoDeHerramienta, resultado, texto } = require('./ayuda');

const { claude } = entorno();
const transcript = require('../src/transcript');
const historial = require('../src/historial');
const metricas = require('../src/metricas');
const { diaDe } = require('../src/fechas');

const M = 60e3;
const H = 3600e3;
const carpeta = 'd:\\proyecto';
const otraCarpeta = 'd:\\otro'; // las sesiones de las pruebas de títulos, para no mezclar sus tiempos
const t0 = Date.now() - 6 * H;

const SESION = '22222222-2222-2222-2222-222222222222';
escribirTranscript(claude, carpeta, SESION, [
  // VS Code mete bloques de contexto adelante del pedido: no tienen que ocultarlo.
  { ...pedido(t0, 'Arreglá el login'), message: { role: 'user', content: [{ type: 'text', text: '<ide_selection>x</ide_selection>' }, { type: 'text', text: 'Arreglá el login' }] } },
  { t: t0, type: 'ai-title', aiTitle: 'Arreglo del login' },
  usoDeHerramienta(t0 + 1 * M, 'h1', 'Bash'),
  resultado(t0 + 2 * M, 'h1'),
  // Te pregunta algo y contestás 2 h después: no es trabajo de Claude.
  usoDeHerramienta(t0 + 3 * M, 'q1', 'AskUserQuestion'),
  resultado(t0 + 3 * M + 2 * H, 'q1'),
  texto(t0 + 3 * M + 2 * H + M, 'Listo, quedó **arreglado**.'),
  // Notificación de una tarea de fondo: reanuda, pero no es un pedido tuyo.
  { t: t0 + 3 * H, type: 'user', turnOrigin: 'task_notification', promptSource: 'system', message: { role: 'user', content: '<task-notification>…</task-notification>' } },
  texto(t0 + 3 * H + M, 'La tarea terminó.'),
  pedido(t0 + 4 * H, 'Gracias'),
  { t: t0 + 4 * H, type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
  texto(t0 + 4 * H + M, 'De nada.'),
]);

test('título: el de la IA, y el último mensaje sin markdown', () => {
  const info = transcript.info(SESION, carpeta);
  assert.equal(info.titulo, 'Arreglo del login');
  assert.equal(info.ultimoMensaje, 'De nada.');
  assert.equal(info.huboTurno, true);
});

test('título puesto a mano gana sobre el de la IA', () => {
  const otra = '33333333-3333-3333-3333-333333333333';
  escribirTranscript(claude, otraCarpeta, otra, [
    pedido(t0, 'Hola'),
    { type: 'ai-title', aiTitle: 'Saludo' },
    { type: 'custom-title', customTitle: 'Mi sesión' },
    texto(t0 + M, 'Hola.'),
  ]);
  assert.equal(transcript.info(otra, otraCarpeta).titulo, 'Mi sesión');
});

test('sin títulos: el primer pedido, sin los bloques de contexto de VS Code', () => {
  const otra = '44444444-4444-4444-4444-444444444444';
  escribirTranscript(claude, otraCarpeta, otra, [
    { ...pedido(t0, 'x'), message: { role: 'user', content: [{ type: 'text', text: '<ide_opened_file>a.js</ide_opened_file>' }, { type: 'text', text: 'Revisá a.js' }] } },
    texto(t0 + M, 'Ok.'),
  ]);
  assert.equal(transcript.info(otra, otraCarpeta).titulo, 'Revisá a.js');
});

test('historial: turnos, huecos y tokens sin contar dos veces un mensaje', async () => {
  await historial.actualizar();
  const a = Object.values(historial.datos().archivos).find((x) => x.sesion === SESION);
  const turnos = [...a.turnos, a.abierto];
  assert.equal(turnos.length, 3);
  assert.deepEqual(turnos.map((t) => t[2]), [1, 0, 1]); // pedido, notificación, pedido
  const [primero] = turnos;
  assert.deepEqual(primero[4].map((h) => h[2]), ['p']); // el hueco tras la pregunta
  assert.deepEqual(primero[3], [10 + 5 + 10 + 5 + 10, 100 + 100 + 50, 20 + 20 + 30]);
});

test('métricas: la espera por tu respuesta no cuenta como trabajo de Claude', async () => {
  await historial.actualizar();
  const cfg = { minutosSinVer: 60, minutosInactividad: 5, minutosArrastre: 10 };
  const dias = [diaDe(t0), diaDe(Date.now())];
  const r = metricas.calcular(cfg, dias[0] < dias[1] ? dias[0] : dias[1], dias[1]);
  const p = r.proyectos.find((x) => x.proyecto === 'proyecto');
  // Primer turno: 2 h 4 min de largo, menos 2 h de pregunta = 4 min. Notificación: 1 min. Último: 1 min.
  assert.equal(Math.round(p.claudeMs / M), 6);
  assert.equal(p.pedidos, 2);
});

test('modo: el permissionMode del último pedido', () => {
  const otra = '55555555-5555-5555-5555-555555555555';
  escribirTranscript(claude, otraCarpeta, otra, [
    pedido(t0, 'Planeemos', { permissionMode: 'plan' }),
    texto(t0 + M, 'Este es el plan.'),
    pedido(t0 + 2 * M, 'Dale', { permissionMode: 'acceptEdits' }),
    texto(t0 + 3 * M, 'Hecho.'),
  ]);
  assert.equal(transcript.info(otra, otraCarpeta).modo, 'acceptEdits');
});

test('modo: lo encuentra aunque el pedido haya quedado fuera de la cola', () => {
  const otra = '66666666-6666-6666-6666-666666666666';
  const salidaLarga = (t, id) => ({ ...resultado(t, id), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(300 * 1024) }] } });
  escribirTranscript(claude, otraCarpeta, otra, [
    pedido(t0, 'Sacá capturas', { permissionMode: 'plan' }),
    usoDeHerramienta(t0 + M, 'c1', 'Bash'),
    salidaLarga(t0 + 2 * M, 'c1'),
    usoDeHerramienta(t0 + 3 * M, 'c2', 'Bash'),
    salidaLarga(t0 + 4 * M, 'c2'),
    texto(t0 + 5 * M, 'Listas.'),
  ]);
  assert.equal(transcript.info(otra, otraCarpeta).modo, 'plan');
});

test('métricas por hora: suman exactamente lo mismo que por día', async () => {
  await historial.actualizar();
  const cfg = { minutosSinVer: 60, minutosInactividad: 5, minutosArrastre: 10 };
  const hoy = diaDe(Date.now());
  const r = metricas.calcular(cfg, diaDe(t0) < hoy ? diaDe(t0) : hoy, hoy);
  for (const campo of ['claudeMs', 'activoMs', 'esperaMs', 'conEsperaMs', 'pedidos', 'tuMs']) {
    const porHora = r.horas.reduce((s, h) => s + h[campo], 0);
    const porDia = r.dias.reduce((s, d) => s + d[campo], 0);
    assert.equal(porHora, porDia, campo);
    assert.equal(porDia, r.totales[campo], campo);
  }
  assert.ok(r.horas.every((h) => h.hora >= 0 && h.hora < 24));
});

// Contexto: la entrada del último mensaje de Claude (con caché), en la ventana de su modelo.
const CONTEXTO = '77777777-7777-7777-7777-777777777777';
const conUso = (t, modelo, usados, extra = {}) => ({
  t, type: 'assistant', ...extra,
  message: { id: `c-${t}`, model: modelo, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1000, cache_creation_input_tokens: 4000, cache_read_input_tokens: usados - 5000, output_tokens: 300 } },
});
test('contexto: la entrada del último mensaje, sin subagentes ni mensajes sintéticos', () => {
  escribirTranscript(claude, 'd:\contexto', CONTEXTO, [
    pedido(t0, 'Hola'),
    conUso(t0 + M, 'claude-opus-5-5', 412000),
    conUso(t0 + 2 * M, 'claude-haiku-4-5', 90000, { isSidechain: true }),
    conUso(t0 + 3 * M, '<synthetic>', 1),
  ]);
  assert.deepEqual(transcript.info(CONTEXTO, 'd:\contexto').contexto, { usados: 412000, ventana: 1000000 });
});
test('contexto: después de compactar, lo que quedó', () => {
  escribirTranscript(claude, 'd:\contexto', CONTEXTO, [
    pedido(t0, 'Hola'),
    conUso(t0 + M, 'claude-opus-5-5', 960000),
    { t: t0 + 2 * M, type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 960000, postTokens: 16000 } },
  ]);
  assert.deepEqual(transcript.info(CONTEXTO, 'd:\contexto').contexto, { usados: 16000, ventana: 1000000 });
});
test('ventana: 1M en los modelos actuales, 200K en Haiku y en los que no superaron eso', () => {
  for (const m of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5[1m]']) {
    assert.equal(transcript.ventanaDe(m, 1000), 1000000, m);
  }
  assert.equal(transcript.ventanaDe('claude-haiku-4-5', 1000), 200000);
  assert.equal(transcript.ventanaDe('claude-sonnet-4-5', 150000), 200000);
  assert.equal(transcript.ventanaDe('modelo-nuevo', 250000), 1000000); // si pasó los 200K, la ventana es mayor
});
