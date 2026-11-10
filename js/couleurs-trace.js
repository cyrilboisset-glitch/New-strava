// Tracé coloré selon la vitesse, la puissance, la FC, la pente ou l'altitude.
// Sans navigateur : testé dans Node (tests/test-couleurs-trace.mjs).
// Les valeurs sont calculées une fois à l'import pour les ~160 points de la trace
// simplifiée de la liste (sortie.traceValeurs) et, dans le détail, pour tous les points.
import { ZONES_PUISSANCE, ZONES_FC } from './analyse.js';

export const MODES = [
  { cle: 'uni', nom: 'Uni' },
  { cle: 'puissance', nom: 'Puissance' },
  { cle: 'vitesse', nom: 'Vitesse' },
  { cle: 'fc', nom: 'FC' },
  { cle: 'pente', nom: 'Pente' },
  { cle: 'altitude', nom: 'Altitude' },
];
export const MODE_DEFAUT = 'puissance';
export const VERSION_VALEURS_TRACE = 1;

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const tempsS = (p) => (typeof p.tS === 'number' ? p.tS : p.horodatage instanceof Date ? p.horodatage.getTime() / 1000 : null);

/** Mêmes indices que traceSimplifiee (sortie.js) : au plus `max` points, le dernier toujours gardé */
export function indicesEchantillon(n, max = 160) {
  if (n < 2) return [];
  const pas = Math.max(1, Math.ceil(n / (max - 1)));
  const res = [];
  for (let i = 0; i < n; i += pas) res.push(i);
  if (res[res.length - 1] !== n - 1) res.push(n - 1);
  return res;
}

const moyenne = (pts, a, b, champ, garderZero = true) => {
  let s = 0; let n = 0;
  for (let i = a; i <= b; i++) {
    const v = pts[i][champ];
    if (typeof v === 'number' && (garderZero || v > 0)) { s += v; n++; }
  }
  return n ? s / n : null;
};

/**
 * Valeurs aux points `indices` (de `pts`, déjà filtrés : seuls ceux avec lat / lon).
 * Chaque valeur est la moyenne sur ±demi points. Clé absente = donnée absente.
 * @returns {{vitesse?: number[], puissance?: number[], fc?: number[], pente?: number[], altitude?: number[]}}
 */
export function valeursPoints(pts, indices, { demi = 0, penteMinM = 60 } = {}) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const fen = (i) => [Math.max(0, i - demi), Math.min(pts.length - 1, i + demi)];
  const colonne = (calc) => {
    const col = indices.map(calc);
    return col.some((v) => v != null) ? col : null;
  };
  const res = {};

  const aVitesse = pts.some((p) => typeof p.vitesseMs === 'number');
  const vit = colonne((i) => {
    const [a, b] = fen(i);
    if (aVitesse) { const v = moyenne(pts, a, b, 'vitesseMs'); return v == null ? null : Math.round(v * 36) / 10; }
    // pas de vitesse dans le fichier (GPX, TCX) : distance / temps sur la fenêtre
    const aa = Math.max(0, i - Math.max(1, demi)); const bb = Math.min(pts.length - 1, i + Math.max(1, demi));
    const dt = (tempsS(pts[bb]) ?? 0) - (tempsS(pts[aa]) ?? 0);
    return dt > 0 ? Math.round(((cum[bb] - cum[aa]) / dt) * 36) / 10 : null;
  });
  if (vit) res.vitesse = vit;

  if (pts.some((p) => p.puissanceW > 0)) res.puissance = indices.map((i) => { const [a, b] = fen(i); const v = moyenne(pts, a, b, 'puissanceW'); return v == null ? null : Math.round(v); });
  if (pts.some((p) => p.fc > 0)) res.fc = indices.map((i) => { const [a, b] = fen(i); const v = moyenne(pts, a, b, 'fc', false); return v == null ? null : Math.round(v); });

  const aAlt = pts.some((p) => typeof p.altitudeM === 'number');
  if (aAlt) {
    const alt = indices.map((i) => { const [a, b] = fen(i); return moyenne(pts, a, b, 'altitudeM'); });
    res.altitude = alt.map((v) => (v == null ? null : Math.round(v)));
    res.pente = alt.map((_, k) => {
      let a = k; let b = k;
      while (a > 0 && cum[indices[k]] - cum[indices[a]] < penteMinM / 2) a--;
      while (b < indices.length - 1 && cum[indices[b]] - cum[indices[k]] < penteMinM / 2) b++;
      const d = cum[indices[b]] - cum[indices[a]];
      if (d < 10 || alt[a] == null || alt[b] == null) return null;
      return Math.round(Math.max(-25, Math.min(25, ((alt[b] - alt[a]) / d) * 100)) * 10) / 10;
    });
  }
  return res;
}

/** Valeurs de la trace simplifiée de la liste (mêmes points que traceSimplifiee) */
export function valeursTrace(records, max = 160) {
  const pts = records.filter((r) => typeof r.lat === 'number' && typeof r.lon === 'number');
  const indices = indicesEchantillon(pts.length, max);
  if (!indices.length) return null;
  const pas = Math.max(1, Math.ceil(pts.length / (max - 1)));
  const v = valeursPoints(pts, indices, { demi: Math.floor(pas / 2) });
  return Object.keys(v).length ? { v: VERSION_VALEURS_TRACE, ...v } : null;
}

// ---- Couleurs ------------------------------------------------------------------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rampe = (...c) => c.map(hex);
const RAMPES = {
  vitesse: rampe('#3b4cc0', '#2fb5c9', '#3fd47a', '#f2dc3a', '#ff7a2f', '#e5243b'),
  pente: rampe('#2b6cf0', '#8fb4f0', '#b9bec8', '#f2dc3a', '#ff9a2f', '#e5484d', '#7a1d3c'),
  altitude: rampe('#2f9e6a', '#9acd5a', '#e3d36a', '#c28a4a', '#8a5a3a', '#f4f4f4'),
};
const COULEURS_PUISSANCE = ['#9aa3b2', '#4d8ef7', '#37c27b', '#f2dc3a', '#ff9a2f', '#e5484d', '#a855f7'];
const COULEURS_FC = ['#9aa3b2', '#4d8ef7', '#37c27b', '#ff9a2f', '#e5484d'];
export const COULEUR_UNIE = '#ff6a13';
const PAS_DEGRADE = 20;

const hexRgb = (c) => `rgb(${c.join(',')})`;
function degrade(stops, x) {
  x = Math.max(0, Math.min(1, x));
  x = Math.round(x * PAS_DEGRADE) / PAS_DEGRADE; // peu de couleurs distinctes : moins de morceaux à dessiner
  const k = x * (stops.length - 1); const i = Math.min(stops.length - 2, Math.floor(k)); const f = k - i;
  return hexRgb(stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * f)));
}
const hexDe = (stops) => stops.map(hexRgb);
const percentile = (valeurs, p) => {
  const t = valeurs.filter((v) => v != null).sort((a, b) => a - b);
  return t.length ? t[Math.min(t.length - 1, Math.floor(p * (t.length - 1)))] : null;
};
const indiceZone = (zones, reference, v) => {
  for (let i = 0; i < zones.length - 1; i++) if (v <= reference * zones[i].max) return i;
  return zones.length - 1;
};

/** Ce mode a-t-il des données pour cette sortie ? */
export function modeDisponible(valeurs, mode, ctx = {}) {
  if (mode === 'uni') return true;
  const col = valeurs?.[mode];
  if (!col || !col.some((v) => v != null)) return false;
  if (mode === 'puissance') return !!ctx.ftpW && col.some((v) => v > 0);
  if (mode === 'fc') return !!ctx.fcMaxBpm;
  if (mode === 'vitesse' || mode === 'altitude') {
    const a = percentile(col, 0.05); const b = percentile(col, 0.95);
    return a != null && b != null && b > a;
  }
  return true;
}

/** Une couleur par point (null si pas de valeur) */
export function couleursPoints(valeurs, mode, ctx = {}) {
  const col = valeurs[mode];
  if (mode === 'puissance') return col.map((v) => (v == null ? null : COULEURS_PUISSANCE[indiceZone(ZONES_PUISSANCE, ctx.ftpW, v)]));
  if (mode === 'fc') return col.map((v) => (v == null ? null : COULEURS_FC[indiceZone(ZONES_FC, ctx.fcMaxBpm, v)]));
  if (mode === 'pente') return col.map((v) => (v == null ? null : degrade(RAMPES.pente, (v + 8) / 18)));
  const a = percentile(col, 0.05); const b = percentile(col, 0.95);
  return col.map((v) => (v == null ? null : degrade(RAMPES[mode], (v - a) / (b - a))));
}

/**
 * Morceaux de même couleur : [{ i0, i1, couleur }] (points i0 à i1 inclus). Un segment
 * entre deux points prend la couleur de son point d'arrivée ; sans valeur : couleur unie.
 */
export function morceaux(couleurs, defaut = COULEUR_UNIE) {
  const res = [];
  for (let i = 1; i < couleurs.length; i++) {
    const c = couleurs[i] ?? couleurs[i - 1] ?? defaut;
    const dernier = res[res.length - 1];
    if (dernier && dernier.couleur === c) dernier.i1 = i;
    else res.push({ i0: i - 1, i1: i, couleur: c });
  }
  return res;
}

/** Morceaux prêts à dessiner pour un mode, ou null (mode « uni » ou données absentes) */
export function morceauxMode(valeurs, mode, ctx = {}) {
  if (!valeurs || mode === 'uni' || !modeDisponible(valeurs, mode, ctx)) return null;
  return morceaux(couleursPoints(valeurs, mode, ctx));
}

/** Légende : zones (puissance, FC) ou dégradé avec ses extrémités */
export function legende(valeurs, mode, ctx = {}) {
  if (!valeurs || mode === 'uni' || !modeDisponible(valeurs, mode, ctx)) return null;
  if (mode === 'puissance') {
    return { type: 'zones', unite: 'W', items: ZONES_PUISSANCE.map((z, i) => ({ couleur: COULEURS_PUISSANCE[i], nom: z.nom, texte: i === 0 ? `< ${Math.round(ctx.ftpW * z.max)}` : Number.isFinite(z.max) ? `${Math.round(ctx.ftpW * ZONES_PUISSANCE[i - 1].max) + 1}–${Math.round(ctx.ftpW * z.max)}` : `> ${Math.round(ctx.ftpW * ZONES_PUISSANCE[i - 1].max)}` })) };
  }
  if (mode === 'fc') {
    return { type: 'zones', unite: 'bpm', items: ZONES_FC.map((z, i) => ({ couleur: COULEURS_FC[i], nom: z.nom, texte: i === 0 ? `< ${Math.round(ctx.fcMaxBpm * z.max)}` : Number.isFinite(z.max) ? `${Math.round(ctx.fcMaxBpm * ZONES_FC[i - 1].max) + 1}–${Math.round(ctx.fcMaxBpm * z.max)}` : `> ${Math.round(ctx.fcMaxBpm * ZONES_FC[i - 1].max)}` })) };
  }
  if (mode === 'pente') return { type: 'degrade', unite: '%', stops: hexDe(RAMPES.pente), min: '−8', max: '+10' };
  const col = valeurs[mode];
  const a = percentile(col, 0.05); const b = percentile(col, 0.95);
  const unite = mode === 'vitesse' ? 'km/h' : 'm';
  const fmt = (v) => (mode === 'vitesse' ? v.toFixed(0) : String(Math.round(v)));
  return { type: 'degrade', unite, stops: hexDe(RAMPES[mode]), min: fmt(a), max: fmt(b) };
}

/** HTML de la légende (sous la carte du détail) */
export function htmlLegende(leg) {
  if (!leg) return '';
  if (leg.type === 'zones') {
    return `<div class="legende-trace zones" aria-hidden="true">${leg.items.map((z) => `<span><i style="background:${z.couleur}"></i>${z.nom}<small>${z.texte}</small></span>`).join('')}<em>${leg.unite}</em></div>`;
  }
  return `<div class="legende-trace" aria-hidden="true"><span class="legende-bord">${leg.min}</span><i class="legende-degrade" style="background:linear-gradient(90deg,${leg.stops.join(',')})"></i><span class="legende-bord">${leg.max}</span><em>${leg.unite}</em></div>`;
}
