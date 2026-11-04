// Import des sorties : depuis le zip de Gadgetbridge, l'archive Strava
// (export du compte), un fichier seul (.fit, .gpx, .tcx, compressés .gz
// ou non), ou le dossier d'export choisi sur le téléphone.
import { lireFit, TYPE_FICHIER_ACTIVITE } from './fit.js';
import { resumerSortie, identifiantSortie, nomSport } from './sortie.js';
import { lireGpx, lireTcx, resumerTrace } from './trace.js';
import { degzip } from './fichier.js';
import { lireActivitesCsv, typeStrava, resumerSansTrace } from './strava.js';
import { toutesLesSorties, sortieExiste, enregistrerSortie, completerSortie, lireReglage, ecrireReglage } from './db.js';

const ECART_DOUBLON_MS = 60 * 1000; // même départ à 1 min près = même sortie
const EXTENSIONS = /\.(fit|gpx|tcx)(\.gz)?$/i;
const ORDRE_FORMATS = { fit: 0, tcx: 1, gpx: 2 }; // le FIT d'abord : c'est le plus complet

function compteur() {
  return { nouvelles: 0, dejaLa: 0, ignores: 0, erreurs: [] };
}

const nomCourt = (chemin) => chemin.split('/').pop();

// Sortie déjà là : on la compte, et on la complète avec le CSV Strava :
// nom s'il manque ; type si la sortie vient de Strava sans FIT précis
// (corrige par exemple la musculation importée avant la v0.3.0 comme
// « Entraînement » : il suffit de réimporter l'archive).
async function doublon(bilan, idExistant, infos) {
  bilan.dejaLa++;
  if (!infos || !idExistant) return;
  await completerSortie(idExistant, (s) => {
    const champs = {};
    if (infos.nom && !s.nom) champs.nom = infos.nom;
    if (infos.type && s.typeStrava !== infos.type) {
      champs.typeStrava = infos.type;
      const typeFitVague = s.format !== 'fit' || s.sport === 0 || (s.sport === 10 && !s.sousSport);
      if (s.source === 'strava' && typeFitVague) Object.assign(champs, typeStrava(infos.type));
    }
    return champs;
  });
}

function memeDepart(connues, debut) {
  return connues.find((c) => Math.abs(c.debut - debut) < ECART_DOUBLON_MS);
}

async function enregistrer(resume, octets, fichier, bilan, connues, infos) {
  if (await sortieExiste(resume.id)) return doublon(bilan, resume.id, infos);
  // Même sortie déjà présente sous un autre fichier (copie, Gadgetbridge + Strava…)
  const meme = memeDepart(connues, resume.debut);
  if (meme) return doublon(bilan, meme.id, infos);
  if (infos) {
    resume.source = 'strava';
    resume.idStrava = infos.idStrava;
    if (infos.type) resume.typeStrava = infos.type;
    if (infos.nom) resume.nom = infos.nom;
  }
  if (fichier) resume.format = fichier.format;
  await enregistrerSortie(resume, octets, fichier);
  connues.push({ id: resume.id, debut: resume.debut });
  bilan.nouvelles++;
}

/**
 * Un fichier d'activité (FIT, GPX ou TCX, éventuellement .gz) -> enregistré s'il est nouveau.
 * `infos` : ligne du CSV Strava correspondante (nom, type…), si connue.
 */
async function importerActivite(octets, chemin, bilan, connues, infos = null) {
  const m = chemin.match(EXTENSIONS);
  // Fichier inutilisable mais sortie connue par le CSV : on la garde sans trace
  const sansFichier = () => (infos ? importerSansTrace(infos, bilan, connues) : void bilan.ignores++);
  if (!m) return sansFichier();
  const format = m[1].toLowerCase();
  const gzip = !!m[2];
  const nom = nomCourt(chemin);
  let resume;
  try {
    const brut = gzip ? await degzip(octets) : octets;
    if (format === 'fit') {
      const entete = lireFit(brut, { seulementEntete: true });
      if (entete.fileId?.type !== TYPE_FICHIER_ACTIVITE) return sansFichier();
      const idProvisoire = identifiantSortie(entete);
      if (idProvisoire && await sortieExiste(idProvisoire)) return doublon(bilan, idProvisoire, infos);
      resume = resumerSortie(lireFit(brut), nom);
      if ((resume.sport === 0 || (resume.sport === 10 && !resume.sousSport)) && infos?.type) Object.assign(resume, typeStrava(infos.type));
    } else {
      const texte = new TextDecoder().decode(brut);
      const lu = format === 'gpx' ? lireGpx(texte) : lireTcx(texte);
      if (lu.records.length < 2) return sansFichier(); // itinéraire sans horaires, fichier vide
      const type = infos?.type ? typeStrava(infos.type)
        : { sport: lu.sport ?? 0, sousSport: 0, nomSport: nomSport(lu.sport ?? 0, 0) };
      resume = resumerTrace(lu.records, { nomFichier: nom, ...type });
      resume.id = infos?.idStrava ? `strava-${infos.idStrava}` : `${format}-${resume.debut}`;
      if (lu.nom) resume.nom = lu.nom;
    }
  } catch (e) {
    bilan.erreurs.push(`${nom} : ${e.message}`);
    return sansFichier();
  }
  if (!resume.id || !resume.debut) return sansFichier();
  await enregistrer(resume, octets, { format, gzip }, bilan, connues, infos);
}

// Sortie saisie à la main sur Strava : reprise depuis le CSV, sans trace.
async function importerSansTrace(infos, bilan, connues) {
  if (!infos.idStrava || !infos.debut) {
    bilan.erreurs.push(`Sortie Strava « ${infos.nom ?? '?'} » : date illisible`);
    return;
  }
  await enregistrer(resumerSansTrace(infos), null, null, bilan, connues, infos);
}

async function sortiesConnues() {
  return (await toutesLesSorties()).map((s) => ({ id: s.id, debut: s.debut }));
}

/**
 * Importe une liste de fichiers (.zip, .fit, .gpx, .tcx, .gz).
 * @param {{nom: string, lire: () => Promise<ArrayBuffer|Blob>}[]} fichiers
 * @param {(texte: string) => void} progression
 */
export async function importerFichiers(fichiers, progression = () => {}) {
  // Demande à Chrome de ne jamais effacer les données de l'appli
  try { await navigator.storage?.persist?.(); } catch { /* sans importance */ }
  const bilan = compteur();
  const connues = await sortiesConnues();
  for (const f of fichiers) {
    if (/\.zip$/i.test(f.nom)) {
      await importerZip(await f.lire(), f.nom, bilan, connues, progression);
    } else if (EXTENSIONS.test(f.nom)) {
      progression(`Lecture de ${f.nom}…`);
      const contenu = await f.lire();
      const octets = contenu instanceof ArrayBuffer ? contenu : await contenu.arrayBuffer();
      await importerActivite(octets, f.nom, bilan, connues);
    } else {
      bilan.ignores++;
    }
  }
  return bilan;
}

// Chemin « activities/123.fit.gz » tel qu'écrit dans le CSV, même si le
// zip a un dossier racine en plus.
function cheminStrava(nomEntree) {
  const n = nomEntree.toLowerCase();
  const i = n.lastIndexOf('activities/');
  return i >= 0 ? n.slice(i) : null;
}

async function importerZip(contenu, nomZip, bilan, connues, progression) {
  progression(`Ouverture de ${nomZip}…`);
  let zip;
  try {
    zip = await globalThis.JSZip.loadAsync(contenu);
  } catch (e) {
    bilan.erreurs.push(`${nomZip} : zip illisible (${e.message})`);
    return;
  }
  const tout = Object.values(zip.files).filter((e) => !e.dir);
  const entreeCsv = tout.find((e) => /(^|\/)activities\.csv$/i.test(e.name));
  const csv = entreeCsv ? lireActivitesCsv(await entreeCsv.async('string')) : null;
  const libelle = csv ? 'Archive Strava' : 'Fichiers';

  const entrees = tout
    .filter((e) => EXTENSIONS.test(e.name) && !/(^|\/)routes\//i.test(e.name))
    .map((e) => ({ e, format: e.name.match(EXTENSIONS)[1].toLowerCase() }))
    .sort((a, b) => ORDRE_FORMATS[a.format] - ORDRE_FORMATS[b.format]);
  const lus = new Set();
  let i = 0;
  for (const { e } of entrees) {
    i++;
    progression(`${libelle} : ${i} / ${entrees.length}`);
    const cle = cheminStrava(e.name);
    const infos = (cle && csv?.parFichier.get(cle)) || null;
    if (infos) lus.add(cle);
    await importerActivite(await e.async('arraybuffer'), e.name, bilan, connues, infos);
  }
  if (csv) {
    // Saisies à la main, et fichiers cités par le CSV mais absents du zip
    const restantes = [...csv.sansFichier, ...[...csv.parFichier].filter(([c]) => !lus.has(c)).map(([, v]) => v)];
    for (const infos of restantes) await importerSansTrace(infos, bilan, connues);
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
