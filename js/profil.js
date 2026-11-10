// Réglages du cycliste (FTP, FC max) et meilleurs efforts gardés par sortie.
import { lireReglage, ecrireReglage, toutesLesSorties, lireFichier, completerSortie } from './db.js';
import { decoderFichier } from './fichier.js';
import { pointsDetail, parSeconde, meilleursEfforts, estimerFtp, JOURS_ESTIMATION_FTP, VERSION_EFFORTS, puissanceNormalisee } from './analyse.js';
import { valeursTrace, VERSION_VALEURS_TRACE } from './couleurs-trace.js';
import { estimerPuissance, estimationPossible, VERSION_ESTIMATION } from './puissance-estimee.js';

export const FTP_DEFAUT_W = 236; // valeur du BiNavi (zones_target) au 12 oct. 2026
export const POIDS_DEFAUT_KG = 98; // donné par Cyril le 4 nov. 2026

/** { ftpW, poidsKg, fcMaxBpm, fcMaxReglee } ; FC max par défaut : la plus haute relevée */
export async function lireProfil(sorties = null) {
  const ftpW = (await lireReglage('ftpW')) ?? FTP_DEFAUT_W;
  const poidsKg = (await lireReglage('poidsKg')) ?? POIDS_DEFAUT_KG;
  const fcReglee = await lireReglage('fcMaxBpm');
  if (fcReglee) return { ftpW, poidsKg, fcMaxBpm: fcReglee, fcMaxReglee: true };
  const toutes = sorties ?? await toutesLesSorties();
  const fcMaxBpm = toutes.reduce((m, s) => Math.max(m, s.fcMax ?? 0), 0) || null;
  return { ftpW, poidsKg, fcMaxBpm, fcMaxReglee: false };
}

export async function ecrireProfil({ ftpW, fcMaxBpm, poidsKg }) {
  if (ftpW !== undefined) await ecrireReglage('ftpW', ftpW);
  if (fcMaxBpm !== undefined) await ecrireReglage('fcMaxBpm', fcMaxBpm);
  if (poidsKg !== undefined) await ecrireReglage('poidsKg', poidsKg);
}

/** « 2,4 W/kg » */
export const wKg = (w, poidsKg) => (w && poidsKg ? (w / poidsKg).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null);

// ---- Vélos (saisis à la main dans Profil) ---------------------------------------
// { id, nom, kmAvantM : distance déjà faite avant l'appli (m), parDefaut : mis
//   d'office sur les nouvelles sorties vélo, retire : vélo vendu / rangé }

export async function lireVelos() {
  return (await lireReglage('velos')) ?? [];
}

export async function ecrireVelos(velos) {
  // un seul vélo par défaut au plus
  let defaut = false;
  for (const v of velos) {
    if (v.parDefaut && !defaut && !v.retire) defaut = true;
    else v.parDefaut = false;
  }
  await ecrireReglage('velos', velos);
}

export function nouvelIdVelo() {
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Kilométrage de chaque vélo : { [id]: { distanceM, n, derniere } } (sorties + km d'avant) */
export function bilanVelos(velos, sorties) {
  const res = {};
  for (const v of velos) res[v.id] = { distanceM: v.kmAvantM ?? 0, n: 0, derniere: null, dureeS: 0 };
  for (const s of sorties) {
    const b = s.veloId && res[s.veloId];
    if (!b) continue;
    b.distanceM += s.distanceM ?? 0;
    b.dureeS += s.dureeChronoS ?? 0;
    b.n++;
    if (!b.derniere || s.debut > b.derniere) b.derniere = s.debut;
  }
  return res;
}

export const effortsAJour = (s) => s.effortsV === VERSION_EFFORTS;

/** Meilleurs efforts d'une sortie à partir de ses points ; gardés dans la sortie. */
export async function enregistrerEfforts(s, pts) {
  if (effortsAJour(s)) return s.effortsW;
  const effortsW = pts.some((p) => p.puissanceW > 0) ? meilleursEfforts(parSeconde(pts, 'puissanceW')) : {};
  await completerSortie(s.id, () => ({ effortsW, effortsV: VERSION_EFFORTS }));
  s.effortsW = effortsW;
  s.effortsV = VERSION_EFFORTS;
  return effortsW;
}

/**
 * Calcule les efforts des sorties avec puissance qui ne les ont pas encore
 * (relit leur fichier). Long la première fois ; ensuite tout est gardé.
 * @param {object[]} sorties  modifiées en place (effortsW, effortsV)
 * @param {(fait: number, total: number) => void} progression
 */
/** Puissance estimée d'une sortie sans capteur, à partir de ses points ; gardée dans la sortie */
export function resumerEstimation(pts, poidsKg) {
  const w = estimerPuissance(pts, poidsKg);
  pts.forEach((p, i) => { if (w[i] !== null) p.puissanceEstimeeW = w[i]; });
  const sec = parSeconde(pts, 'puissanceEstimeeW');
  if (sec.length < 60) return null;
  return {
    moyW: Math.round(sec.reduce((a, v) => a + v, 0) / sec.length),
    normW: Math.round(puissanceNormalisee(sec)),
    v: VERSION_ESTIMATION,
    poidsKg,
  };
}

export const estimationAJour = (s, poidsKg) => s.puissanceEstimee?.v === VERSION_ESTIMATION && s.puissanceEstimee.poidsKg === poidsKg;

let estimationsEnCours = null;
/**
 * Estime la puissance des sorties vélo sans capteur qui ne l'ont pas encore
 * (ou avec un ancien poids). En arrière-plan ; un seul calcul à la fois.
 */
export function calculerEstimationsManquantes() {
  if (!estimationsEnCours) {
    estimationsEnCours = (async () => {
      const { poidsKg } = await lireProfil();
      const aFaire = (await toutesLesSorties()).filter((s) => estimationPossible(s) && !estimationAJour(s, poidsKg));
      for (const s of aFaire) {
        const f = await lireFichier(s.id);
        let est = null;
        try {
          if (f) est = resumerEstimation(pointsDetail((await decoderFichier(f)).records), poidsKg);
        } catch (e) { console.warn('Estimation impossible', s.id, e); }
        await completerSortie(s.id, () => ({ puissanceEstimee: est ?? { v: VERSION_ESTIMATION, poidsKg, moyW: null, normW: null } }));
      }
      return aFaire.length;
    })().finally(() => { estimationsEnCours = null; });
  }
  return estimationsEnCours;
}

let valeursEnCours = null;
/**
 * Valeurs de la trace (vitesse, puissance, FC, pente, altitude aux ~160 points de la liste)
 * des sorties importées avant la couleur du tracé. En arrière-plan ; un seul calcul à la fois.
 * @param {(fait: number, total: number) => void} progression
 */
export function calculerValeursTraceManquantes(progression = () => {}) {
  if (!valeursEnCours) {
    valeursEnCours = (async () => {
      const aFaire = (await toutesLesSorties()).filter((s) => s.trace?.length > 1 && s.traceValeurs?.v !== VERSION_VALEURS_TRACE);
      let fait = 0;
      for (const s of aFaire) {
        let valeurs = null;
        try {
          const f = await lireFichier(s.id);
          if (f) valeurs = valeursTrace((await decoderFichier(f)).records);
        } catch (e) { console.warn('Valeurs de la trace impossibles', s.id, e); }
        await completerSortie(s.id, () => ({ traceValeurs: valeurs ?? { v: VERSION_VALEURS_TRACE } }));
        if (++fait % 100 === 0) progression(fait, aFaire.length);
      }
      return aFaire.length;
    })().finally(() => { valeursEnCours = null; });
  }
  return valeursEnCours;
}

export async function calculerEffortsManquants(sorties, progression = () => {}) {
  const aFaire = sorties.filter((s) => s.puissanceMoyW && !effortsAJour(s));
  let fait = 0;
  for (const s of aFaire) {
    progression(fait, aFaire.length);
    const fichier = await lireFichier(s.id);
    try {
      const pts = fichier ? pointsDetail((await decoderFichier(fichier)).records) : [];
      await enregistrerEfforts(s, pts);
    } catch (e) {
      console.warn('Efforts non calculés', s.id, e);
      await enregistrerEfforts(s, []); // fichier illisible : on ne réessaie pas
    }
    fait++;
  }
  progression(fait, aFaire.length);
  return aFaire.length;
}

// ---- Réglage automatique de la FTP (demandé par Cyril le 5 nov. 2026) ---------------
// Après chaque import : si 95 % du meilleur 20 min des 6 dernières semaines dépasse la
// FTP réglée, elle monte à cette valeur. Elle ne baisse jamais toute seule (sinon elle
// chuterait après 6 semaines sans effort de 20 min à fond). Réglage `ftpAuto` (oui par
// défaut) ; hausses gardées dans `ftpHausses` [{ le, avantW, ftpW, sortieId, sortieDebut }].

export const lireFtpAuto = async () => (await lireReglage('ftpAuto')) !== false;
export const ecrireFtpAuto = (oui) => ecrireReglage('ftpAuto', !!oui);
export const lireHaussesFtp = async () => (await lireReglage('ftpHausses')) ?? [];

/** @returns {Promise<{avantW, ftpW, sortie} | null>}  la hausse faite, ou null */
export async function reglerFtpAuto(maintenantMs = Date.now()) {
  if (!(await lireFtpAuto())) return null;
  const r = await estimerMaFtp(maintenantMs);
  if (!r) return null;
  const avantW = (await lireReglage('ftpW')) ?? FTP_DEFAUT_W;
  if (r.ftpW <= avantW) return null;
  await ecrireReglage('ftpW', r.ftpW);
  const hausses = await lireHaussesFtp();
  hausses.push({ le: maintenantMs, avantW, ftpW: r.ftpW, sortieId: r.sortie.id, sortieDebut: r.sortie.debut });
  await ecrireReglage('ftpHausses', hausses.slice(-50));
  return { avantW, ftpW: r.ftpW, sortie: r.sortie };
}

/**
 * Estimation de la FTP : calcule d'abord les efforts manquants des sorties
 * des 6 dernières semaines (avec puissance), puis 95 % du meilleur 20 min.
 */
export async function estimerMaFtp(maintenantMs = Date.now()) {
  const depuis = maintenantMs - JOURS_ESTIMATION_FTP * 86400000;
  const recentes = (await toutesLesSorties()).filter((s) => s.debut >= depuis && s.debut <= maintenantMs);
  await calculerEffortsManquants(recentes);
  return estimerFtp(recentes, maintenantMs);
}
