// Entorno aislado para las pruebas: una carpeta temporal que hace de ~/.claude y otra de datos/.
// Se llama ANTES de requerir cualquier módulo de src/, porque leen las rutas al cargarse.
const fs = require('fs');
const os = require('os');
const path = require('path');

function entorno() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'tablero-test-'));
  const claude = path.join(raiz, 'claude');
  const datos = path.join(raiz, 'datos');
  fs.mkdirSync(path.join(claude, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'projects'), { recursive: true });
  fs.mkdirSync(datos, { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = claude;
  process.env.TABLERO_DATOS = datos;
  process.env.TABLERO_CONFIG = path.join(raiz, 'config.json');
  return { raiz, claude, datos };
}

// Un transcript con el formato de Claude Code. Cada registro: { t (ms), ...campos }.
function escribirTranscript(claude, carpeta, sessionId, registros) {
  const dir = path.join(claude, 'projects', carpeta.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const ruta = path.join(dir, `${sessionId}.jsonl`);
  const lineas = registros.map(({ t, ...r }) => JSON.stringify({ ...r, ...(t !== undefined && { timestamp: new Date(t).toISOString() }), cwd: carpeta, sessionId }));
  fs.writeFileSync(ruta, lineas.join('\n') + '\n');
  return ruta;
}

// Registros típicos.
const pedido = (t, texto, extra = {}) => ({ t, type: 'user', turnOrigin: 'human', promptSource: 'sdk', message: { role: 'user', content: [{ type: 'text', text: texto }] }, ...extra });
const usoDeHerramienta = (t, id, nombre, msgId = `m-${id}`) => ({
  t,
  type: 'assistant',
  message: { id: msgId, role: 'assistant', content: [{ type: 'tool_use', id, name: nombre, input: {} }], usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 20 } },
});
const resultado = (t, id) => ({ t, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const texto = (t, contenido, msgId = `m-${t}`) => ({
  t,
  type: 'assistant',
  message: { id: msgId, role: 'assistant', content: [{ type: 'text', text: contenido }], usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 50, output_tokens: 30 } },
});

module.exports = { entorno, escribirTranscript, pedido, usoDeHerramienta, resultado, texto };
