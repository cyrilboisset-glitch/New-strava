// Vent et sens de la boucle : repris de l'appli de Cyril « Vent et
// températures » (dépôt cyrilboisset-glitch/Appli-vent : openmeteo.js,
// analyse.js, power.js, geo.js), traduit et adapté aux tracés de l'appli.
// - prévisions Open-Meteo (gratuit, sans clé), demandées pour une trentaine
//   de points du parcours seulement (aucune donnée de sortie envoyée) ;
// - vent dans l'axe de la route : > 0 dans le dos, < 0 de face ; 70 % du vent
//   à 10 m atteint le cycliste ;
// - temps de parcours avec le vent (modèle physique, puissance qui monte en
//   montée et baisse en descente) ;
// - sens conseillé : vent dans le dos sur le dernier tiers (critère de l'appli
//   vent), à égalité (moins de 1,5 km/h d'écart) sur l'ensemble.
// Sans navigateur : testé dans Node (tests/test-vent.mjs).
import { MODELE } from './puissance-estimee.js';

export const PART_VENT_CYCLISTE = 0.7;
export const MEME_VENT_KMH = 1.5;
export const VITESSE_MAXI_KMH = 50; // descente : virages, freinage (appli vent)
export const ADRESSE_OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const R_KM = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap (degrés, 0 = nord, 90 = est) pour aller de a vers b */
export function cap(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const POINTS_CARDINAUX = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
export const pointCardinal = (d) => POINTS_CARDINAUX[Math.round((((d % 360) + 360) % 360) / 45) % 8];

/** Vent dans l'axe de la marche (km/h) : > 0 dans le dos, < 0 de face. `de` : d'où vient le vent */
export const ventDansLeDos = (vitesseKmh, de, capDeg) => -vitesseKmh * Math.cos(rad(de - capDeg));

/**
 * Points régulièrement espacés le long du tracé, avec le cap local (moyenné
 * sur ±600 m pour ignorer les lacets).
 * @param {[lat, lon, ele][]} coords
 */
export function echantillonner(coords, pasM, fenetreM = 600) {
  const pts = coords.map(([lat, lon, ele]) => ({ lat, lon, ele: typeof ele === 'number' ? ele : null }));
  let d = 0;
  pts.forEach((p, i) => { if (i) d += distanceKm(pts[i - 1], p) * 1000; p.m = d; });
  const L = d;
  const a = (m) => {
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1].m < m) i++;
    const p = pts[i]; const q = pts[i + 1] ?? p;
    const f = q.m > p.m ? Math.min(1, Math.max(0, (m - p.m) / (q.m - p.m))) : 0;
    return { lat: p.lat + (q.lat - p.lat) * f, lon: p.lon + (q.lon - p.lon) * f, ele: p.ele == null || q.ele == null ? (p.ele ?? q.ele) : p.ele + (q.ele - p.ele) * f };
  };
  const n = Math.max(1, Math.round(L / pasM));
  const res = [];
  for (let k = 0; k <= n; k++) {
    const m = (L * k) / n;
    const p = a(m);
    res.push({ distanceM: m, ...p, cap: cap(a(Math.max(0, m - fenetreM)), a(Math.min(L, m + fenetreM))) });
  }
  return res;
}

/** Même parcours dans l'autre sens : mêmes positions, ordre et caps retournés */
export function inverser(ech) {
  const L = ech[ech.length - 1].distanceM;
  return [...ech].reverse().map((e) => ({ ...e, distanceM: L - e.distanceM, cap: (e.cap + 180) % 360 }));
}

// ---- Open-Meteo -----------------------------------------------------------------

const jour = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Adresse des prévisions horaires (vent, température, pluie) pour les points donnés */
export function urlOpenMeteo(points, debutMs, finMs) {
  const f = (x) => x.toFixed(4);
  const q = new URLSearchParams({
    latitude: points.map((p) => f(p.lat)).join(','),
    longitude: points.map((p) => f(p.lon)).join(','),
    hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability',
    wind_speed_unit: 'kmh',
    timezone: 'GMT',
    timeformat: 'unixtime',
    start_date: jour(debutMs - 3600e3),
    end_date: jour(finMs + 3600e3),
  });
  if (points.every((p) => p.ele != null)) q.set('elevation', points.map((p) => Math.round(p.ele)).join(','));
  return `${ADRESSE_OPEN_METEO}?${q.toString().replace(/%2C/g, ',')}`;
}

/** Réponse Open-Meteo (un objet par point) -> une série horaire par point */
export function lireOpenMeteo(json, points) {
  if (json?.error) throw new Error(`Open-Meteo : ${json.reason ?? 'erreur'}`);
  const liste = Array.isArray(json) ? json : [json];
  return liste.map((loc, k) => {
    const h = loc.hourly;
    if (!h || !Array.isArray(h.time)) throw new Error('réponse météo inattendue');
    return {
      lat: points?.[k]?.lat ?? loc.latitude, lon: points?.[k]?.lon ?? loc.longitude,
      // altitude à laquelle Open-Meteo a donné la température : celle qu'on lui a envoyée,
      // sinon celle de sa grille (champ `elevation` de la réponse)
      ele: points?.[k]?.ele ?? loc.elevation ?? null,
      heures: h.time.map((t) => t * 1000),
      temp: h.temperature_2m, vent: h.wind_speed_10m, de: h.wind_direction_10m,
      rafales: h.wind_gusts_10m ?? [], pluie: h.precipitation_probability ?? [],
    };
  });
}

export async function chargerMeteo(points, debutMs, finMs, attente = fetch) {
  let r;
  try { r = await attente(urlOpenMeteo(points, debutMs, finMs)); } catch { throw new Error('pas de réseau ou service météo injoignable'); }
  let json = null;
  try { json = await r.json(); } catch { /* réponse vide */ }
  if (!r.ok) throw new Error(`Open-Meteo : ${json?.reason ?? `erreur ${r.status}`}`);
  return lireOpenMeteo(json, points);
}

const lerp = (a, b, f) => (a == null || b == null ? (a ?? b) : a + (b - a) * f);

/** Météo interpolée à l'instant t (ms) ; le vent est interpolé comme un vecteur */
export function meteoA(serie, t) {
  const h = serie.heures;
  if (!h.length || t < h[0] - 3600e3 || t > h[h.length - 1] + 3600e3) return null;
  let i = 0;
  while (i < h.length - 2 && h[i + 1] <= t) i++;
  const j = Math.min(i + 1, h.length - 1);
  const f = j > i ? Math.min(1, Math.max(0, (t - h[i]) / (h[j] - h[i]))) : 0;
  const vec = (k) => [serie.vent[k] * Math.sin(rad(serie.de[k])), serie.vent[k] * Math.cos(rad(serie.de[k]))];
  const [ux, uy] = vec(i); const [vx, vy] = vec(j);
  const x = lerp(ux, vx, f); const y = lerp(uy, vy, f);
  return {
    temp: lerp(serie.temp[i], serie.temp[j], f),
    vent: Math.hypot(x, y),
    de: (deg(Math.atan2(x, y)) + 360) % 360,
    rafales: lerp(serie.rafales[i], serie.rafales[j], f),
    pluie: Math.max(serie.pluie[i] ?? 0, serie.pluie[j] ?? 0),
  };
}

// ---- Température : altitude et vent ressenti -------------------------------------

/** Baisse de la température avec l'altitude : 6,5 °C par 1 000 m (atmosphère type OACI) */
export const GRADIENT_TEMP_C_PAR_M = 0.0065;

/** Température à l'altitude eleM, connue à l'altitude eleSerieM */
export function tempAltitude(tempC, eleSerieM, eleM) {
  if (tempC == null || eleSerieM == null || eleM == null) return tempC;
  return tempC - GRADIENT_TEMP_C_PAR_M * (eleM - eleSerieM);
}

/**
 * Température ressentie avec le vent relatif (vitesse du vélo + vent de face), formule
 * du refroidissement éolien (Environnement Canada / Météo-France), valable à 10 °C et
 * moins et à partir de 4,8 km/h ; au-dessus, la température elle-même.
 */
export function ressenti(tempC, ventKmh) {
  if (tempC == null || tempC > 10 || !(ventKmh >= 4.8)) return tempC;
  const v = ventKmh ** 0.16;
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
}

// ---- Modèle de puissance (appli vent) ---------------------------------------------

/** Densité de l'air (kg/m³) selon l'altitude et la température */
export function densiteAir(altM = 0, tempC = 15) {
  const p = 101325 * (1 - 2.25577e-5 * Math.max(-400, altM ?? 0)) ** 5.25588;
  return p / (287.05 * ((tempC ?? 15) + 273.15));
}

/** Puissance selon la pente : +30 % à 6 % et plus, roue libre à -6 % */
export function puissanceSelonPente(platW, pente) {
  if (pente > 0) return platW * (1 + 0.3 * Math.min(1, pente / 0.06));
  if (pente > -0.02) return platW;
  return platW * Math.max(0, (pente + 0.06) / 0.04);
}

/** Vitesse (m/s) avec `watts`, `ventDeFaceMs` > 0 de face, < 0 dans le dos */
export function vitesseAvecVent(watts, { masseKg, pente = 0, ventDeFaceMs = 0, rho = 1.2, modele = MODELE }) {
  const th = Math.atan(pente);
  const besoin = (v) => {
    const air = v + ventDeFaceMs;
    return (masseKg * modele.g * (Math.sin(th) + modele.crr * Math.cos(th)) * v + 0.5 * rho * modele.cda * air * Math.abs(air) * v) / modele.rendement;
  };
  const vmax = VITESSE_MAXI_KMH / 3.6;
  if (besoin(vmax) <= watts) return vmax;
  let bas = 0; let haut = vmax;
  for (let k = 0; k < 50; k++) {
    const m = (bas + haut) / 2;
    if (besoin(m) < watts) bas = m; else haut = m;
  }
  return Math.max(0.5, (bas + haut) / 2);
}

// Série météo la plus proche d'un point (les séries sont aux points demandés)
function plusProche(series, p) {
  let meilleure = series[0]; let dMin = Infinity;
  for (const s of series) {
    const d = (s.lat - p.lat) ** 2 + ((s.lon - p.lon) * Math.cos(rad(p.lat))) ** 2;
    if (d < dMin) { dMin = d; meilleure = s; }
  }
  return meilleure;
}

/** Moyenne (pondérée par la distance) d'une valeur sur [de, a] mètres */
function moyenneSur(lignes, cle, de, a) {
  let s = 0; let w = 0;
  for (let k = 1; k < lignes.length; k++) {
    const x = Math.max(de, lignes[k - 1].distanceM); const y = Math.min(a, lignes[k].distanceM);
    if (y <= x) continue;
    s += ((lignes[k - 1][cle] + lignes[k][cle]) / 2) * (y - x); w += y - x;
  }
  return w ? s / w : 0;
}

const SANS_PREVISION = 'pas de prévision pour toute la sortie (16 jours au plus)';

/**
 * Parcourt `ech` (dans l'ordre de marche) à partir de debutMs, avec le vent
 * prévu au moment du passage.
 * Température : celle d'Open-Meteo au point de prévision le plus proche, corrigée de
 * l'écart d'altitude (6,5 °C par 1 000 m) ; ressenti avec la vitesse et le vent de face.
 * @returns {{dureeS, finMs, lignes: {distanceM, t, dos, temp, ressenti, ele, pente, pluie}[], dosFin, dosTout, pluieMax,
 *   tempMin, tempMax, ventMoy, ventDe, temperatures}}
 */
export function simuler(ech, series, debutMs, platW, masseKg) {
  let t = debutMs;
  const lignes = [];
  for (let k = 0; k < ech.length; k++) {
    const p = ech[k];
    const serie = plusProche(series, p);
    const w = meteoA(serie, t);
    if (!w) throw new Error(SANS_PREVISION);
    const dos = ventDansLeDos(w.vent, w.de, p.cap);
    const temp = tempAltitude(w.temp, serie.ele, p.ele);
    const ligne = { distanceM: p.distanceM, t, dos, temp, ressenti: temp, ele: p.ele, pente: 0, pluie: w.pluie, vent: w.vent, de: w.de };
    lignes.push(ligne);
    if (k === ech.length - 1) {
      if (k > 0) { ligne.ressenti = ressenti(temp, lignes[k - 1].airKmh); ligne.pente = lignes[k - 1].pente; }
      break;
    }
    const q = ech[k + 1];
    const dM = q.distanceM - p.distanceM;
    if (dM <= 0) continue;
    const pente = Math.max(-0.25, Math.min(0.25, ((q.ele ?? 0) - (p.ele ?? 0)) / dM));
    const ventDeFaceMs = (-PART_VENT_CYCLISTE * dos) / 3.6;
    const v = vitesseAvecVent(puissanceSelonPente(platW, pente), {
      masseKg, pente, ventDeFaceMs, rho: densiteAir(p.ele, temp),
    });
    ligne.pente = pente;
    ligne.airKmh = Math.max(0, v + ventDeFaceMs) * 3.6;
    ligne.ressenti = ressenti(temp, ligne.airKmh);
    t += (dM / v) * 1000;
  }
  const L = ech[ech.length - 1].distanceM;
  // vent moyen (vecteur) pour le résumé
  let vx = 0; let vy = 0;
  for (const l of lignes) { vx += l.vent * Math.sin(rad(l.de)); vy += l.vent * Math.cos(rad(l.de)); }
  return {
    lignes,
    dureeS: (t - debutMs) / 1000,
    finMs: t,
    dosFin: moyenneSur(lignes, 'dos', (2 * L) / 3, L),
    dosTout: moyenneSur(lignes, 'dos', 0, L),
    pluieMax: Math.max(...lignes.map((l) => l.pluie ?? 0)),
    tempMin: Math.min(...lignes.map((l) => l.temp)),
    tempMax: Math.max(...lignes.map((l) => l.temp)),
    temperatures: resumeTemperatures(lignes),
    ventMoy: Math.hypot(vx, vy) / lignes.length,
    ventDe: (deg(Math.atan2(vx, vy)) + 360) % 360,
  };
}

/**
 * Températures à retenir : départ, arrivée, point le plus haut, point le plus froid et
 * ressenti le plus froid (souvent dans une descente).
 */
export function resumeTemperatures(lignes) {
  const avecAlt = lignes.filter((l) => l.ele != null);
  const haut = avecAlt.length ? avecAlt.reduce((a, l) => (l.ele > a.ele ? l : a)) : null;
  const froid = lignes.reduce((a, l) => (l.temp < a.temp ? l : a));
  const ressentiMin = lignes.reduce((a, l) => (l.ressenti < a.ressenti ? l : a));
  const point = (l) => (l ? { temp: l.temp, ele: l.ele, distanceM: l.distanceM, t: l.t } : null);
  return {
    depart: point(lignes[0]),
    arrivee: point(lignes[lignes.length - 1]),
    haut: haut && lignes[0].ele != null && haut.ele - lignes[0].ele >= 50 ? point(haut) : null,
    froid: point(froid),
    ressentiMin: { ...point(ressentiMin), ressenti: ressentiMin.ressenti, descente: ressentiMin.pente <= -0.03 },
  };
}

/** Sens conseillé (appli vent) : vent dans le dos sur le dernier tiers, sinon sur l'ensemble */
export function comparerSens(trace, inverse) {
  const d = inverse.dosFin - trace.dosFin;
  if (Math.abs(d) >= MEME_VENT_KMH) return { meilleur: d > 0 ? 'inverse' : 'trace', net: true };
  return { meilleur: inverse.dosTout > trace.dosTout ? 'inverse' : 'trace', net: false };
}

/**
 * Pour chaque heure de départ : les deux sens, le sens conseillé, et la
 * meilleure heure (la plus courte avec le vent, en évitant la pluie probable).
 * @param {number[]} departsMs
 */
export function planifier(coords, series, departsMs, platW, masseKg) {
  const ech = echantillonner(coords, 100);
  const inv = inverser(ech);
  const heures = departsMs.map((debut) => {
    const trace = simuler(ech, series, debut, platW, masseKg);
    const inverse = simuler(inv, series, debut, platW, masseKg);
    const c = comparerSens(trace, inverse);
    return { debutMs: debut, trace, inverse, sens: c.meilleur, net: c.net, choix: c.meilleur === 'trace' ? trace : inverse };
  });
  const seches = heures.filter((h) => h.choix.pluieMax < 50);
  const parmi = seches.length ? seches : heures;
  const meilleure = parmi.reduce((m, h) => (h.choix.dureeS < m.choix.dureeS ? h : m), parmi[0]);
  return { heures, meilleure };
}

// Couleurs du vent : rouge (de face) -> gris (travers) -> bleu (dans le dos)
export const CLASSES_VENT = [
  [-12, '#b2182b', 'face fort'], [-MEME_VENT_KMH, '#ef8a62', 'de face'], [MEME_VENT_KMH, '#bababa', 'travers'],
  [12, '#67a9cf', 'dans le dos'], [Infinity, '#2166ac', 'dos fort'],
];
export const couleurVent = (dosKmh) => CLASSES_VENT.find(([max]) => dosKmh < max)[1];
