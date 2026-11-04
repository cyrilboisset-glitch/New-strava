// Réglages du cycliste (FTP, FC max) et meilleurs efforts gardés par sortie.
import { lireReglage, ecrireReglage, toutesLesSorties, lireFichier, completerSortie } from './db.js';
import { decoderFichier } from './fichier.js';
import { pointsDetail, parSeconde, meilleursEfforts, estimerFtp, JOURS_ESTIMATION_FTP, VERSION_EFFORTS } from './analyse.js';

export const FTP_DEFAUT_W = 236; // valeur du BiNavi (zones_target) au 12 oct. 2026

/** { ftpW, fcMaxBpm, fcMaxReglee } ; FC max par défaut : la plus haute relevée */
export async function lireProfil(sorties = null) {
  const ftpW = (await lireReglage('ftpW')) ?? FTP_DEFAUT_W;
  const fcReglee = await lireReglage('fcMaxBpm');
  if (fcReglee) return { ftpW, fcMaxBpm: fcReglee, fcMaxReglee: true };
  const toutes = sorties ?? await toutesLesSorties();
  const fcMaxBpm = toutes.reduce((m, s) => Math.max(m, s.fcMax ?? 0), 0) || null;
  return { ftpW, fcMaxBpm, fcMaxReglee: false };
}

export async function ecrireProfil({ ftpW, fcMaxBpm }) {
  if (ftpW !== undefined) await ecrireReglage('ftpW', ftpW);
  if (fcMaxBpm !== undefined) await ecrireReglage('fcMaxBpm', fcMaxBpm);
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
