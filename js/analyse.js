// Calculs du détail d'une sortie : points pour les courbes, puissance
// seconde par seconde, meilleurs efforts, zones, IF / TSS, estimation de FTP.
// Sans dépendance au navigateur : testé dans Node (tests/test-analyse.mjs).
import { distanceM } from './trace.js';

export const TROU_MAX_S = 10; // au-delà : pause, les secondes du trou ne comptent pas
// Durées des meilleurs efforts (courbe de puissance) ; VERSION_EFFORTS à
// augmenter si cette liste change (les efforts gardés sont alors recalculés)
export const DUREES_EFFORTS_S = [1, 5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400, 7200];
export const VERSION_EFFORTS = 2;
export const JOURS_ESTIMATION_FTP = 42; // 6 semaines
export const PART_FTP_20_MIN = 0.95; // FTP ≈ 95 % de la meilleure puissance sur 20 min

/**
 * Points normalisés pour les courbes et la carte.
 * @param {{horodatage: Date, distanceM?, lat?, lon?, altitudeM?, vitesseMs?, puissanceW?, fc?, cadence?}[]} records
 * @returns {{tS, distanceM, altitudeM?, vitesseMs?, puissanceW?, fc?, cadence?, lat?, lon?}[]}
 */
export function pointsDetail(records) {
  const recs = records.filter((r) => r.horodatage instanceof Date).sort((a, b) => a.horodatage - b.horodatage);
  if (!recs.length) return [];
  const t0 = recs[0].horodatage.getTime();
  const avecDistance = recs.filter((r) => typeof r.distanceM === 'number').length > recs.length / 2;
  let cumul = 0;
  let precedent = null;
  const pts = recs.map((r) => {
    if (avecDistance) {
      if (typeof r.distanceM === 'number') cumul = Math.max(cumul, r.distanceM);
    } else if (typeof r.lat === 'number') {
      if (precedent) cumul += distanceM(precedent, r);
      precedent = r;
    }
    const p = { tS: (r.horodatage.getTime() - t0) / 1000, distanceM: cumul };
    for (const c of ['altitudeM', 'vitesseMs', 'puissanceW', 'fc', 'cadence', 'lat', 'lon']) {
      if (typeof r[c] === 'number') p[c] = r[c];
    }
    return p;
  });

  // Vitesse absente du fichier (GPX, TCX) : distance parcourue sur ±15 s
  if (!pts.some((p) => typeof p.vitesseMs === 'number') && cumul > 0) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < pts.length; i++) {
      while (pts[a].tS < pts[i].tS - 15) a++;
      while (b < pts.length - 1 && pts[b + 1].tS <= pts[i].tS + 15) b++;
      const dt = pts[b].tS - pts[a].tS;
      if (dt > 0 && dt <= 30 + TROU_MAX_S) pts[i].vitesseMs = (pts[b].distanceM - pts[a].distanceM) / dt;
    }
  }
  return pts;
}

/**
 * Valeurs seconde par seconde : chaque point tient sa valeur jusqu'au
 * suivant ; les trous de plus de TROU_MAX_S (pauses) sont sautés.
 */
export function parSeconde(pts, champ) {
  const res = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dt = Math.round(pts[i + 1].tS - pts[i].tS);
    if (dt <= 0 || dt > TROU_MAX_S) continue;
    const v = typeof pts[i][champ] === 'number' ? pts[i][champ] : 0;
    for (let k = 0; k < dt; k++) res.push(v);
  }
  return res;
}

// Puissance normalisée : moyenne glissante 30 s, puissance 4, moyenne, racine 4.
export function puissanceNormalisee(secondes) {
  if (secondes.length < 30) return null;
  let somme = 0;
  let total4 = 0;
  for (let i = 0; i < secondes.length; i++) {
    somme += secondes[i];
    if (i >= 30) somme -= secondes[i - 30];
    if (i >= 29) total4 += (somme / 30) ** 4;
  }
  return (total4 / (secondes.length - 29)) ** 0.25;
}

/** Meilleure moyenne sur chaque durée (s) -> { 5: W, 60: W, … } (null si trop court) */
export function meilleursEfforts(secondes, durees = DUREES_EFFORTS_S) {
  const res = {};
  for (const d of durees) {
    if (secondes.length < d) { res[d] = null; continue; }
    let somme = 0;
    for (let i = 0; i < d; i++) somme += secondes[i];
    let max = somme;
    for (let i = d; i < secondes.length; i++) {
      somme += secondes[i] - secondes[i - d];
      if (somme > max) max = somme;
    }
    res[d] = Math.round(max / d);
  }
  return res;
}

/** Écart le plus fréquent entre deux points (s) : 1 = enregistrement à la seconde */
export function intervalleTypiqueS(pts) {
  const compte = new Map();
  for (let i = 1; i < pts.length; i++) {
    const dt = Math.round(pts[i].tS - pts[i - 1].tS);
    if (dt > 0 && dt <= TROU_MAX_S) compte.set(dt, (compte.get(dt) ?? 0) + 1);
  }
  let meilleur = null;
  for (const [dt, n] of compte) if (!meilleur || n > meilleur[1]) meilleur = [dt, n];
  return meilleur ? meilleur[0] : null;
}

// ---- Zones -----------------------------------------------------------------

// Zones de puissance de Coggan, en part de la FTP (borne haute incluse)
export const ZONES_PUISSANCE = [
  { nom: 'Z1', libelle: 'Récupération', max: 0.55 },
  { nom: 'Z2', libelle: 'Endurance', max: 0.75 },
  { nom: 'Z3', libelle: 'Tempo', max: 0.90 },
  { nom: 'Z4', libelle: 'Seuil', max: 1.05 },
  { nom: 'Z5', libelle: 'VO2max', max: 1.20 },
  { nom: 'Z6', libelle: 'Anaérobie', max: 1.50 },
  { nom: 'Z7', libelle: 'Neuromusculaire', max: Infinity },
];

// Zones de fréquence cardiaque, en part de la FC max
export const ZONES_FC = [
  { nom: 'Z1', libelle: 'Très facile', max: 0.60 },
  { nom: 'Z2', libelle: 'Endurance', max: 0.70 },
  { nom: 'Z3', libelle: 'Tempo', max: 0.80 },
  { nom: 'Z4', libelle: 'Seuil', max: 0.90 },
  { nom: 'Z5', libelle: 'Maximum', max: Infinity },
];

/**
 * Temps passé dans chaque zone.
 * @returns {{nom, libelle, minV, maxV, secondes}[]}  minV/maxV en W ou bpm (arrondis)
 */
export function tempsParZone(secondes, zones, reference) {
  const bornes = zones.map((z) => (Number.isFinite(z.max) ? Math.round(reference * z.max) : Infinity));
  const res = zones.map((z, i) => ({
    nom: z.nom, libelle: z.libelle, minV: i ? bornes[i - 1] + 1 : 0, maxV: bornes[i], secondes: 0,
  }));
  for (const v of secondes) {
    let i = 0;
    while (v > bornes[i]) i++;
    res[i].secondes++;
  }
  return res;
}

// ---- Charge ------------------------------------------------------------------

/**
 * IF et TSS d'une sortie avec la FTP de l'appli. Si le compteur les a
 * calculés avec la même FTP, on garde ses valeurs.
 * TSS = durée (s) × IF² / 36  (= durée × NP × IF / (FTP × 3600) × 100)
 */
export function chargeSortie(s, ftpW) {
  if (!s.puissanceNormW && s.puissanceEstimee?.normW && ftpW) {
    // pas de capteur : puissance estimée (vitesse, pente, poids)
    const fi = s.puissanceEstimee.normW / ftpW;
    const dureeS = s.dureeChronoS ?? s.dureeTotaleS;
    return { tss: dureeS ? (dureeS * fi * fi) / 36 : null, facteurIntensite: fi, source: 'estimee' };
  }
  if (!s.puissanceNormW || !ftpW) return { tss: null, facteurIntensite: null, source: null };
  if (s.tss != null && s.ftpCompteurW === ftpW) {
    return { tss: s.tss, facteurIntensite: s.facteurIntensite ?? s.puissanceNormW / ftpW, source: 'compteur' };
  }
  const fi = s.puissanceNormW / ftpW;
  const dureeS = s.dureeChronoS ?? s.dureeTotaleS;
  return { tss: dureeS ? (dureeS * fi * fi) / 36 : null, facteurIntensite: fi, source: 'appli' };
}

/**
 * FTP estimée : 95 % de la meilleure puissance sur 20 min des 6 dernières
 * semaines. `sorties` doivent porter effortsW (voir meilleursEfforts).
 * @returns {{ftpW, puissance20W, sortie} | null}
 */
export function estimerFtp(sorties, maintenantMs = Date.now(), jours = JOURS_ESTIMATION_FTP) {
  const depuis = maintenantMs - jours * 86400000;
  let meilleure = null;
  for (const s of sorties) {
    const p20 = s.effortsW?.[1200];
    if (s.debut < depuis || s.debut > maintenantMs || !p20) continue;
    if (!meilleure || p20 > meilleure.puissance20W) meilleure = { puissance20W: p20, sortie: s };
  }
  if (!meilleure) return null;
  return { ftpW: Math.round(meilleure.puissance20W * PART_FTP_20_MIN), ...meilleure };
}
