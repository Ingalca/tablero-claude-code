// Tarjetas fijadas por el usuario, en su orden. Viven en el agente (no en el navegador)
// para que el orden sobreviva a un borrado de datos del navegador.
const fs = require('fs');
const path = require('path');
const { DIR_DATOS } = require('./config');

const RUTA = path.join(DIR_DATOS, 'fijadas.json');
const MAXIMO = 100;

function leer() {
  try {
    return JSON.parse(fs.readFileSync(RUTA, 'utf8'));
  } catch {
    return [];
  }
}

// Cada una: { maquina, carpeta, proyecto }. Se valida todo: viene del navegador.
function guardar(lista) {
  if (!Array.isArray(lista) || lista.length > MAXIMO) throw new Error('lista de fijadas inválida');
  const texto = (v) => typeof v === 'string' && v.length > 0 && v.length <= 300;
  const limpia = lista.map((f) => {
    if (!texto(f?.maquina) || !texto(f?.carpeta) || !texto(f?.proyecto)) throw new Error('fijada inválida');
    return { maquina: f.maquina, carpeta: f.carpeta, proyecto: f.proyecto };
  });
  fs.writeFileSync(RUTA, JSON.stringify(limpia, null, 2));
  return limpia;
}

module.exports = { leer, guardar };
