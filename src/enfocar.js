// Trae al frente la sesión: su ventana y, en VS Code, la pestaña exacta.
//
// Sesión de VS Code:
//  1. La plataforma busca la ventana de la carpeta por su título y la activa (en Windows, ver ventanas.ps1).
//  2. Si quedó activa, se abre vscode://anthropic.claude-code/open?session=<id>: la extensión
//     revela la pestaña de esa sesión, que ya está abierta. VS Code le pasa el URI a la última
//     ventana activa, por eso solo se manda si la activación funcionó: si cayera en otra ventana,
//     abriría ahí una copia de la sesión. La primera vez, VS Code pide permiso para abrirlo.
//  3. Si no encuentra la ventana (otro formato de título, u otro sistema), `code <carpeta>`, que la
//     enfoca sin abrir otra.
//
// Sesión de terminal: se activa la ventana que muestra la consola de ese proceso (Windows Terminal,
// la consola clásica o Git Bash). No hay forma de elegir la pestaña dentro de la terminal. Si corre
// en la terminal integrada de VS Code, se activa la ventana de VS Code de esa carpeta. Nunca abre
// una ventana nueva.
const fs = require('fs');
const plataforma = require('./plataforma');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Devuelve: pestaña | ventana | sin-foco (Windows no dejó activarla) | no-encontrada | ambigua.
async function enfocar(sesion) {
  if (process.env.TABLERO_DEMO === '1') return 'demo'; // las carpetas del demo no existen
  if (sesion.origen === 'terminal') return enfocarTerminal(sesion);

  const { carpeta, id } = sesion;
  if (!fs.statSync(carpeta).isDirectory()) throw new Error(`No es una carpeta: ${carpeta}`);
  const resultado = await plataforma.activarVentana(carpeta);
  if (resultado === 'ok') {
    if (UUID.test(id ?? '')) {
      await esperar(250); // que VS Code registre cuál es su ventana activa antes de recibir el URI
      await plataforma.code(['--open-url', `vscode://anthropic.claude-code/open?session=${id}`]);
    }
    return 'pestaña';
  }
  if (resultado === 'sin-foco') return resultado;
  await plataforma.code([carpeta]);
  return 'ventana';
}

async function enfocarTerminal({ pid, carpeta, titulo, anfitrion }) {
  // Claude Code titula la terminal con el título de la sesión: sirve para encontrar la ventana de Git Bash.
  const resultado = await plataforma.activarTerminal(pid, (titulo ?? '').replace(/…$/, ''));
  if (resultado === 'ok') return 'ventana';
  if (resultado === 'sin-foco' || resultado === 'ambigua') return resultado;
  if (anfitrion === 'Code' && (await plataforma.activarVentana(carpeta)) === 'ok') return 'ventana';
  return 'no-encontrada';
}

module.exports = { enfocar };
