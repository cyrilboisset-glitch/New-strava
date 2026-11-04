// Réglages du cycliste (FTP, FC max) et meilleurs efforts gardés par sortie.
import { lireReglage, ecrireReglage, toutesLesSorties, lireFichier, completerSortie } from './db.js';
import { decoderFichier } from './fichier.js';
import { pointsDetail, parSeconde, meilleursEfforts, estimerFtp, JOURS_ESTIMATION_FTP, VERSION_EFFORTS } from './analyse.js';

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
