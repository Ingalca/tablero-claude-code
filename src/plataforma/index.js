// Todo lo que depende del sistema operativo pasa por acá. Para portar el tablero a otro sistema,
// alcanza con implementar estas cuatro funciones (ver otros.js):
//   horaInicioProceso(pid)                 → Promise<string|null>  hora de inicio, como FILETIME
//   iniciarMuestreoActividad(onMuestra, log)                         cada ~15 s: { idle, titulo, proceso }
//   activarVentana(carpeta)                → Promise<'ok'|'sin-foco'|'no-encontrada'|'no-soportado'|'error'>
//   activarTerminal(pid, titulo)           → Promise<lo mismo, o 'ambigua'>   la terminal de ese proceso
//   anfitrionTerminal(pid)                 → Promise<string|null>  WindowsTerminal | mintty | conhost | Code
//   code(args)                             → Promise                el CLI de VS Code
module.exports = process.platform === 'win32' ? require('./windows') : require('./otros');
