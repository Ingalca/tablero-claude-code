// Métricas de un rango de días, calculadas al consultar a partir de lo que guardan historial,
// bitácora y actividad. Como lo guardado son señales en bruto, cambiar un umbral recalcula la historia.
//
// Por proyecto (nombre de la carpeta), por día y por hora:
//   tuMs        tu tiempo: minutos en que estabas frente a la PC (ver atribuirTuTiempo)
//   claudeMs    Claude trabajando, sumando sesiones en paralelo, sin el tiempo bloqueado en aprobaciones
//   activoMs    horas con al menos una sesión trabajando (sin doble conteo)
//   conEsperaMs horas con al menos una sesión esperándote (sin doble conteo)
//   esperaMs    tiempo que Claude te esperó: del fin de un turno a tu siguiente pedido (con tope en T2),
//               más lo que estuvo parado dentro de un turno por una aprobación o una pregunta
//   pedidos     pedidos tuyos
//   tokens      [entrada, lectura de caché, salida], incluye subagentes
//   aprobaciones, bloqueoMs: veces y tiempo en "esperando" (solo desde que existe la bitácora)
const path = require('path');
const historial = require('./historial');
const bitacora = require('./bitacora');
const actividad = require('./actividad');
const { diaDe, inicioDe, diaSiguiente, diasEntre, inicioHora, horasEntre, porHora } = require('./fechas');

const MIN = 60e3;
// Un comando rara vez tarda más que esto: lo que pase de acá, con la herramienta pendiente,
// se toma como aprobación esperando (solo hace falta para la historia sin bitácora).
const HUECO_HERRAMIENTA = 15 * MIN;

const nombreDe = (carpeta) => carpeta.split(/[\\/]/).filter(Boolean).pop() ?? carpeta;

function filaVacia() {
  return { tuMs: 0, claudeMs: 0, activoMs: 0, esperaMs: 0, conEsperaMs: 0, pedidos: 0, tokens: [0, 0, 0], aprobaciones: 0, bloqueoMs: 0, respuestas: [] };
}

function mediana(v) {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

function unir(intervalos) {
  const o = intervalos.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of o) {
    const u = out[out.length - 1];
    if (u && a <= u[1]) u[1] = Math.max(u[1], b);
    else out.push([a, b]);
  }
  return out;
}

// Partes de un turno en que Claude te esperaba a vos y no trabajaba:
//  - lo que dice la bitácora (estado "esperando"), exacto, desde que existe;
//  - huecos tras una pregunta tuya pendiente (AskUserQuestion, ExitPlanMode): enteros;
//  - huecos con otra herramienta pendiente: lo que pase de HUECO_HERRAMIENTA (aprobación probable);
//  - huecos con un subagente pendiente: nada, puede estar trabajando de verdad.
function esperasDelTurno(huecos = [], bitacora = []) {
  const inferidas = huecos.flatMap(([a, b, tipo]) =>
    tipo === 'p' ? [[a, b]] : tipo === 'h' && b - a > HUECO_HERRAMIENTA ? [[a + HUECO_HERRAMIENTA, b]] : []);
  return unir([...inferidas, ...bitacora]);
}

function interseccion([a, b], lista) {
  return lista.map(([x, y]) => [Math.max(a, x), Math.min(b, y)]).filter(([x, y]) => y > x);
}

// [a, b) menos una lista de intervalos.
function restar([a, b], quitar) {
  if (b <= a) return [];
  let piezas = [[a, b]];
  for (const [qa, qb] of quitar) {
    piezas = piezas.flatMap(([pa, pb]) => (qb <= pa || qa >= pb ? [[pa, pb]] : [[pa, Math.min(pb, qa)], [Math.max(pa, qb), pb]].filter(([x, y]) => y > x)));
  }
  return piezas;
}

const recortar = ([a, b], ini, fin) => [Math.max(a, ini), Math.min(b, fin)];

// Intervalos "esperando" por sesión, armados con la bitácora: de cada entrada a "waiting" hasta el siguiente cambio.
function esperasPorSesion(entradas, ahora) {
  const porSesion = new Map();
  for (const e of entradas.sort((x, y) => x.t - y.t)) {
    if (!porSesion.has(e.id)) porSesion.set(e.id, []);
    porSesion.get(e.id).push(e);
  }
  const out = new Map();
  for (const [id, lista] of porSesion) {
    const esperas = [];
    lista.forEach((e, i) => {
      if (e.s === 'waiting') esperas.push({ ini: e.t, fin: lista[i + 1]?.t ?? ahora, carpeta: e.c, motivo: e.m });
    });
    out.set(id, esperas);
  }
  return out;
}

// Tu tiempo es solo tiempo en proyectos. Minuto a minuto:
//  1. Si no tocaste teclado ni mouse en más de `minutosInactividad`, ese minuto no cuenta.
//  2. Si al frente había una ventana de VS Code con una carpeta abierta, el minuto es de ese proyecto.
//  3. Si mandaste un pedido a Claude en ese minuto, es del proyecto del pedido (cubre la terminal).
//  4. Si al frente había un programa de `programasQueSuman` (el navegador, por ejemplo), es del último
//     proyecto en que estuviste, si fue hace menos de `minutosArrastre`.
//  5. Cualquier otro programa (WhatsApp, el correo…) no cuenta.
//  Cada minuto va a un solo proyecto, aunque haya varias sesiones trabajando.
function atribuirTuTiempo(minutos, pedidos, cfg, fn) {
  const umbral = cfg.minutosInactividad * 60;
  const arrastre = cfg.minutosArrastre * MIN;
  const suman = new Set((Array.isArray(cfg.programasQueSuman) ? cfg.programasQueSuman : []).map((p) => `a:${String(p).toLowerCase().replace(/\.exe$/, '')}`));
  const ps = [...pedidos].sort((a, b) => a.t - b.t);
  let j = 0;
  let ultimo = null;
  let ultimoEn = -Infinity;
  for (const m of [...minutos].sort((a, b) => a.t - b.t)) {
    let delPedido = null;
    while (j < ps.length && ps[j].t < m.t + MIN) {
      ultimo = ps[j].proyecto;
      ultimoEn = ps[j].t;
      if (ps[j].t >= m.t) delPedido = ps[j].proyecto;
      j++;
    }
    let proyecto = null;
    if (typeof m.foco === 'string' && m.foco.startsWith('p:') && m.foco.length > 2) {
      proyecto = m.foco.slice(2);
      ultimo = proyecto;
      ultimoEn = m.t;
    }
    if (!(m.idle <= umbral)) continue;
    proyecto ??= delPedido;
    if (!proyecto && suman.has(m.foco) && m.t - ultimoEn <= arrastre) proyecto = ultimo;
    if (proyecto) fn(proyecto, m.t);
  }
}

// conRespuestas: devuelve también los tiempos de respuesta crudos (respuestas), para que otra PC
// pueda combinar sus métricas con las de esta y sacar la mediana exacta del conjunto.
function calcular(cfg, desde, hasta, { conRespuestas = false } = {}) {
  const ahora = Date.now();
  const ini = inicioDe(desde);
  const fin = Math.min(inicioDe(diaSiguiente(hasta)), ahora);
  const dias = diasEntre(desde, hasta);
  const T2 = cfg.minutosSinVer * MIN;

  const proyectos = new Map(); // clave en minúsculas → { nombre, fila }
  const porDiaFilas = new Map(dias.map((d) => [d, filaVacia()]));
  // Por hora se calcula siempre, en todo rango: "Hoy" y "Ayer" la muestran, y queda para estadísticas de horario.
  const porHoraFilas = new Map(horasEntre(ini, inicioDe(diaSiguiente(hasta))).map((h) => [h, filaVacia()]));
  const total = filaVacia();
  const filaDe = (nombre) => {
    const k = nombre.toLowerCase();
    if (!proyectos.has(k)) proyectos.set(k, { nombre, fila: filaVacia() });
    return proyectos.get(k).fila;
  };
  // Suma en el proyecto, en el día y la hora del momento t, y en el total.
  const sumar = (nombre, t, campo, valor) => {
    const d = porDiaFilas.get(diaDe(t));
    if (!d) return;
    for (const f of [filaDe(nombre), d, porHoraFilas.get(inicioHora(t)), total]) {
      if (!f) continue;
      if (campo === 'tokens') for (let i = 0; i < 3; i++) f.tokens[i] += valor[i];
      else if (campo === 'respuestas') f.respuestas.push(valor);
      else f[campo] += valor;
    }
  };

  // Aprobaciones y bloqueos, desde la bitácora (se lee también el día anterior por las que venían de antes).
  const diaAnterior = diaDe(ini - 1);
  const esperas = esperasPorSesion(bitacora.leerDias([diaAnterior, ...dias]), ahora);
  for (const lista of esperas.values()) {
    for (const e of lista) {
      const nombre = nombreDe(e.carpeta ?? '?');
      if (e.ini >= ini && e.ini < fin) sumar(nombre, e.ini, 'aprobaciones', 1);
      const [a, b] = recortar([e.ini, e.fin], ini, fin);
      porHora(a, b, (t, ms) => sumar(nombre, t, 'bloqueoMs', ms));
    }
  }

  // Turnos de Claude, desde el historial.
  const { archivos, listo } = historial.datos();
  const piezasTotal = [];
  const esperasTotal = [];
  const piezasPorProyecto = new Map();
  const pedidos = [];
  let historiaDesde = null;
  for (const [ruta, a] of Object.entries(archivos)) {
    if (a.sub) {
      const padre = archivos[path.dirname(path.dirname(ruta)) + '.jsonl'];
      // Del proyecto de la sesión que lo lanzó: el subagente puede haber hecho cd a una subcarpeta.
      const nombre = nombreDe(padre?.carpeta ?? a.carpeta ?? '?');
      for (const [hora, tok] of Object.entries(a.tokensPorHora)) {
        const t = Number(hora);
        if (t >= ini && t < fin) sumar(nombre, t, 'tokens', tok);
      }
      continue;
    }
    if (!a.carpeta) continue;
    const nombre = nombreDe(a.carpeta);
    const turnos = a.abierto ? [...a.turnos, a.abierto] : a.turnos;
    const bloqueos = (esperas.get(a.sesion) ?? []).map((e) => [e.ini, e.fin]);
    turnos.forEach(([tIni, tFin, humano, tok, huecos], i) => {
      historiaDesde = Math.min(historiaDesde ?? tIni, tIni);
      if (humano) pedidos.push({ t: tIni, proyecto: nombre });
      if (tIni >= ini && tIni < fin) {
        if (humano) sumar(nombre, tIni, 'pedidos', 1);
        sumar(nombre, tIni, 'tokens', tok);
      }
      const enRango = recortar([tIni, tFin], ini, fin);
      const esperando = esperasDelTurno(huecos, interseccion([tIni, tFin], bloqueos));
      // Cada espera cuenta como máximo T2: pasado eso la sesión no te espera, quedó abandonada.
      const conTope = esperando.map(([a, b]) => [a, Math.min(b, a + T2)]);
      for (const [a, b] of interseccion(enRango, conTope)) {
        porHora(a, b, (t, ms) => sumar(nombre, t, 'esperaMs', ms));
        esperasTotal.push([a, b]);
      }
      for (const p of restar(enRango, esperando)) {
        porHora(p[0], p[1], (t, ms) => sumar(nombre, t, 'claudeMs', ms));
        piezasTotal.push(p);
        if (!piezasPorProyecto.has(nombre.toLowerCase())) piezasPorProyecto.set(nombre.toLowerCase(), []);
        piezasPorProyecto.get(nombre.toLowerCase()).push(p);
      }
      // Lo que Claude te esperó después de este turno: hasta tu siguiente pedido, con tope en T2.
      const sig = turnos[i + 1];
      const vuelta = sig ? sig[0] : Infinity;
      if (sig && !sig[2]) return; // lo reanudó una tarea de fondo, no vos
      const [ea, eb] = recortar([tFin, Math.min(vuelta, tFin + T2, ahora)], ini, fin);
      porHora(ea, eb, (t, ms) => sumar(nombre, t, 'esperaMs', ms));
      if (eb > ea) esperasTotal.push([ea, eb]);
      // Respuesta: solo si volviste dentro de T2. Más tarde la sesión ya no te esperaba (quedó en pausa):
      // eso es retomarla, y contarlo inflaría la mediana con las vueltas del almuerzo o del día siguiente.
      if (sig && vuelta - tFin <= T2 && vuelta >= ini && vuelta < fin) sumar(nombre, vuelta, 'respuestas', vuelta - tFin);
    });
  }

  // Horas con al menos una sesión trabajando (o esperándote): unión de intervalos, por día, por hora y por proyecto.
  const sumarUnion = (intervalos, campo) => {
    for (const [a, b] of unir(intervalos)) {
      porHora(a, b, (t, ms) => {
        for (const f of [porDiaFilas.get(diaDe(t)), porHoraFilas.get(inicioHora(t)), total]) if (f) f[campo] += ms;
      });
    }
  };
  sumarUnion(piezasTotal, 'activoMs');
  sumarUnion(esperasTotal, 'conEsperaMs');
  for (const [k, piezas] of piezasPorProyecto) {
    const f = proyectos.get(k).fila;
    for (const [a, b] of unir(piezas)) f.activoMs += b - a;
  }

  atribuirTuTiempo(actividad.leerDias(dias), pedidos, cfg, (nombre, t) => {
    if (t >= ini && t < fin) sumar(nombre, t, 'tuMs', MIN);
  });

  const cerrar = (f) => {
    const { respuestas, ...resto } = f;
    return { ...resto, respuestaMedianaMs: mediana(respuestas), ...(conRespuestas && { respuestas }) };
  };
  return {
    desde,
    hasta,
    generado: ahora,
    indexado: listo,
    fuentes: {
      transcriptsDesde: historiaDesde ? diaDe(historiaDesde) : null,
      actividadDesde: actividad.desde(),
      bitacoraDesde: bitacora.desde(),
      actividadActiva: !!cfg.registrarActividad,
    },
    totales: cerrar(total),
    proyectos: [...proyectos.values()]
      .map(({ nombre, fila }) => ({ proyecto: nombre, ...cerrar(fila) }))
      .filter((p) => p.tuMs || p.claudeMs || p.pedidos || p.esperaMs || p.aprobaciones || p.tokens.some(Boolean))
      .sort((a, b) => b.tuMs - a.tuMs || b.claudeMs - a.claudeMs),
    dias: dias.map((dia) => ({ dia, ...cerrar(porDiaFilas.get(dia)) })),
    // inicio: comienzo de la hora (ms); hora: 0 a 23, en hora local.
    horas: [...porHoraFilas].map(([inicio, f]) => ({ inicio, dia: diaDe(inicio), hora: new Date(inicio).getHours(), ...cerrar(f) })),
  };
}

// Junta las métricas de varias PCs (cada una calculada con conRespuestas). Se suma todo por proyecto,
// día y hora; la mediana de respuesta se recalcula sobre todas las respuestas juntas. "Claude
// trabajando" y "algo te esperaba" son uniones dentro de cada PC: entre PCs se suman, así que una
// hora en que trabajaron las dos cuenta dos veces.
const SUMABLES = ['tuMs', 'claudeMs', 'activoMs', 'esperaMs', 'conEsperaMs', 'pedidos', 'aprobaciones', 'bloqueoMs'];

function combinar(partes) {
  const vacia = () => ({ ...Object.fromEntries(SUMABLES.map((k) => [k, 0])), tokens: [0, 0, 0], respuestas: [] });
  const acumular = (a, b) => {
    for (const k of SUMABLES) a[k] += b[k] ?? 0;
    for (let i = 0; i < 3; i++) a.tokens[i] += b.tokens?.[i] ?? 0;
    a.respuestas.push(...(b.respuestas ?? []));
  };
  const cerrar = ({ respuestas, ...resto }) => ({ ...resto, respuestaMedianaMs: mediana(respuestas) });
  const porClave = (lista, clave) => {
    const m = new Map();
    for (const p of partes) {
      for (const fila of p.datos[lista] ?? []) {
        const k = clave(fila);
        if (!m.has(k)) m.set(k, { fila, suma: vacia(), maquinas: new Set() });
        acumular(m.get(k).suma, fila);
        m.get(k).maquinas.add(p.maquina);
      }
    }
    return m;
  };

  const total = vacia();
  for (const p of partes) acumular(total, p.datos.totales);
  const minimo = (campo) => partes.map((p) => p.datos.fuentes?.[campo]).filter(Boolean).sort()[0] ?? null;
  const primero = partes[0]?.datos ?? {};

  return {
    desde: primero.desde,
    hasta: primero.hasta,
    generado: Date.now(),
    indexado: partes.every((p) => p.datos.indexado),
    fuentes: {
      transcriptsDesde: minimo('transcriptsDesde'),
      actividadDesde: minimo('actividadDesde'),
      bitacoraDesde: minimo('bitacoraDesde'),
      actividadActiva: partes.some((p) => p.datos.fuentes?.actividadActiva),
    },
    totales: cerrar(total),
    proyectos: [...porClave('proyectos', (p) => p.proyecto.toLowerCase()).values()]
      .map(({ fila, suma, maquinas }) => ({ proyecto: fila.proyecto, ...cerrar(suma), maquinas: [...maquinas].sort() }))
      .sort((a, b) => b.tuMs - a.tuMs || b.claudeMs - a.claudeMs),
    dias: [...porClave('dias', (d) => d.dia).values()].map(({ fila, suma }) => ({ dia: fila.dia, ...cerrar(suma) })).sort((a, b) => (a.dia < b.dia ? -1 : 1)),
    horas: [...porClave('horas', (h) => h.inicio).values()]
      .map(({ fila, suma }) => ({ inicio: fila.inicio, dia: fila.dia, hora: fila.hora, ...cerrar(suma) }))
      .sort((a, b) => a.inicio - b.inicio),
  };
}

// Las mismas métricas en cero (mismos días y horas): para cuando ninguna PC elegida respondió.
function enCero(datos) {
  const cero = (fila) => ({ ...fila, ...Object.fromEntries(SUMABLES.map((k) => [k, 0])), tokens: [0, 0, 0], respuestas: [] });
  return { ...datos, totales: cero(datos.totales), proyectos: [], dias: datos.dias.map(cero), horas: datos.horas.map(cero) };
}

module.exports = { calcular, combinar, enCero, atribuirTuTiempo };
