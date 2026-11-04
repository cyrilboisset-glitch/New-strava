// Calculs de la page Progrès (sans navigateur, testés dans Node) :
// bilans par semaine / mois / année, forme et fatigue (CTL / ATL / TSB),
// records de puissance.
import { chargeSortie } from './analyse.js';

const JOUR_MS = 86400000;
export const CONSTANTE_FORME_J = 42; // CTL : charge chronique (« forme »)
export const CONSTANTE_FATIGUE_J = 7; // ATL : charge aiguë (« fatigue »)

// ---- Périodes (heure locale, semaines du lundi au dimanche) -------------------

export function debutJour(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function debutPeriode(t, type) {
  const d = new Date(debutJour(t));
  if (type === 'semaine') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (type === 'mois') d.setDate(1);
  else { d.setMonth(0); d.setDate(1); }
  return d.getTime();
}

function periodeSuivante(t, type) {
  const d = new Date(t);
  if (type === 'semaine') d.setDate(d.getDate() + 7);
  else if (type === 'mois') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d.getTime();
}

function periodePrecedente(t, type) {
  const d = new Date(t);
  if (type === 'semaine') d.setDate(d.getDate() - 7);
  else if (type === 'mois') d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  return d.getTime();
}

/**
 * Totaux des `n` dernières périodes (la plus ancienne d'abord, la dernière
 * contient `maintenantMs`). Pour les années : de la première sortie à aujourd'hui.
 * @returns {{debut, fin, n, distanceM, dureeS, denivelePosM}[]}
 */
export function bilanPeriodes(sorties, type, n, maintenantMs = Date.now()) {
  const derniere = debutPeriode(maintenantMs, type);
  let premiere = derniere;
  if (type === 'annee') {
    const plusAncienne = sorties.reduce((m, s) => Math.min(m, s.debut), maintenantMs);
    premiere = debutPeriode(plusAncienne, type);
  } else {
    for (let i = 1; i < n; i++) premiere = periodePrecedente(premiere, type);
  }
  const periodes = [];
  for (let t = premiere; t <= derniere; t = periodeSuivante(t, type)) {
    periodes.push({ debut: t, fin: periodeSuivante(t, type), n: 0, distanceM: 0, dureeS: 0, denivelePosM: 0 });
  }
  for (const s of sorties) {
    const p = periodes.find((x) => s.debut >= x.debut && s.debut < x.fin);
    if (!p) continue;
    p.n++;
    p.distanceM += s.distanceM ?? 0;
    p.dureeS += s.dureeChronoS ?? s.dureeTotaleS ?? 0;
    p.denivelePosM += s.denivelePosM ?? 0;
  }
  return periodes;
}

// ---- Forme / fatigue / fraîcheur ------------------------------------------------

/**
 * Charge de chaque jour (somme des TSS) puis moyennes exponentielles :
 *   CTL(j) = CTL(j-1) + (TSS(j) - CTL(j-1)) / 42
 *   ATL(j) = ATL(j-1) + (TSS(j) - ATL(j-1)) / 7
 *   TSB(j) = CTL(j-1) - ATL(j-1)   (fraîcheur du matin, avant la sortie du jour)
 * Les sorties sans puissance n'ont pas de TSS : elles comptent pour 0.
 * @returns {{jour, tss, ctl, atl, tsb}[]}  du jour de la première sortie à aujourd'hui
 */
export function formeFatigue(sorties, ftpW, maintenantMs = Date.now()) {
  const tssParJour = new Map();
  let premier = null;
  for (const s of sorties) {
    const { tss } = chargeSortie(s, ftpW);
    const j = debutJour(s.debut);
    if (premier === null || j < premier) premier = j;
    if (tss) tssParJour.set(j, (tssParJour.get(j) ?? 0) + tss);
  }
  if (premier === null) return [];
  const res = [];
  let ctl = 0;
  let atl = 0;
  const fin = debutJour(maintenantMs);
  for (let j = premier; j <= fin; j = debutJour(j + JOUR_MS * 1.5)) {
    const tss = tssParJour.get(j) ?? 0;
    const tsb = ctl - atl;
    ctl += (tss - ctl) / CONSTANTE_FORME_J;
    atl += (tss - atl) / CONSTANTE_FATIGUE_J;
    res.push({ jour: j, tss, ctl, atl, tsb });
  }
  return res;
}

/** Lecture de la fraîcheur (TSB) en mots */
export function etatFraicheur(tsb) {
  if (tsb > 25) return 'Très reposé : la forme baisse si ça dure';
  if (tsb > 5) return 'Frais : bon moment pour un objectif';
  if (tsb >= -10) return 'Équilibré';
  if (tsb >= -30) return 'Fatigué : charge qui fait progresser';
  return 'Très fatigué : attention au surmenage';
}

// ---- Records -----------------------------------------------------------------------

/**
 * Meilleure valeur pour chaque durée parmi les sorties (efforts gardés
 * dans s.effortsW), éventuellement depuis une date.
 * @returns {Object<number, {w, sortie}>}
 */
export function records(sorties, durees, depuisMs = -Infinity) {
  const res = {};
  for (const d of durees) res[d] = null;
  for (const s of sorties) {
    if (s.debut < depuisMs || !s.effortsW) continue;
    for (const d of durees) {
      const w = s.effortsW[d];
      if (w && (!res[d] || w > res[d].w)) res[d] = { w, sortie: s };
    }
  }
  return res;
}
