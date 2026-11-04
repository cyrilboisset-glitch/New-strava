// Interface : carte de synchronisation + liste des sorties par mois, et
// navigation vers le détail d'une sortie (#sortie=…) et les réglages (#reglages).
import { toutesLesSorties, lireReglage, ecrireReglage, viderPartages } from './db.js';
import { familleSortie } from './sortie.js';
import { chargeSortie } from './analyse.js';
import { lireProfil } from './profil.js';
import { afficherDetail, fermerDetail } from './detail.js';
import { afficherReglages } from './reglages.js';
import { nombre, km, duree, ilYA, majuscule, echapper, fmtJour, fmtHeure, fmtMois } from './format.js';
import {
  importerFichiers, dossierPossible, choisirDossier, dossierMemorise,
  etatAutorisation, demanderAutorisation, synchroniserDossier,
} from './import.js';

export const VERSION_APPLI = '0.4.0 · détail des sorties';

const $ = (id) => document.getElementById(id);
const el = {
  titre: $('synchro-titre'), detail: $('synchro-detail'), pastille: $('pastille'),
  progression: $('progression'), btnDossier: $('btn-dossier'), btnSynchro: $('btn-synchro'),
  btnHaut: $('btn-synchro-haut'), btnImporter: $('btn-importer'), champ: $('champ-fichier'),
  btnChanger: $('btn-changer-dossier'), liste: $('liste'), filtres: $('filtres'), vide: $('vide'), toast: $('toast'),
  accueil: $('accueil'), pageDetail: $('page-detail'), pageReglages: $('page-reglages'),
  titrePage: $('titre-page'), btnRetour: $('btn-retour'),
};

let dossier = null;
let occupe = false;
let rechargerApres = false; // nouvelle version arrivée pendant un import
let filtre = 'tout'; // famille d'activités affichée (clé de familleSortie)

// ---- Vignette de trace ----------------------------------------------------

function vignette(trace) {
  const T = 60;
  const marge = 8;
  if (!trace || trace.length < 2) {
    return `<svg width="${T}" height="${T}" viewBox="0 0 ${T} ${T}" aria-hidden="true"><path d="M18 40 L28 28 L36 34 L44 20"/></svg>`;
  }
  const latMoy = trace.reduce((a, p) => a + p[0], 0) / trace.length;
  const kx = Math.cos((latMoy * Math.PI) / 180);
  const xs = trace.map((p) => p[1] * kx);
  const ys = trace.map((p) => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const etendue = Math.max(maxX - minX, maxY - minY) || 1;
  const ech = (T - 2 * marge) / etendue;
  const dx = (T - (maxX - minX) * ech) / 2;
  const dy = (T - (maxY - minY) * ech) / 2;
  const pts = xs.map((x, i) => [dx + (x - minX) * ech, dy + (ys[i] - minY) * ech]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const [x0, y0] = pts[0];
  return `<svg width="${T}" height="${T}" viewBox="0 0 ${T} ${T}" aria-hidden="true"><path d="${d}"/><circle cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="2.6"/></svg>`;
}

// ---- Liste -----------------------------------------------------------------

function carteSortie(s, profil) {
  const d = new Date(s.debut);
  const effort = [];
  const { tss } = chargeSortie(s, profil.ftpW);
  if (s.puissanceNormW) effort.push(`<span><span class="p">${s.puissanceNormW} W</span> NP</span>`);
  else if (s.puissanceMoyW) effort.push(`<span><span class="p">${s.puissanceMoyW} W</span> moy.</span>`);
  if (tss != null) effort.push(`<span>TSS ${nombre(tss)}</span>`);
  if (s.fcMoy) effort.push(`<span><span class="c">${s.fcMoy}</span> bpm</span>`);

  return `
  <a class="sortie sortie-tete" href="#sortie=${encodeURIComponent(s.id)}">
      <div class="vignette">${vignette(s.trace)}</div>
      <div>
        <div class="sortie-titre">
          <p class="sortie-nom">${echapper(s.nom || s.nomSport)}</p>
          <span class="sortie-date">${majuscule(fmtJour.format(d))} · ${fmtHeure.format(d)}</span>
        </div>
        <div class="chiffres">
          ${s.distanceM != null ? `<span class="chiffre">${km(s.distanceM)}<small>km</small></span>` : ''}
          ${s.dureeChronoS != null ? `<span class="chiffre">${duree(s.dureeChronoS)}</span>` : ''}
          ${s.denivelePosM != null && (s.denivelePosM > 0 || s.distanceM) ? `<span class="chiffre">${nombre(s.denivelePosM)}<small>m D+</small></span>` : ''}
        </div>
        ${effort.length ? `<div class="effort">${effort.join('')}</div>` : ''}
      </div>
  </a>`;
}

// Boutons de tri : « Tout » + chaque famille présente, la plus fréquente d'abord
function afficherFiltres(toutes) {
  const familles = new Map();
  for (const s of toutes) {
    const f = familleSortie(s);
    if (!familles.has(f.cle)) familles.set(f.cle, { ...f, n: 0 });
    familles.get(f.cle).n++;
  }
  if (filtre !== 'tout' && !familles.has(filtre)) filtre = 'tout';
  el.filtres.hidden = familles.size < 2;
  const boutons = [{ cle: 'tout', nom: 'Tout', n: toutes.length },
    ...[...familles.values()].sort((a, b) => b.n - a.n || a.nom.localeCompare(b.nom, 'fr'))];
  el.filtres.innerHTML = boutons.map((f) => `
    <button type="button" class="filtre" data-cle="${echapper(f.cle)}" aria-pressed="${f.cle === filtre}">
      ${echapper(f.nom)} <span class="filtre-n">${nombre(f.n)}</span>
    </button>`).join('');
  // Bouton choisi visible même s'il est loin à droite dans la rangée
  const actif = el.filtres.querySelector('[aria-pressed="true"]');
  if (actif && filtre !== 'tout') el.filtres.scrollLeft = actif.offsetLeft - 16;
}

el.filtres.addEventListener('click', async (e) => {
  const b = e.target.closest('.filtre');
  if (!b || b.dataset.cle === filtre) return;
  filtre = b.dataset.cle;
  try { await ecrireReglage('filtre', filtre); } catch { /* sans importance */ }
  await afficherListe();
});

async function afficherListe() {
  const toutes = await toutesLesSorties();
  const profil = await lireProfil(toutes);
  el.vide.hidden = toutes.length > 0;
  afficherFiltres(toutes);
  const sorties = toutes
    .filter((s) => filtre === 'tout' || familleSortie(s).cle === filtre)
    .sort((a, b) => b.debut - a.debut);
  const groupes = new Map();
  for (const s of sorties) {
    const d = new Date(s.debut);
    const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(s);
  }
  let html = '';
  for (const [, liste] of groupes) {
    const dist = liste.reduce((a, s) => a + (s.distanceM ?? 0), 0);
    const temps = liste.reduce((a, s) => a + (s.dureeChronoS ?? 0), 0);
    const dplus = liste.reduce((a, s) => a + (s.denivelePosM ?? 0), 0);
    const n = liste.length;
    html += `
    <section class="mois">
      <div class="mois-entete">
        <h2 class="mois-titre">${majuscule(fmtMois.format(new Date(liste[0].debut)))}</h2>
        <p class="mois-cumul">${[
          `${n} sortie${n > 1 ? 's' : ''}`,
          dist > 0 ? `${km(dist)} km` : '',
          duree(temps).replace(/ /g, ' '),
          dist > 0 ? `${nombre(dplus)} m D+` : '',
        ].filter(Boolean).join(' · ')}</p>
      </div>
      ${liste.map((s) => carteSortie(s, profil)).join('')}
    </section>`;
  }
  el.liste.innerHTML = html;
}

// ---- Carte de synchronisation ----------------------------------------------

function etat(titre, detail, pastille = '') {
  el.titre.textContent = titre;
  el.detail.textContent = detail;
  el.pastille.className = `pastille ${pastille}`;
}

function progression(texte) {
  el.progression.hidden = !texte;
  el.progression.textContent = texte || '';
}

let minuterieToast;
function toast(texte) {
  el.toast.textContent = texte;
  el.toast.hidden = false;
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => { el.toast.hidden = true; }, 4500);
}

function occuper(oui) {
  occupe = oui;
  if (!oui && rechargerApres) { location.reload(); return; }
  for (const b of [el.btnDossier, el.btnSynchro, el.btnImporter, el.btnHaut]) b.disabled = oui;
  el.btnHaut.classList.toggle('tourne', oui);
}

function phraseBilan(b) {
  const morceaux = [];
  morceaux.push(b.nouvelles ? `${b.nouvelles} nouvelle${b.nouvelles > 1 ? 's' : ''} sortie${b.nouvelles > 1 ? 's' : ''}` : 'Aucune nouvelle sortie');
  if (b.dejaLa) morceaux.push(`${b.dejaLa} déjà connue${b.dejaLa > 1 ? 's' : ''}`);
  return morceaux.join(' · ');
}

async function afficherEtatDossier() {
  el.btnDossier.hidden = true;
  el.btnSynchro.hidden = true;
  el.btnHaut.hidden = true;
  el.btnChanger.hidden = true;

  if (!dossierPossible) {
    etat('Import manuel', "Ce navigateur ne permet pas de lire un dossier : importez le zip de Gadgetbridge, l'archive Strava ou un fichier .fit.");
    return;
  }
  if (!dossier) {
    etat('Aucun dossier relié', "Choisissez le dossier où Gadgetbridge dépose son zip d'export automatique.");
    el.btnDossier.hidden = false;
    return;
  }
  el.btnChanger.hidden = false;
  el.btnHaut.hidden = false;
  const derniere = await lireReglage('derniereSynchro');
  const autorisation = await etatAutorisation(dossier);
  if (autorisation === 'granted') {
    etat(`Dossier « ${dossier.name} »`, derniere ? `Dernière synchro ${ilYA(derniere)}` : 'Pas encore synchronisé', 'ok');
  } else {
    etat(`Dossier « ${dossier.name} »`, "Touchez Synchroniser pour autoriser la lecture du dossier.", 'attente');
    el.btnSynchro.hidden = false;
  }
}

async function synchroniser({ forcer = false, auto = false } = {}) {
  if (occupe || !dossier) return;
  occuper(true);
  try {
    if (await etatAutorisation(dossier) !== 'granted') {
      if (auto) return; // une autorisation demande un geste de l'utilisateur
      if (!(await demanderAutorisation(dossier))) {
        toast("Lecture du dossier refusée.");
        return;
      }
    }
    const bilan = await synchroniserDossier(dossier, progression, forcer);
    await afficherListe();
    if (!bilan.zip) toast("Aucun zip trouvé dans ce dossier. Vérifiez l'export automatique de Gadgetbridge.");
    else if (bilan.zipDejaLu && !bilan.nouvelles) { if (!auto) toast('Rien de nouveau depuis la dernière synchro.'); }
    else toast(phraseBilan(bilan));
    if (bilan.erreurs.length) console.warn('Erreurs d\'import', bilan.erreurs);
  } catch (e) {
    console.error(e);
    toast(`Synchro impossible : ${e.message}`);
  } finally {
    progression('');
    occuper(false);
    await afficherEtatDossier();
  }
}

async function importerDepuis(fichiers) {
  if (!fichiers.length) return;
  occuper(true);
  try {
    const bilan = await importerFichiers(fichiers, progression);
    await afficherListe();
    toast(phraseBilan(bilan) + (bilan.erreurs.length ? ` · ${bilan.erreurs.length} fichier(s) illisible(s)` : ''));
    if (bilan.erreurs.length) console.warn('Erreurs d\'import', bilan.erreurs);
  } catch (e) {
    console.error(e);
    toast(`Import impossible : ${e.message}`);
  } finally {
    progression('');
    occuper(false);
  }
}

// ---- Démarrage ---------------------------------------------------------------

el.btnDossier.addEventListener('click', async () => {
  try {
    dossier = await choisirDossier();
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Dossier non accessible : ${e.message}`);
    return;
  }
  await afficherEtatDossier();
  await synchroniser({ forcer: true });
});
el.btnChanger.addEventListener('click', () => el.btnDossier.click());
el.btnSynchro.addEventListener('click', () => synchroniser());
el.btnHaut.addEventListener('click', () => synchroniser());
el.btnImporter.addEventListener('click', () => el.champ.click());
el.champ.addEventListener('change', async () => {
  const fichiers = [...el.champ.files].map((f) => ({ nom: f.name, lire: async () => f }));
  el.champ.value = '';
  await importerDepuis(fichiers);
});

// ---- Navigation : accueil, détail d'une sortie, réglages -------------------

let navigationInterne = false; // arrivé sur la page par un lien de l'appli
let defilementAccueil = 0;

el.liste.addEventListener('click', (e) => { if (e.target.closest('a.sortie')) navigationInterne = true; });
$('btn-reglages').addEventListener('click', () => { navigationInterne = true; });
el.btnRetour.addEventListener('click', () => {
  if (navigationInterne) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); router(); }
});

async function router() {
  const h = location.hash;
  const idSortie = h.startsWith('#sortie=') ? decodeURIComponent(h.slice(8)) : null;
  const page = idSortie ? 'detail' : h === '#reglages' ? 'reglages' : 'accueil';
  const etaitAccueil = !el.accueil.hidden;
  if (etaitAccueil && page !== 'accueil') defilementAccueil = window.scrollY;
  fermerDetail();
  el.accueil.hidden = page !== 'accueil';
  el.pageDetail.hidden = page !== 'detail';
  el.pageReglages.hidden = page !== 'reglages';
  document.body.classList.toggle('sous-page', page !== 'accueil');
  el.titrePage.textContent = page === 'detail' ? 'Sortie' : page === 'reglages' ? 'Réglages' : 'Mes sorties';

  if (page === 'detail') {
    el.pageDetail.innerHTML = '<p class="chargement">Chargement…</p>';
    window.scrollTo(0, 0);
    try { await afficherDetail(el.pageDetail, idSortie); } catch (e) {
      console.error(e);
      el.pageDetail.innerHTML = `<section class="carte"><p>Détail impossible : ${echapper(e.message)}</p></section>`;
    }
  } else if (page === 'reglages') {
    window.scrollTo(0, 0);
    await afficherReglages(el.pageReglages, toast);
  } else {
    navigationInterne = false;
    if (!etaitAccueil) {
      await afficherListe(); // la FTP a pu changer (TSS)
      window.scrollTo(0, defilementAccueil);
    }
  }
}
window.addEventListener('hashchange', router);

// Mise à jour : à chaque ouverture ou retour dans l'appli, on demande au
// navigateur de vérifier sw.js ; si une nouvelle version prend la main,
// la page se recharge toute seule (après l'import en cours, s'il y en a un).
function miseAJourAuto() {
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitUneVersion) return; // première installation : rien à recharger
    if (occupe) rechargerApres = true;
    else location.reload();
  });
  navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' })
    .then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((e) => console.warn('Service worker', e));
}

async function demarrer() {
  $('version').textContent = `v${VERSION_APPLI}`;
  try { filtre = (await lireReglage('filtre')) ?? 'tout'; } catch { /* filtre par défaut */ }
  if ('serviceWorker' in navigator) miseAJourAuto();
  await afficherListe();

  // Fichiers reçus par le menu Partager d'Android
  if (new URLSearchParams(location.search).has('partage')) {
    history.replaceState(null, '', location.pathname);
    const recus = await viderPartages();
    await importerDepuis(recus.map((p) => ({ nom: p.nom, lire: async () => p.octets })));
  }

  if (location.hash) await router();

  if (dossierPossible) dossier = await dossierMemorise();
  await afficherEtatDossier();
  if (dossier) await synchroniser({ auto: true });
}

demarrer();
