// Sauvegarde complète dans un zip (sorties, fichiers d'origine, réglages),
// et restauration de ce zip (par « Importer un fichier »).
import { toutesLesSorties, lireFichier, sortieExiste, enregistrerSortie, lireReglage, ecrireReglage } from './db.js';

export const NOM_INDEX = 'sauvegarde-mes-sorties.json';
const FORMAT = 'mes-sorties';
const VERSION_SAUVEGARDE = 1;
const ECART_DOUBLON_MS = 60 * 1000;

const nomSur = (id) => String(id).replace(/[^\w.-]+/g, '_');

/**
 * Crée le zip de sauvegarde.
 * @param {(texte: string) => void} progression
 * @returns {Promise<{blob: Blob, nomFichier: string, nbSorties: number}>}
 */
export async function creerSauvegarde(progression = () => {}) {
  const zip = new globalThis.JSZip();
  const sorties = await toutesLesSorties();
  const index = {
    format: FORMAT,
    version: VERSION_SAUVEGARDE,
    creeLe: new Date().toISOString(),
    reglages: {
      ftpW: await lireReglage('ftpW') ?? null,
      fcMaxBpm: await lireReglage('fcMaxBpm') ?? null,
      poidsKg: await lireReglage('poidsKg') ?? null,
      velos: await lireReglage('velos') ?? null,
    },
    sorties: [],
  };
  let i = 0;
  for (const s of sorties) {
    progression(`Sauvegarde : ${++i} / ${sorties.length}`);
    const f = await lireFichier(s.id);
    let fichier = null;
    if (f?.octets) {
      const format = f.format ?? 'fit';
      fichier = { chemin: `fichiers/${nomSur(s.id)}.${format}${f.gzip ? '.gz' : ''}`, format, gzip: !!f.gzip };
      zip.file(fichier.chemin, f.octets);
    }
    index.sorties.push({ resume: s, fichier });
  }
  zip.file(NOM_INDEX, JSON.stringify(index));
  progression('Compression…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
  const jour = new Date().toISOString().slice(0, 10);
  await ecrireReglage('derniereSauvegarde', Date.now());
  return { blob, nomFichier: `mes-sorties-sauvegarde-${jour}.zip`, nbSorties: sorties.length };
}

/** Propose le fichier : enregistrement dans Téléchargements. */
export function telecharger(blob, nomFichier) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Restaure un zip de sauvegarde déjà ouvert (JSZip). Les sorties déjà
 * présentes (même identifiant ou même départ à 1 min près) sont sautées.
 */
export async function restaurerSauvegarde(zip, bilan, connues, progression = () => {}) {
  const index = JSON.parse(await zip.file(NOM_INDEX).async('string'));
  if (index.format !== FORMAT) throw new Error('sauvegarde inconnue');
  // Réglages repris seulement s'ils ne sont pas déjà faits sur ce téléphone
  for (const cle of ['ftpW', 'fcMaxBpm', 'poidsKg', 'velos']) {
    if (index.reglages?.[cle] && (await lireReglage(cle)) == null) await ecrireReglage(cle, index.reglages[cle]);
  }
  let i = 0;
  for (const { resume, fichier } of index.sorties) {
    progression(`Restauration : ${++i} / ${index.sorties.length}`);
    if (!resume?.id || !resume.debut) { bilan.ignores++; continue; }
    if (await sortieExiste(resume.id) || connues.some((c) => Math.abs(c.debut - resume.debut) < ECART_DOUBLON_MS)) {
      bilan.dejaLa++;
      continue;
    }
    const entree = fichier && zip.file(fichier.chemin);
    const octets = entree ? await entree.async('arraybuffer') : null;
    if (fichier && !octets) bilan.erreurs.push(`${fichier.chemin} : absent de la sauvegarde`);
    await enregistrerSortie(resume, octets, octets ? { format: fichier.format, gzip: fichier.gzip } : null);
    connues.push({ id: resume.id, debut: resume.debut });
    bilan.nouvelles++;
  }
}
