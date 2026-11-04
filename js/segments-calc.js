// Segments (comme sur Strava) : calculs sans navigateur, testés dans Node.
// - un segment est un bout de route (suite de points GPS) ;
// - on le retrouve dans une sortie quand la trace passe au départ, suit le
//   tracé, puis passe à l'arrivée, dans cet ordre ;
// - l'heure de passage au départ et à l'arrivée est interpolée sur la trace
//   (le BiNavi n'enregistre qu'un point toutes les 8 s environ).
import { parSeconde } from './analyse.js';

const M_PAR_DEG = 111195; // sphère de 6 371 km, comme le reste de l'appli
export const RAYON_PASSAGE_M = 30; // distance max. à la trace au départ / à l'arrivée
export const ECART_TRACE_M = 40; // distance max. entre le segment et la trace en chemin
export const PAS_SEGMENT_M = 20; // un point du segment tous les 20 m

/** Projection plane locale (m) autour d'un point de référence */
export function projecteur(lat0, lon0) {
  const kx = M_PAR_DEG * Math.cos((lat0 * Math.PI) / 180);
  return (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * M_PAR_DEG];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// distance du point p au segment [a, b] et position (0..1) de son projeté
function versSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return [Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t];
}

/**
 * Crée un segment depuis les points [i0, i1] d'une sortie (pointsDetail).
 * @returns {{points: [lat, lon][], distanceM, denivelePosM, deniveleNegM, penteMoyPct, altDepartM, altArriveeM, bbox}}
 */
export function decouperSegment(pts, i0, i1) {
  const morceau = pts.slice(i0, i1 + 1).filter((p) => typeof p.lat === 'number');
  if (morceau.length < 2) throw new Error('pas de GPS sur ce passage');
  const proj = projecteur(morceau[0].lat, morceau[0].lon);
  const points = [[morceau[0].lat, morceau[0].lon]];
  const alts = [morceau[0].altitudeM];
  let longueur = 0;
  let depuisDernier = 0;
  let prec = proj(morceau[0].lat, morceau[0].lon);
  for (let k = 1; k < morceau.length; k++) {
    const q = proj(morceau[k].lat, morceau[k].lon);
    const d = dist(prec, q);
    longueur += d;
    depuisDernier += d;
    prec = q;
    if (depuisDernier >= PAS_SEGMENT_M || k === morceau.length - 1) {
      points.push([Math.round(morceau[k].lat * 1e6) / 1e6, Math.round(morceau[k].lon * 1e6) / 1e6]);
      alts.push(morceau[k].altitudeM);
      depuisDernier = 0;
    }
  }
  // dénivelés avec un seuil de 2 m (comme les sorties), sur les altitudes gardées
  let dplus = 0; let dmoins = 0;
  const a = alts.filter((x) => typeof x === 'number');
  if (a.length > 1) {
    let ref = a[0];
    for (const v of a) {
      if (v - ref >= 2) { dplus += v - ref; ref = v; } else if (ref - v >= 2) { dmoins += ref - v; ref = v; }
    }
  }
  const altDepartM = a.length ? a[0] : null;
  const altArriveeM = a.length ? a[a.length - 1] : null;
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  return {
    points,
    distanceM: longueur,
    denivelePosM: Math.round(dplus),
    deniveleNegM: Math.round(dmoins),
    penteMoyPct: a.length > 1 && longueur ? ((altArriveeM - altDepartM) / longueur) * 100 : null,
    altDepartM, altArriveeM,
    bbox: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)],
  };
}

/** La sortie peut-elle passer par le segment ? (trace simplifiée, marge 300 m) */
export function bboxCompatible(segment, trace) {
  if (!trace || trace.length < 2) return false;
  let la0 = 90; let lo0 = 180; let la1 = -90; let lo1 = -180;
  for (const [la, lo] of trace) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
  const m = 300 / M_PAR_DEG;
  const mlo = m / Math.cos((((la0 + la1) / 2) * Math.PI) / 180);
  const dedans = ([la, lo]) => la >= la0 - m && la <= la1 + m && lo >= lo0 - mlo && lo <= lo1 + mlo;
  return dedans(segment.points[0]) && dedans(segment.points[segment.points.length - 1]);
}

// Passages près d'un point : pour chaque groupe de tronçons de trace à moins de
// RAYON_PASSAGE_M, le plus proche. -> [{ i, t, d }] (tronçon i, position t)
function passagesPres(P, cible) {
  const res = [];
  let groupe = null;
  for (let i = 0; i < P.length - 1; i++) {
    const [d, t] = versSegment(cible, P[i], P[i + 1]);
    if (d <= RAYON_PASSAGE_M) {
      if (!groupe || d < groupe.d) groupe = { i, t, d };
    } else if (groupe) { res.push(groupe); groupe = null; }
  }
  if (groupe) res.push(groupe);
  return res;
}

/**
 * Passages d'une sortie sur un segment.
 * @param {{points: [lat, lon][], distanceM, denivelePosM}} segment
 * @param {{tS, lat?, lon?, puissanceW?, fc?, cadence?}[]} pts  points de la sortie (pointsDetail)
 * @returns {{debutS, finS, dureeS, iDebut, iFin, puissanceMoyW, fcMoy, cadenceMoy, vitesseMoyMs, vamMh}[]}
 */
export function trouverPassages(segment, pts) {
  const gps = [];
  pts.forEach((p, i) => { if (typeof p.lat === 'number' && typeof p.lon === 'number') gps.push(i); });
  if (gps.length < 2) return [];
  const [la0, lo0] = segment.points[0];
  const proj = projecteur(la0, lo0);
  const P = gps.map((i) => proj(pts[i].lat, pts[i].lon));
  const S = segment.points.map(([la, lo]) => proj(la, lo));
  const departs = passagesPres(P, S[0]);
  const arrivees = passagesPres(P, S[S.length - 1]);
  if (!departs.length || !arrivees.length) return [];
  // distance cumulée le long de la trace (tronçon i, position t)
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + dist(P[i - 1], P[i]));
  const le = (x) => cum[x.i] + x.t * (cum[x.i + 1] - cum[x.i]);
  const heure = (x) => pts[gps[x.i]].tS + x.t * (pts[gps[x.i + 1]].tS - pts[gps[x.i]].tS);
  // points du segment à vérifier en chemin (environ tous les 1/15 de sa longueur, au moins 25 m)
  const pas = Math.max(1, Math.round(Math.max(25, segment.distanceM / 15) / PAS_SEGMENT_M));
  const controles = S.filter((_, k) => k > 0 && k < S.length - 1 && k % pas === 0);

  const res = [];
  let apres = -1; // un passage ne commence qu'après la fin du précédent
  for (const a of departs) {
    if (le(a) <= apres) continue;
    for (const b of arrivees) {
      const longueur = le(b) - le(a);
      if (longueur <= 0) continue;
      if (longueur > segment.distanceM * 1.3 + 50) break; // trop loin : pas ce passage
      if (longueur < segment.distanceM * 0.8 - 50) continue;
      const suit = controles.every((c) => {
        for (let i = a.i; i <= Math.min(b.i, P.length - 2); i++) if (versSegment(c, P[i], P[i + 1])[0] <= ECART_TRACE_M) return true;
        return false;
      });
      if (!suit) continue;
      const debutS = heure(a);
      const finS = heure(b);
      const iDebut = gps[a.i];
      const iFin = gps[Math.min(b.i + 1, gps.length - 1)];
      res.push({ debutS, finS, dureeS: finS - debutS, iDebut, iFin, ...mesures(pts, iDebut, iFin, finS - debutS, segment) });
      apres = le(b);
      break;
    }
  }
  return res;
}

function mesures(pts, i0, i1, dureeS, segment) {
  const morceau = pts.slice(i0, i1 + 1);
  const moy = (champ, positifs) => {
    if (!morceau.some((p) => p[champ] > 0)) return null;
    const v = parSeconde(morceau, champ).filter((x) => !positifs || x > 0);
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
  };
  return {
    puissanceMoyW: moy('puissanceW', false),
    fcMoy: moy('fc', true),
    cadenceMoy: moy('cadence', true),
    vitesseMoyMs: dureeS > 0 ? segment.distanceM / dureeS : null,
    // VAM : mètres montés par heure (sur le dénivelé positif du segment)
    vamMh: dureeS > 0 && segment.denivelePosM ? Math.round((segment.denivelePosM / dureeS) * 3600) : null,
  };
}

// ---- Propositions de segments ---------------------------------------------------

/**
 * Montées d'une sortie (trace 3D lissée, pente sur 100 m) : on entre au-dessus de
 * 3 %, on sort sous 2 % ; gardées si au moins 500 m, +35 m et 4 % de moyenne
 * (mêmes critères que Parcours 3D).
 * @param {{n, tot, E, G, sPoint}} T  trace de construireTrace()
 * @returns {{i0, i1, distanceM, gainM, penteMoyPct}[]}  indices des points de la sortie
 */
export function detecterMontees(T, nbPoints) {
  const PAS = T.tot / (T.n - 1);
  const montees = [];
  let debut = null;
  for (let i = 0; i <= T.n; i++) {
    const g = i < T.n ? T.G[i] : -99;
    if (debut === null && g >= 3) debut = i;
    else if (debut !== null && g < 2) {
      const longueur = (i - 1 - debut) * PAS;
      const gain = T.E[i - 1] - T.E[debut];
      if (longueur >= 500 && gain >= 35 && (gain / longueur) * 100 >= 4) {
        montees.push({ s0: debut * PAS, s1: (i - 1) * PAS, distanceM: longueur, gainM: gain, penteMoyPct: (gain / longueur) * 100 });
      }
      debut = null;
    }
  }
  // distances le long de la trace -> indices des points de la sortie
  const indice = (s) => {
    let k = 0;
    while (k < nbPoints - 1 && T.sPoint[k + 1] <= s) k++;
    return k;
  };
  return montees.map((m) => ({ ...m, i0: indice(m.s0), i1: Math.min(nbPoints - 1, indice(m.s1) + 1) }));
}

/**
 * Sprints : suite de points au-dessus du seuil (W) pendant au moins 5 s ; le
 * segment va du premier point au-dessus du seuil au point qui suit le dernier
 * (avec un point toutes les 8 s, un sprint ne fait qu'un ou deux points).
 * @returns {{i0, i1, picW, dureeS, distanceM}[]}
 */
export function detecterSprints(pts, seuilW) {
  const res = [];
  let debut = null;
  let pic = 0;
  for (let i = 0; i <= pts.length; i++) {
    const w = i < pts.length ? pts[i].puissanceW ?? 0 : 0;
    if (w >= seuilW) {
      if (debut === null) { debut = i; pic = 0; }
      pic = Math.max(pic, w);
    } else if (debut !== null) {
      const fin = Math.min(pts.length - 1, i);
      const dureeS = pts[fin].tS - pts[debut].tS;
      const distanceM = pts[fin].distanceM - pts[debut].distanceM;
      if (dureeS >= 5 && distanceM >= 50) res.push({ i0: debut, i1: fin, picW: pic, dureeS, distanceM });
      debut = null;
    }
  }
  return res;
}

/** Rang de chaque passage (1 = meilleur temps) */
export function classer(passages) {
  const tries = [...passages].sort((a, b) => a.dureeS - b.dureeS);
  return new Map(tries.map((p, k) => [p, k + 1]));
}
