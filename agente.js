// Agente del tablero: expone por HTTP el estado de las sesiones de Claude Code de esta PC.
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const servidor = require('./src/servidor');
const historial = require('./src/historial');
const bitacora = require('./src/bitacora');
const actividad = require('./src/actividad');
const peers = require('./src/peers');

const RUTA_LOG = path.join(config.DIR_DATOS, 'agente.log');
const SALIDA_PUERTO_OCUPADO = 3; // el lanzador de inicio no reintenta con este código

function log(msj) {
  const linea = `${new Date().toISOString()} ${msj}\n`;
  process.stdout.write(linea);
  try {
    if (fs.existsSync(RUTA_LOG) && fs.statSync(RUTA_LOG).size > 1024 * 1024) fs.renameSync(RUTA_LOG, RUTA_LOG + '.1');
    fs.appendFileSync(RUTA_LOG, linea);
  } catch {}
}

const cfg = config.cargar();
const srv = servidor.crear(cfg, log);
srv.on('error', (e) => {
  log(`no puedo escuchar en ${cfg.host}:${cfg.puerto}: ${e.message}`);
  process.exit(e.code === 'EADDRINUSE' ? SALIDA_PUERTO_OCUPADO : 1);
});
srv.listen(cfg.puerto, cfg.host, () => {
  log(`agente "${cfg.maquina}" escuchando en ${cfg.host}:${cfg.puerto}`);
  // Solo con el puerto tomado: si ya hay otro agente corriendo, este no debe anotar por duplicado.
  bitacora.iniciar(log);
  actividad.iniciar(cfg, log);
  historial.iniciar(log);
  peers.iniciar(cfg, log);
});
