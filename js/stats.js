// Calculs de la page Progrès (sans navigateur, testés dans Node) :
// bilans par semaine / mois / année, forme et fatigue (CTL / ATL / TSB),
// records de puissance.
import { chargeSortie, estimerFtp, JOURS_ESTIMATION_FTP } from './analyse.js';
import { distanceCompteeM, denivelePosCompteM } from './sortie.js';

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
    p.distanceM += distanceCompteeM(s); // un workout virtuel n'ajoute que son temps
    p.dureeS += s.dureeChronoS ?? s.dureeTotaleS ?? 0;
    p.denivelePosM += denivelePosCompteM(s);
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

// ---- Objectifs (semaine, mois ou année en cours) --------------------------------------

export const TYPES_OBJECTIF = { distance: 'Distance', denivele: 'Dénivelé', ftp: 'FTP', seances: 'Séances de muscu', tempsmuscu: 'Temps de muscu' };
export const PERIODES_OBJECTIF = { semaine: 'Semaine', mois: 'Mois', annee: 'Année' };

/**
 * FTP estimée juste après une sortie : 95 % du meilleur 20 min des 6 semaines
 * qui finissent avec cette sortie (recalculée après chaque sortie).
 * @returns {{ftpW, puissance20W, sortie} | null}
 */
export function ftpApresSortie(s, sorties) {
  return estimerFtp(sorties, s.debut + (s.dureeChronoS ?? 0) * 1000);
}

/**
 * Historique de la FTP estimée : un point par sortie avec capteur dont on connaît le
 * meilleur 20 min ; chaque point = FTP estimée après cette sortie (95 % du meilleur 20 min
 * des `jours` qui finissent avec elle), les anciennes sorties comptent à leur vraie date.
 * `sorties` doivent porter effortsW. Les sorties sans effort de 20 min ne donnent pas de point.
 * @returns {{tMs, ftpW, puissance20W, sortie}[]} dans l'ordre du temps
 */
export function historiqueFtp(sorties, jours = JOURS_ESTIMATION_FTP) {
  const avec = sorties.filter((s) => s.effortsW?.[1200]).sort((a, b) => a.debut - b.debut);
  const points = [];
  let bas = 0;
  for (let i = 0; i < avec.length; i++) {
    const s = avec[i];
    const tMs = s.debut + (s.dureeChronoS ?? 0) * 1000;
    while (avec[bas].debut < tMs - jours * JOUR_MS) bas++;
    const r = estimerFtp(avec.slice(bas, i + 1), tMs, jours);
    if (r) points.push({ tMs, ftpW: r.ftpW, puissance20W: r.puissance20W, sortie: r.sortie });
  }
  return points;
}

/**
 * Où en est un objectif sur la période en cours.
 * Distance et dénivelé : total des sorties données (vélo) depuis le début de la période ;
 * « attendu » = cible × part de la période écoulée (rythme régulier).
 * FTP : FTP estimée aujourd'hui (recalculée après chaque sortie : 95 % du meilleur
 * 20 min des 6 dernières semaines) ; « attendu » = progression régulière depuis la
 * FTP estimée au début de la période (sinon la FTP réglée) jusqu'à la cible.
 * @param {{type: 'distance'|'denivele'|'ftp', periode: 'semaine'|'mois'|'annee', cible: number}} obj
 * @param {{ftpW?: number}} options  FTP réglée dans l'appli
 * @returns {{debutMs, finMs, fait, cible, part, attendu, ecart, reste, partEcoulee, joursRestants, sortieFtp?, departFtpW?}}
 */
/**
 * Courbe d'un objectif sur sa période (semaine, mois ou année) : la progression réelle (cumul des
 * sorties, un palier le jour de chaque sortie ; pour la FTP, la FTP estimée après chaque sortie) et
 * la progression régulière à avoir (ligne droite de 0 à l'objectif ; pour la FTP, de la FTP du début
 * de la période à l'objectif).
 * @returns {{debutMs, finMs, cible, maintenantMs, reel: {t, v}[], objectif: {t, v}[], totaux: {n, dureeS, distanceM, denivelePosM}}}
 */
export function courbeObjectif(obj, sorties, maintenantMs = Date.now(), { ftpW = null } = {}) {
  const a = avancementObjectif(obj, sorties, maintenantMs, { ftpW });
  const { debutMs, finMs, cible } = a;
  const dans = sorties.filter((s) => s.debut >= debutMs && s.debut < finMs && s.debut <= maintenantMs).sort((x, y) => x.debut - y.debut);
  const totaux = {
    n: dans.length, dureeS: dans.reduce((t, s) => t + (s.dureeChronoS ?? 0), 0),
    distanceM: dans.reduce((t, s) => t + distanceCompteeM(s), 0), denivelePosM: dans.reduce((t, s) => t + denivelePosCompteM(s), 0),
  };
  let reel;
  let objectif;
  if (obj.type === 'ftp') {
    const depart = a.departFtpW ?? ftpW ?? null;
    const points = historiqueFtp(sorties).filter((p) => p.tMs >= debutMs && p.tMs <= maintenantMs).map((p) => ({ t: p.tMs, v: p.ftpW }));
    reel = [...(depart != null ? [{ t: debutMs, v: depart }] : []), ...points];
    if (reel.length && reel[reel.length - 1].t < maintenantMs) reel.push({ t: maintenantMs, v: a.fait || reel[reel.length - 1].v });
    objectif = [{ t: debutMs, v: depart != null && depart < cible ? depart : cible }, { t: finMs, v: cible }];
  } else {
    const valeur = {
      distance: (s) => distanceCompteeM(s) / 1000, denivele: (s) => denivelePosCompteM(s),
      seances: () => 1, tempsmuscu: (s) => (s.dureeChronoS ?? 0) / 3600,
    }[obj.type];
    let cumul = 0;
    reel = [{ t: debutMs, v: 0 }];
    // un palier le jour de chaque sortie : la courbe monte pendant ce jour-là, reste plate entre deux sorties
    let jour = null;
    for (const s of dans) {
      const j = debutJour(s.debut);
      if (j !== jour) { if (j > reel[reel.length - 1].t) reel.push({ t: j, v: cumul }); jour = j; }
      cumul += valeur(s);
      const fin = Math.min(maintenantMs, j + JOUR_MS);
      const dernier = reel[reel.length - 1];
      if (dernier.t === fin) dernier.v = cumul; else reel.push({ t: fin, v: cumul });
    }
    if (reel[reel.length - 1].t < maintenantMs) reel.push({ t: maintenantMs, v: cumul });
    objectif = [{ t: debutMs, v: 0 }, { t: finMs, v: cible }];
  }
  return { debutMs, finMs, cible, maintenantMs, reel, objectif, totaux };
}

/** Valeur d'une courbe (points {t, v} dans l'ordre du temps) à l'instant t, par interpolation ; null hors de la courbe */
export function valeurCourbe(points, t) {
  if (!points.length || t < points[0].t || t > points[points.length - 1].t) return null;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const a = points[i - 1]; const b = points[i];
      return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    }
  }
  return points[points.length - 1].v;
}

/**
 * Repères de l'axe du temps d'une période : traits (début de chaque mois ou jour) et étiquettes.
 * @returns {{traits: number[], etiquettes: {t: number, texte: string}[]}}
 */
export function reperesPeriode(debutMs, finMs, periode) {
  const traits = [];
  const etiquettes = [];
  if (periode === 'annee') {
    const mois = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
    const d = new Date(debutMs);
    for (let m = 0; m < 12; m++) {
      const t = new Date(d.getFullYear(), m, 1).getTime();
      traits.push(t);
      if (m % 3 === 0) etiquettes.push({ t, texte: mois.format(t) });
    }
  } else if (periode === 'mois') {
    const d = new Date(debutMs);
    const nb = Math.round((finMs - debutMs) / JOUR_MS);
    for (let j = 0; j < nb; j++) {
      const t = new Date(d.getFullYear(), d.getMonth(), 1 + j).getTime();
      traits.push(t);
      if (j % 7 === 0) etiquettes.push({ t, texte: String(j + 1) });
    }
  } else {
    const jours = new Intl.DateTimeFormat('fr-FR', { weekday: 'narrow' });
    const d = new Date(debutMs);
    for (let j = 0; j < 7; j++) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + j).getTime();
      traits.push(t);
      etiquettes.push({ t, texte: jours.format(t).toUpperCase() });
    }
  }
  return { traits, etiquettes };
}

export function avancementObjectif(obj, sorties, maintenantMs = Date.now(), { ftpW = null } = {}) {
  const debutMs = debutPeriode(maintenantMs, obj.periode);
  const finMs = periodeSuivante(debutMs, obj.periode);
  const dans = sorties.filter((s) => s.debut >= debutMs && s.debut < finMs && s.debut <= maintenantMs);
  const partEcoulee = Math.min(1, Math.max(0, (maintenantMs - debutMs) / (finMs - debutMs)));
  const joursRestants = Math.max(0, (finMs - maintenantMs) / JOUR_MS);
  const cible = obj.cible;
  let fait = 0;
  let attendu = null;
  let sortieFtp = null;
  let departFtpW = null;
  if (obj.type === 'distance') { fait = dans.reduce((a, s) => a + distanceCompteeM(s), 0) / 1000; attendu = cible * partEcoulee; }
  else if (obj.type === 'denivele') { fait = dans.reduce((a, s) => a + denivelePosCompteM(s), 0); attendu = cible * partEcoulee; }
  // musculation : `sorties` ne contient que les séances ; le temps est compté en heures
  else if (obj.type === 'seances') { fait = dans.length; attendu = cible * partEcoulee; }
  else if (obj.type === 'tempsmuscu') { fait = dans.reduce((a, s) => a + (s.dureeChronoS ?? 0), 0) / 3600; attendu = cible * partEcoulee; }
  else {
    const maintenant = estimerFtp(sorties, maintenantMs);
    fait = maintenant?.ftpW ?? 0;
    sortieFtp = maintenant?.sortie ?? null;
    departFtpW = estimerFtp(sorties, debutMs - 1)?.ftpW ?? ftpW;
    attendu = departFtpW != null && departFtpW < cible ? departFtpW + (cible - departFtpW) * partEcoulee : cible;
  }
  return {
    debutMs, finMs, fait, cible, part: cible > 0 ? fait / cible : 0, attendu,
    ecart: attendu == null ? null : fait - attendu, reste: Math.max(0, cible - fait), partEcoulee, joursRestants, sortieFtp, departFtpW,
  };
}
