// Días en hora local de la PC, como "AAAA-MM-DD".
const DIA = 86400e3;

const dos = (n) => String(n).padStart(2, '0');

function diaDe(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function inicioDe(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(a, m - 1, d).getTime();
}

function diaSiguiente(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  return diaDe(new Date(a, m - 1, d + 1).getTime());
}

function diasEntre(desde, hasta) {
  const out = [];
  for (let d = desde; d <= hasta && out.length < 1000; d = diaSiguiente(d)) out.push(d);
  return out;
}

// Reparte el intervalo [ini, fin) entre los días que toca: fn(dia, ms).
function porDia(ini, fin, fn) {
  let t = ini;
  while (t < fin) {
    const dia = diaDe(t);
    const corte = Math.min(fin, inicioDe(diaSiguiente(dia)));
    fn(dia, corte - t);
    t = corte;
  }
}

// Comienzo de la hora local que contiene ms, y el de la siguiente (respeta los cambios de horario).
function inicioHora(ms) {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function horaSiguiente(ms) {
  const d = new Date(inicioHora(ms));
  d.setHours(d.getHours() + 1);
  return d.getTime();
}

// Las horas de [ini, fin), como comienzo de cada una.
function horasEntre(ini, fin) {
  const out = [];
  for (let h = inicioHora(ini); h < fin && out.length < 24 * 1000; h = horaSiguiente(h)) out.push(h);
  return out;
}

// Reparte el intervalo [ini, fin) entre las horas que toca: fn(t, ms), con t dentro de esa hora.
function porHora(ini, fin, fn) {
  let t = ini;
  while (t < fin) {
    const corte = Math.min(fin, horaSiguiente(t));
    fn(t, corte - t);
    t = corte;
  }
}

module.exports = { DIA, diaDe, inicioDe, diaSiguiente, diasEntre, porDia, inicioHora, horasEntre, porHora };
