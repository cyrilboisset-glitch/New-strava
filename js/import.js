// Import des sorties : depuis le zip de Gadgetbridge, un fichier FIT seul,
// ou le dossier d'export choisi sur le téléphone.
import { lireFit, TYPE_FICHIER_ACTIVITE } from './fit.js';
import { resumerSortie, identifiantSortie } from './sortie.js';
import { toutesLesSorties, sortieExiste, enregistrerSortie, lireReglage, ecrireReglage } from './db.js';

const ECART_DOUBLON_MS = 60 * 1000; // même départ à 1 min près = même sortie

function compteur() {
  return { nouvelles: 0, dejaLa: 0, ignores: 0, erreurs: [] };
}

// Un FIT (ArrayBuffer) -> enregistré s'il est nouveau.
async function importerFit(octets, nom, bilan, departsConnus) {
  let entete;
  try {
    entete = lireFit(octets, { seulementEntete: true });
  } catch (e) {
    bilan.erreurs.push(`${nom} : ${e.message}`);
    return;
  }
  if (entete.fileId?.type !== TYPE_FICHIER_ACTIVITE) { bilan.ignores++; return; }

  const idProvisoire = identifiantSortie(entete);
  if (idProvisoire && await sortieExiste(idProvisoire)) { bilan.dejaLa++; return; }

  let fit;
  try {
    fit = lireFit(octets);
  } catch (e) {
    bilan.erreurs.push(`${nom} : ${e.message}`);
    return;
  }
  const resume = resumerSortie(fit, nom);
  if (!resume.id || !resume.debut) { bilan.ignores++; return; }
  if (await sortieExiste(resume.id)) { bilan.dejaLa++; return; }
  // Même sortie déjà présente sous un autre fichier (copie, autre export)
  if (departsConnus.some((t) => Math.abs(t - resume.debut) < ECART_DOUBLON_MS)) { bilan.dejaLa++; return; }

  await enregistrerSortie(resume, octets);
  departsConnus.push(resume.debut);
  bilan.nouvelles++;
}

async function departsDejaConnus() {
  return (await toutesLesSorties()).map((s) => s.debut);
}

/**
 * Importe une liste de fichiers (.zip ou .fit).
 * @param {{nom: string, lire: () => Promise<ArrayBuffer|Blob>}[]} fichiers
 * @param {(texte: string) => void} progression
 */
export async function importerFichiers(fichiers, progression = () => {}) {
  const bilan = compteur();
  const departs = await departsDejaConnus();
  for (const f of fichiers) {
    if (/\.zip$/i.test(f.nom)) {
      await importerZip(await f.lire(), f.nom, bilan, departs, progression);
    } else if (/\.fit$/i.test(f.nom)) {
      progression(`Lecture de ${f.nom}…`);
      const contenu = await f.lire();
      const octets = contenu instanceof ArrayBuffer ? contenu : await contenu.arrayBuffer();
      await importerFit(octets, f.nom, bilan, departs);
    } else {
      bilan.ignores++;
    }
  }
  return bilan;
}

async function importerZip(contenu, nomZip, bilan, departs, progression) {
  progression(`Ouverture de ${nomZip}…`);
  let zip;
  try {
    zip = await globalThis.JSZip.loadAsync(contenu);
  } catch (e) {
    bilan.erreurs.push(`${nomZip} : zip illisible (${e.message})`);
    return;
  }
  const entrees = Object.values(zip.files).filter((e) => !e.dir && /\.fit$/i.test(e.name));
  let i = 0;
  for (const e of entrees) {
    i++;
    progression(`Fichiers FIT : ${i} / ${entrees.length}`);
    const octets = await e.async('arraybuffer');
    await importerFit(octets, e.name.split('/').pop(), bilan, departs);
  }
}

// ---- Dossier d'export de Gadgetbridge ----------------------------------

export const dossierPossible = typeof globalThis.showDirectoryPicker === 'function';

export async function choisirDossier() {
  const dossier = await globalThis.showDirectoryPicker({ id: 'gadgetbridge', mode: 'read' });
  try { await ecrireReglage('dossier', dossier); } catch { /* handle non mémorisable */ }
  await ecrireReglage('dernierZip', null);
  return dossier;
}

export async function dossierMemorise() {
  try { return (await lireReglage('dossier')) ?? null; } catch { return null; }
}

// 'granted', 'prompt' ou 'denied'
export async function etatAutorisation(dossier) {
  try { return await dossier.queryPermission({ mode: 'read' }); } catch { return 'prompt'; }
}

export async function demanderAutorisation(dossier) {
  try { return (await dossier.requestPermission({ mode: 'read' })) === 'granted'; } catch { return false; }
}

/**
 * Lit le zip le plus récent du dossier (et les .fit posés à côté).
 * Ne relit pas un zip déjà traité, sauf si `forcer`.
 */
export async function synchroniserDossier(dossier, progression = () => {}, forcer = false) {
  progression('Lecture du dossier…');
  const zips = [];
  const fits = [];
  for await (const h of dossier.values()) {
    if (h.kind !== 'file') continue;
    if (/\.zip$/i.test(h.name)) zips.push(await h.getFile());
    else if (/\.fit$/i.test(h.name)) fits.push(await h.getFile());
  }
  zips.sort((a, b) => b.lastModified - a.lastModified);
  const zip = zips[0] ?? null;

  const aLire = fits.map((f) => ({ nom: f.name, lire: async () => f.arrayBuffer() }));
  const signature = zip ? `${zip.name}|${zip.size}|${zip.lastModified}` : null;
  const dejaLu = !forcer && zip && signature === await lireReglage('dernierZip');
  if (zip && !dejaLu) aLire.unshift({ nom: zip.name, lire: async () => zip });

  const bilan = aLire.length ? await importerFichiers(aLire, progression) : compteur();
  if (zip && !dejaLu) await ecrireReglage('dernierZip', signature);
  await ecrireReglage('derniereSynchro', Date.now());
  return { ...bilan, zip: zip ? { nom: zip.name, date: zip.lastModified } : null, zipDejaLu: !!dejaLu };
}
