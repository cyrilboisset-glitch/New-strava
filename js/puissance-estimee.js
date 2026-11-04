// Puissance estimée quand la sortie n'a pas de capteur : modèle physique
// (le même que le temps estimé de Parcours 3D) à partir de la vitesse, de
// la pente et de la masse. Sans vent : c'est une estimation (±20 % environ).
// Sans navigateur : testé dans Node (tests/test-estimation.mjs).

export const MODELE = {
  masseVeloKg: 8, // vélo + bidons
  cda: 0.32, // surface frontale × coefficient de traînée (m²), position route
  crr: 0.004, // résistance au roulement
  rendement: 0.97, // pertes de la transmission
  rhoKgM3: 1.2, // masse volumique de l'air (environ 20 °C, faible altitude)
  g: 9.81,
};
export const VERSION_ESTIMATION = 1;
const DEMI_FENETRE_PENTE_M = 50; // pente mesurée sur ±50 m
const DEMI_FENETRE_ACCEL_S = 10; // accélération mesurée sur ±10 s
const VITESSE_MINI_MS = 1; // en dessous : à l'arrêt
const PUISSANCE_MAXI_W = 1500;

/**
 * Puissance estimée en chaque point (W), ou null si la vitesse est inconnue.
 * @param {{tS, distanceM, altitudeM?, vitesseMs?}[]} pts  points (pointsDetail)
 * @param {number} poidsKg  poids du cycliste
 */
export function estimerPuissance(pts, poidsKg, modele = MODELE) {
  const n = pts.length;
  const m = poidsKg + modele.masseVeloKg;
  const res = new Array(n).fill(null);
  const avecAlt = pts.filter((p) => typeof p.altitudeM === 'number').length > n * 0.8;
  let a = 0; let b = 0; // fenêtre de pente (distance)
  let c = 0; let d = 0; // fenêtre d'accélération (temps)
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const v = p.vitesseMs;
    if (typeof v !== 'number') continue;
    if (v < VITESSE_MINI_MS) { res[i] = 0; continue; }
    // pente sur ±50 m
    while (pts[a].distanceM < p.distanceM - DEMI_FENETRE_PENTE_M) a++;
    while (b < n - 1 && pts[b + 1].distanceM <= p.distanceM + DEMI_FENETRE_PENTE_M) b++;
    let pente = 0;
    const dd = pts[b].distanceM - pts[a].distanceM;
    if (avecAlt && dd > 20 && typeof pts[a].altitudeM === 'number' && typeof pts[b].altitudeM === 'number') {
      pente = Math.max(-0.25, Math.min(0.25, (pts[b].altitudeM - pts[a].altitudeM) / dd));
    }
    // accélération sur ±10 s
    while (pts[c].tS < p.tS - DEMI_FENETRE_ACCEL_S) c++;
    while (d < n - 1 && pts[d + 1].tS <= p.tS + DEMI_FENETRE_ACCEL_S) d++;
    let acc = 0;
    const dt = pts[d].tS - pts[c].tS;
    if (dt > 2 && typeof pts[c].vitesseMs === 'number' && typeof pts[d].vitesseMs === 'number') acc = (pts[d].vitesseMs - pts[c].vitesseMs) / dt;
    const theta = Math.atan(pente);
    const roues = m * modele.g * (modele.crr * Math.cos(theta) + Math.sin(theta)) * v;
    const air = 0.5 * modele.rhoKgM3 * modele.cda * v ** 3;
    const inertie = m * acc * v;
    const w = (roues + air + inertie) / modele.rendement;
    res[i] = Math.max(0, Math.min(PUISSANCE_MAXI_W, w)); // roue libre en descente : 0
  }
  return res;
}

/** Peut-on estimer ? Sortie vélo dehors (pas home trainer ni virtuel), avec GPS. */
export function estimationPossible(s) {
  return (s.sport === 2 || s.sport === 21) && s.sousSport !== 6 && s.sousSport !== 58
    && !s.puissanceMoyW && !s.sansTrace && (s.trace?.length ?? 0) > 1;
}
