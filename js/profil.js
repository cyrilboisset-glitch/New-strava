// Réglages du cycliste (FTP, FC max) et meilleurs efforts gardés par sortie.
import { lireReglage, ecrireReglage, toutesLesSorties, lireFichier, completerSortie } from './db.js';
import { decoderFichier } from './fichier.js';
import { pointsDetail, parSeconde, meilleursEfforts, estimerFtp, JOURS_ESTIMATION_FTP } from './analyse.js';

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

/** Meilleurs efforts d'une sortie à partir de ses points ; gardés dans la sortie. */
export async function enregistrerEfforts(s, pts) {
  if (s.effortsW) return s.effortsW;
  const effortsW = pts.some((p) => p.puissanceW > 0) ? meilleursEfforts(parSeconde(pts, 'puissanceW')) : {};
  await completerSortie(s.id, () => ({ effortsW }));
  s.effortsW = effortsW;
  return effortsW;
}

/**
 * Estimation de la FTP : calcule d'abord les efforts manquants des sorties
 * des 6 dernières semaines (avec puissance), puis 95 % du meilleur 20 min.
 */
export async function estimerMaFtp(maintenantMs = Date.now()) {
  const depuis = maintenantMs - JOURS_ESTIMATION_FTP * 86400000;
  const recentes = (await toutesLesSorties()).filter((s) => s.debut >= depuis && s.debut <= maintenantMs);
  for (const s of recentes) {
    if (s.effortsW || !s.puissanceMoyW) continue;
    const fichier = await lireFichier(s.id);
    if (!fichier) continue;
    try {
      const { records } = await decoderFichier(fichier);
      await enregistrerEfforts(s, pointsDetail(records));
    } catch (e) {
      console.warn('Efforts non calculés', s.id, e);
    }
  }
  return estimerFtp(recentes, maintenantMs);
}
