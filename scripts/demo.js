// Modo demo: arma sesiones, transcripts y actividad inventados (con tiempos relativos a ahora) en
// una carpeta temporal y levanta el agente ahí, en http://localhost:4599. No lee ni toca tus datos.
//   node scripts/demo.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { diaDe } = require('../src/fechas');

const PUERTO = 4599;
const MAQUINA = 'workstation';
const M = 60e3;
const H = 3600e3;
const ahora = Date.now();

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'tablero-demo-'));
const claude = path.join(raiz, 'claude');
const datos = path.join(raiz, 'datos');
for (const d of [path.join(claude, 'sessions'), path.join(claude, 'projects'), path.join(datos, 'actividad'), path.join(datos, 'estados')]) {
  fs.mkdirSync(d, { recursive: true });
}

// Números al azar pero siempre los mismos, para que las capturas no cambien entre corridas.
let semilla = 7;
const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
const uuid = () => crypto.randomUUID();
const carpetaDe = (p) => `C:\\proyectos\\${p}`;

function transcript(proyecto, sessionId, turnos, titulo, modo = 'auto') {
  const dir = path.join(claude, 'projects', carpetaDe(proyecto).replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const base = { cwd: carpetaDe(proyecto), sessionId };
  const lineas = [];
  const reg = (t, r) => lineas.push(JSON.stringify({ ...r, ...base, timestamp: new Date(t).toISOString() }));
  turnos.forEach(({ ini, dur, pedido, respuesta }, i) => {
    reg(ini, { type: 'user', turnOrigin: 'human', promptSource: 'sdk', permissionMode: modo, message: { role: 'user', content: [{ type: 'text', text: pedido }] } });
    if (i === 0 && titulo) lineas.push(JSON.stringify({ type: 'ai-title', aiTitle: titulo, sessionId }));
    const pasos = Math.max(1, Math.round(dur / (4 * M)));
    for (let k = 1; k <= pasos; k++) {
      const t = ini + (dur * k) / (pasos + 1);
      const id = `toolu_${i}_${k}`;
      reg(t, { type: 'assistant', message: { id: `msg_${i}_${k}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Edit', input: {} }], usage: { input_tokens: 800, cache_creation_input_tokens: 1200, cache_read_input_tokens: 40000, output_tokens: 600 + Math.round(azar() * 900) } } });
      reg(t + 20e3, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
    }
    if (respuesta) reg(ini + dur, { type: 'assistant', message: { id: `msg_${i}_fin`, role: 'assistant', content: [{ type: 'text', text: respuesta }], usage: { input_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 30000, output_tokens: 400 } } });
  });
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lineas.join('\n') + '\n');
}

let pid = 40000;
// historia: [[minutos atrás, status], …] para la bitácora, que arma la línea de tiempo de la última hora.
function sesionAbierta(proyecto, { titulo, estado, desde, motivo, pedido, respuesta, progreso, modo, entrypoint = 'claude-vscode', dur = 20 * M, historia = [] }) {
  const sessionId = uuid();
  const fin = estado === 'busy' || estado === 'waiting' ? ahora : desde;
  const ini = estado === 'busy' || estado === 'waiting' ? desde : desde - dur;
  transcript(proyecto, sessionId, [{ ini: ini - 2 * H, dur: 25 * M, pedido: 'Revisemos cómo está armado esto', respuesta: 'Listo, te dejo el resumen.' }, { ini, dur: fin - ini, pedido, respuesta: estado === 'idle' ? respuesta : progreso }], titulo, modo);
  for (const [atras, st] of historia) {
    const t = ahora - atras * M;
    fs.appendFileSync(path.join(datos, 'estados', `${diaDe(t)}.jsonl`), JSON.stringify({ t, id: sessionId, c: carpetaDe(proyecto), s: st, m: st === 'waiting' ? 'permission prompt' : null }) + '\n');
  }
  fs.writeFileSync(path.join(claude, 'sessions', `${++pid}.json`), JSON.stringify({
    pid, sessionId, cwd: carpetaDe(proyecto), startedAt: ini - 3 * H, kind: 'interactive', entrypoint,
    version: '2.1.283', name: `${proyecto}-${pid % 100}`, status: estado, ...(motivo && { waitingFor: motivo }), statusUpdatedAt: desde, updatedAt: desde,
  }));
}

sesionAbierta('api-pagos', { titulo: 'Webhook de pagos duplicados', historia: [[48, 'busy'], [30, 'idle'], [22, 'busy'], [4, 'waiting']], estado: 'waiting', motivo: 'permission prompt', modo: 'default', desde: ahora - 4 * M, pedido: 'Los webhooks del procesador llegan duplicados', progreso: 'El procesador reintenta si no respondemos en 5 s. Voy a agregar una clave de idempotencia; necesito correr la migración.' });
sesionAbierta('tienda-online', { titulo: 'Checkout en un solo paso', historia: [[55, 'busy'], [31, 'idle'], [29, 'busy'], [25, 'waiting'], [24, 'busy'], [7, 'idle']], modo: 'acceptEdits', estado: 'idle', desde: ahora - 7 * M, pedido: 'Unifiquemos el checkout', respuesta: 'Quedó el checkout en un paso: envío y pago en la misma pantalla. Corrí los tests de punta a punta y pasan. Falta revisar el texto legal del pie.' });
sesionAbierta('tienda-online', { titulo: 'Caché de imágenes de producto', historia: [[36, 'busy'], [30, 'idle'], [18, 'busy']], estado: 'busy', desde: ahora - 12 * M, pedido: 'Las fotos de producto tardan en cargar', progreso: 'Las imágenes se sirven sin cabeceras de caché. Pruebo con un CDN delante del bucket.' });
sesionAbierta('app-movil', { titulo: 'Notificaciones push en Android', historia: [[20, 'busy'], [12, 'idle'], [3, 'busy']], entrypoint: 'cli', estado: 'busy', desde: ahora - 3 * M, pedido: 'No llegan las push en Android 15', progreso: 'Android 15 pide el permiso de notificaciones en tiempo de ejecución. Reviso dónde se solicita.' });
sesionAbierta('sitio-institucional', { titulo: 'Formulario de contacto', historia: [[58, 'busy'], [35, 'waiting'], [33, 'busy'], [21, 'idle']], modo: 'plan', estado: 'idle', desde: ahora - 21 * M, pedido: 'El formulario no envía', respuesta: 'Era el captcha: el dominio nuevo no estaba autorizado. Lo agregué y el envío funciona; te dejo el cambio sin commitear para que lo revises.' });
sesionAbierta('panel-admin', { titulo: 'Exportación de reportes a Excel', estado: 'idle', desde: ahora - 11 * H, pedido: 'Exportar reportes', respuesta: 'La exportación ya respeta los filtros activos.' });
sesionAbierta('panel-admin', { titulo: 'Permisos por rol', estado: 'idle', desde: ahora - 30 * H, pedido: 'Roles', respuesta: 'Roles listos.' });

// Historia de la última semana: sesiones ya cerradas, solo con transcript.
const proyectos = ['tienda-online', 'api-pagos', 'app-movil', 'sitio-institucional', 'panel-admin'];
const hoy0 = new Date(ahora).setHours(0, 0, 0, 0);
for (let d = 6; d >= 0; d--) {
  const dia = hoy0 - d * 24 * H;
  for (const [j, p] of proyectos.entries()) {
    if (azar() < 0.3) continue;
    const turnos = [];
    let t = dia + (9 + j * 1.5 + azar()) * H;
    for (let k = 0; k < 2 + Math.round(azar() * 4); k++) {
      const dur = (8 + azar() * 30) * M;
      if (t + dur > ahora - H) break;
      turnos.push({ ini: t, dur, pedido: 'Sigamos', respuesta: 'Hecho.' });
      t += dur + (3 + azar() * 25) * M;
    }
    if (turnos.length) transcript(p, uuid(), turnos);
  }
  // Tu actividad: minutos frente a la PC repartidos entre proyectos, con algún rato en el navegador.
  const lineas = [];
  for (let m = 9 * 60; m < 18.5 * 60; m++) {
    const t = dia + m * M;
    if (t > ahora) break;
    if (azar() < 0.18) continue;
    const foco = azar() < 0.2 ? 'a:firefox' : `p:${proyectos[Math.floor((m / 90) % proyectos.length)]}`;
    lineas.push(JSON.stringify({ t, idle: Math.round(azar() * 60), foco }));
  }
  if (lineas.length) fs.writeFileSync(path.join(datos, 'actividad', `${diaDe(dia)}.jsonl`), lineas.join('\n') + '\n');
}

fs.writeFileSync(path.join(datos, 'fijadas.json'), JSON.stringify([
  { maquina: MAQUINA, carpeta: carpetaDe('tienda-online'), proyecto: 'tienda-online' },
  { maquina: MAQUINA, carpeta: carpetaDe('api-pagos'), proyecto: 'api-pagos' },
]));
fs.writeFileSync(path.join(raiz, 'config.json'), JSON.stringify({
  maquina: MAQUINA, host: '127.0.0.1', puerto: PUERTO, token: crypto.randomBytes(24).toString('base64url'), registrarActividad: true, // muestra la actividad inventada; en modo demo no se mide la real
}));

process.env.CLAUDE_CONFIG_DIR = claude;
process.env.TABLERO_DATOS = datos;
process.env.TABLERO_CONFIG = path.join(raiz, 'config.json');
process.env.TABLERO_DEMO = '1';
console.log(`Demo en http://localhost:${PUERTO} (datos en ${raiz})`);
require('../agente');
