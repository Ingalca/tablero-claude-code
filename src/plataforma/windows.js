// Lo que depende de Windows. La interfaz es la misma que la de otros.js; index.js elige.
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');

const SCRIPT_ACTIVIDAD = path.join(__dirname, 'windows', 'actividad.ps1');
const SCRIPT_VENTANAS = path.join(__dirname, 'windows', 'ventanas.ps1');
const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

// Hora de inicio de un proceso como FILETIME (centenas de ns desde 1601), o null si no se pudo leer.
// Es el formato de "procStart" en el registro de sesiones de Claude Code.
function horaInicioProceso(pid) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [...POWERSHELL, '-Command', `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToFileTimeUtc()`],
      { windowsHide: true, timeout: 15000 },
      (err, out) => resolve(err || !/^\d+$/.test(out.trim()) ? null : out.trim()),
    );
  });
}

// Muestreo de actividad cada 15 s: onMuestra({ idle, titulo, proceso }). Se relanza si se cae.
function iniciarMuestreoActividad(onMuestra, log) {
  let ps = null;
  process.on('exit', () => ps?.kill());
  const lanzar = () => {
    ps = spawn('powershell.exe', [...POWERSHELL, '-File', SCRIPT_ACTIVIDAD], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    porLineas(ps.stdout, (linea) => {
      try {
        onMuestra(JSON.parse(linea));
      } catch {}
    });
    ps.stderr.on('data', (c) => log(`actividad: ${String(c).trim().slice(0, 200)}`));
    ps.on('exit', (codigo) => {
      log(`actividad: el muestreo terminó (código ${codigo}); se relanza en 30 s`);
      setTimeout(lanzar, 30e3).unref();
    });
  };
  lanzar();
}

// El ayudante de ventanas queda corriendo (compilar su C# tarda ~1 s): un pedido por línea, con los
// campos separados por tabulador, y una respuesta por línea. Ver ventanas.ps1.
let ayudante = null;
let pendientes = [];

function lanzarAyudante() {
  const ps = spawn('powershell.exe', [...POWERSHELL, '-File', SCRIPT_VENTANAS], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  porLineas(ps.stdout, (linea) => pendientes.shift()?.(linea));
  ps.on('exit', () => {
    ayudante = null;
    for (const r of pendientes) r('error');
    pendientes = [];
  });
  return ps;
}

function pedir(...campos) {
  ayudante ??= lanzarAyudante();
  const ps = ayudante;
  const linea = campos.map((c) => String(c ?? '').replace(/[\t\r\n]/g, ' ')).join('\t');
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('error'), 8000);
    pendientes.push((r) => {
      clearTimeout(timer);
      resolve(r);
    });
    ps.stdin.write(linea + '\n', 'utf8');
  });
}

// Activa la ventana de VS Code de una carpeta: ok | sin-foco | no-encontrada | error.
function activarVentana(carpeta) {
  return pedir('carpeta', path.basename(carpeta));
}

// Activa la ventana de la terminal donde corre ese proceso: ok | sin-foco | no-encontrada | ambigua | error.
function activarTerminal(pid, titulo) {
  return pedir('terminal', Number(pid), titulo);
}

// Qué programa muestra la terminal de ese proceso: WindowsTerminal | mintty | conhost | Code | null.
// No cambia mientras el proceso vive: se pregunta una vez.
const anfitriones = new Map();
function anfitrionTerminal(pid) {
  if (!anfitriones.has(pid)) {
    anfitriones.set(pid, pedir('anfitrion', Number(pid)).then((r) => (r && r !== 'error' ? r : null)));
    if (anfitriones.size > 200) anfitriones.delete(anfitriones.keys().next().value);
  }
  return anfitriones.get(pid);
}

function ubicarCodeCmd() {
  try {
    return execFileSync('where.exe', ['code.cmd'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim();
  } catch {
    const tipico = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
    if (fs.existsSync(tipico)) return tipico;
    throw new Error('No encuentro code.cmd: ¿VS Code está en el PATH?');
  }
}

// El CLI de VS Code. code.cmd apunta a una carpeta con el hash de la versión, que cambia en cada
// actualización: se relee siempre. Se llama a Code.exe + cli.js como hace code.cmd, sin pasar por un shell.
function code(args) {
  const cmd = ubicarCodeCmd();
  const bin = path.dirname(cmd);
  const m = fs.readFileSync(cmd, 'utf8').match(/"%~dp0([^"]*Code\.exe)"\s+"%~dp0([^"]*cli\.js)"/i);
  if (!m) throw new Error(`No entiendo el formato de ${cmd}`);
  return new Promise((resolve, reject) => {
    execFile(
      path.resolve(bin, m[1]),
      [path.resolve(bin, m[2]), ...args],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' }, windowsHide: true, timeout: 20000 },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

function porLineas(stream, fn) {
  let resto = '';
  stream.setEncoding('utf8');
  stream.on('data', (c) => {
    resto += c;
    let i;
    while ((i = resto.indexOf('\n')) !== -1) {
      const linea = resto.slice(0, i).trim();
      resto = resto.slice(i + 1);
      if (linea) fn(linea);
    }
  });
}

process.on('exit', () => ayudante?.kill());

module.exports = { horaInicioProceso, iniciarMuestreoActividad, activarVentana, activarTerminal, anfitrionTerminal, code };
