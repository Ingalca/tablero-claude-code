const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
// Las rutas se pueden cambiar por variables de entorno: lo usan las pruebas y el modo demo.
const RUTA = process.env.TABLERO_CONFIG ?? path.join(RAIZ, 'config.json');
const DIR_DATOS = process.env.TABLERO_DATOS ?? path.join(RAIZ, 'datos');
// Donde Claude Code guarda sus sesiones. CLAUDE_CONFIG_DIR es la misma variable que respeta Claude Code.
const DIR_CLAUDE = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');

const DEFAULTS = {
  maquina: os.hostname().toLowerCase(),
  host: '127.0.0.1', // solo esta PC; para sumar otras PCs, "0.0.0.0" (ver docs/varias-pcs.md)
  puerto: 4590,
  token: '',
  peers: [], // las otras PCs: nombre, nombre:puerto, IP o URL (ej. ["notebook"])
  minutosTrasVer: 5, // T: tras el click en la tarjeta, "terminó" pasa a inactiva
  minutosSinVer: 60, // T2: sin click, "terminó" pasa a inactiva igual
  horasInactivasVisibles: 8, // N: hasta acá, en la grilla; después, en el desplegable
  horasInactivasPlegadas: 24, // después de esto, solo el nombre en la lista de abajo
  largoExtracto: 160,
  registrarActividad: false, // tu tiempo: registra teclado/mouse y ventana al frente; hay que activarlo
  minutosInactividad: 5, // tu tiempo: sin teclado ni mouse por más de esto, el minuto no cuenta
  minutosArrastre: 10, // tu tiempo: un programa de la lista de abajo suma al último proyecto si fue hace menos de esto
  programasQueSuman: [], // tu tiempo: programas que cuentan como trabajo en el proyecto (ej. ["firefox", "windowsterminal"])
};

// Lee config.json. La primera vez lo crea con un token al azar, que hay que copiar a la otra PC.
function cargar() {
  fs.mkdirSync(DIR_DATOS, { recursive: true });
  if (!fs.existsSync(RUTA)) {
    const nueva = { ...DEFAULTS, token: crypto.randomBytes(24).toString('base64url') };
    fs.writeFileSync(RUTA, JSON.stringify(nueva, null, 2) + '\n');
  }
  // Sin el BOM que agregan algunos editores al guardar en UTF-8 (JSON.parse no lo acepta).
  const cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(RUTA, 'utf8').replace(/^\uFEFF/, '')) };
  if (typeof cfg.token !== 'string' || cfg.token.length < 16) {
    throw new Error('config.json: "token" tiene que tener al menos 16 caracteres');
  }
  return cfg;
}

module.exports = { cargar, DIR_DATOS, DIR_CLAUDE };
