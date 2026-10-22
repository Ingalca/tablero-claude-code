// macOS y Linux: sin probar. Alcanza para que el agente arranque y muestre el estado de las
// sesiones (el registro y los transcripts de Claude Code son iguales en todos los sistemas).
// Lo que falta para que funcione completo está marcado abajo; es el lugar para aportar.
const { execFile } = require('child_process');

// Falta: hora de inicio del proceso (ps -o lstart= -p <pid>) para descartar archivos huérfanos.
// Mientras tanto se confía en que el pid vivo es el de la sesión.
async function horaInicioProceso() {
  return null;
}

// Falta: inactividad y ventana al frente (macOS: ioreg + osascript; Linux/X11: xprintidle + xdotool).
function iniciarMuestreoActividad(onMuestra, log) {
  log('actividad: todavía no está disponible en esta plataforma; "tu tiempo" queda en cero');
}

// Falta: activar la ventana de la carpeta. Sin esto, enfocar usa `code <carpeta>`.
async function activarVentana() {
  return 'no-soportado';
}

// Falta: activar la ventana de la terminal de un proceso, y saber qué terminal es.
async function activarTerminal() {
  return 'no-soportado';
}
async function anfitrionTerminal() {
  return null;
}

function code(args) {
  return new Promise((resolve, reject) => {
    execFile('code', args, { timeout: 20000 }, (err) => (err ? reject(err) : resolve()));
  });
}

module.exports = { horaInicioProceso, iniciarMuestreoActividad, activarVentana, activarTerminal, anfitrionTerminal, code };
