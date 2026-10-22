// Tu presencia frente a la PC: datos/actividad/AAAA-MM-DD.jsonl, una línea por minuto con
// { t, idle (mínimo de segundos sin teclado ni mouse en ese minuto), foco }.
// foco es "p:<carpeta>" si al frente estaba una ventana de VS Code, o "a:<programa>" si era otra cosa.
// No se guarda el título de la ventana: puede tener nombres de archivos de clientes.
const fs = require('fs');
const path = require('path');
const { DIR_DATOS } = require('./config');
const { diaDe } = require('./fechas');
const plataforma = require('./plataforma');

const DIR = path.join(DIR_DATOS, 'actividad');
const MIN = 60e3;

let minuto = null; // { t, idle, focos: Map<foco, muestras> }

// VS Code titula sus ventanas "<editor activo> - <carpeta> - Visual Studio Code".
function focoDe({ titulo, proceso }) {
  if (!proceso) return null;
  if (/^code$/i.test(proceso)) {
    const partes = String(titulo ?? '').split(' - ');
    const app = partes.findLastIndex((p) => p.startsWith('Visual Studio Code'));
    return app >= 1 ? `p:${partes[app - 1].trim()}` : 'a:code';
  }
  return `a:${proceso.toLowerCase()}`;
}

function volcar() {
  if (!minuto) return;
  const [foco] = [...minuto.focos].sort((a, b) => b[1] - a[1])[0] ?? [null];
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(path.join(DIR, `${diaDe(minuto.t)}.jsonl`), JSON.stringify({ t: minuto.t, idle: minuto.idle, foco }) + '\n');
  minuto = null;
}

function registrar(muestra) {
  const t = Math.floor(Date.now() / MIN) * MIN;
  if (minuto && minuto.t !== t) volcar();
  minuto ??= { t, idle: Infinity, focos: new Map() };
  if (Number.isFinite(muestra.idle)) minuto.idle = Math.min(minuto.idle, muestra.idle);
  const foco = focoDe(muestra);
  minuto.focos.set(foco, (minuto.focos.get(foco) ?? 0) + 1);
}

// Solo si config.json tiene "registrarActividad": true. Mide presencia, no contenido, pero es
// información personal: en una herramienta pública tiene que ser algo que cada uno elige activar.
function iniciar(cfg, log) {
  if (!cfg.registrarActividad) {
    log('actividad: desactivada ("registrarActividad": false en config.json)');
    return;
  }
  if (process.env.TABLERO_DEMO === '1') return; // el demo trae su actividad inventada: no medir la real
  plataforma.iniciarMuestreoActividad(registrar, log);
  // Si dejan de llegar muestras (PC suspendida), cerrar igual el minuto en curso.
  setInterval(() => {
    if (minuto && Date.now() - minuto.t > 2 * MIN) volcar();
  }, MIN).unref();
}

function leerDias(dias) {
  const out = [];
  for (const d of dias) {
    let texto;
    try {
      texto = fs.readFileSync(path.join(DIR, `${d}.jsonl`), 'utf8');
    } catch {
      continue;
    }
    for (const l of texto.split('\n')) {
      try {
        if (l) out.push(JSON.parse(l));
      } catch {}
    }
  }
  return out;
}

function desde() {
  try {
    return fs.readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort()[0]?.slice(0, 10) ?? null;
  } catch {
    return null;
  }
}

module.exports = { iniciar, leerDias, desde, focoDe };
