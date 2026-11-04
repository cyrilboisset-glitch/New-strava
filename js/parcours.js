// Sorties faites sur le même parcours : reconnues automatiquement et classées.
// Comparaison sur la trace simplifiée gardée dans chaque sortie (pas de
// fichier à relire : rapide même avec tout l'historique Strava).
// Sans navigateur : testé dans Node (tests/test-parcours.mjs).
import { familleSortie } from './sortie.js';

const M_PAR_DEG = 111195;
export const ECART_BOUTS_M = 200; // départs (et arrivées) à moins de 200 m
export const ECART_DISTANCE = 0.06; // distances à 6 % près
export const ECART_TRACE_M = 150; // chaque point à moins de 150 m de l'autre trace
export const PART_COMMUNE = 0.9; // au moins 90 % des points, dans les deux sens

const distM = (a, b) => {
  const kx = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * M_PAR_DEG, (a[1] - b[1]) * M_PAR_DEG * kx);
};

// distance (m) du point p au tronçon [a, b] (projection plane locale)
function versTroncon(p, a, b) {
  const kx = M_PAR_DEG * Math.cos((p[0] * Math.PI) / 180);
  const P = [0, 0];
  const A = [(a[1] - p[1]) * kx, (a[0] - p[0]) * M_PAR_DEG];
  const B = [(b[1] - p[1]) * kx, (b[0] - p[0]) * M_PAR_DEG];
  const dx = B[0] - A[0]; const dy = B[1] - A[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / l2)) : 0;
  return Math.hypot(A[0] + t * dx, A[1] + t * dy);
}

function partProche(ta, tb) {
  let proches = 0;
  for (const p of ta) {
    for (let i = 0; i < tb.length - 1; i++) {
      if (versTroncon(p, tb[i], tb[i + 1]) <= ECART_TRACE_M) { proches++; break; }
    }
  }
  return proches / ta.length;
}

/** Deux sorties ont-elles fait le même parcours ? */
export function memeParcours(a, b) {
  if (!a.trace || !b.trace || a.trace.length < 2 || b.trace.length < 2) return false;
  if (!a.distanceM || !b.distanceM) return false;
  if (familleSortie(a).cle !== familleSortie(b).cle) return false;
  if (Math.abs(a.distanceM - b.distanceM) > ECART_DISTANCE * Math.max(a.distanceM, b.distanceM)) return false;
  if (distM(a.trace[0], b.trace[0]) > ECART_BOUTS_M) return false;
  if (distM(a.trace[a.trace.length - 1], b.trace[b.trace.length - 1]) > ECART_BOUTS_M) return false;
  return partProche(a.trace, b.trace) >= PART_COMMUNE && partProche(b.trace, a.trace) >= PART_COMMUNE;
}

/** Classement au temps en mouvement (le plus rapide d'abord) */
export function classerSorties(sorties) {
  return [...sorties].sort((x, y) => (x.dureeChronoS ?? Infinity) - (y.dureeChronoS ?? Infinity));
}

/** Sorties du même parcours que `s` (elle comprise), classées */
export function memeParcoursQue(s, sorties) {
  const groupe = [s, ...sorties.filter((x) => x.id !== s.id && memeParcours(s, x))];
  return groupe.length > 1 ? classerSorties(groupe) : [];
}

/**
 * Tous les parcours faits au moins deux fois : groupes de sorties reliées
 * (A ~ B et B ~ C : même groupe), chacun classé.
 */
export function regrouperParcours(sorties) {
  const avecTrace = sorties.filter((s) => s.trace?.length > 1 && s.distanceM);
  const parent = new Map(avecTrace.map((s) => [s.id, s.id]));
  const racine = (id) => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  // tri par latitude du départ : on ne compare que des départs voisins
  const tries = [...avecTrace].sort((a, b) => a.trace[0][0] - b.trace[0][0]);
  const ecartLat = ECART_BOUTS_M / M_PAR_DEG;
  for (let i = 0; i < tries.length; i++) {
    for (let j = i + 1; j < tries.length && tries[j].trace[0][0] - tries[i].trace[0][0] <= ecartLat; j++) {
      const ri = racine(tries[i].id); const rj = racine(tries[j].id);
      if (ri !== rj && memeParcours(tries[i], tries[j])) parent.set(rj, ri);
    }
  }
  const groupes = new Map();
  for (const s of avecTrace) {
    const r = racine(s.id);
    if (!groupes.has(r)) groupes.set(r, []);
    groupes.get(r).push(s);
  }
  return [...groupes.values()].filter((g) => g.length > 1).map(classerSorties)
    .sort((a, b) => b.length - a.length || Math.max(...b.map((s) => s.debut)) - Math.max(...a.map((s) => s.debut)));
}
