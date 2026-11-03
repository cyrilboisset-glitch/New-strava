// Interface : carte de synchronisation + liste des sorties par mois.
import { toutesLesSorties, lireReglage, viderPartages } from './db.js';
import {
  importerFichiers, dossierPossible, choisirDossier, dossierMemorise,
  etatAutorisation, demanderAutorisation, synchroniserDossier,
} from './import.js';

export const VERSION_APPLI = '0.2.0 · archive Strava';

const $ = (id) => document.getElementById(id);
const el = {
  titre: $('synchro-titre'), detail: $('synchro-detail'), pastille: $('pastille'),
  progression: $('progression'), btnDossier: $('btn-dossier'), btnSynchro: $('btn-synchro'),
  btnHaut: $('btn-synchro-haut'), btnImporter: $('btn-importer'), champ: $('champ-fichier'),
  btnChanger: $('btn-changer-dossier'), liste: $('liste'), vide: $('vide'), toast: $('toast'),
};

let dossier = null;
let occupe = false;

// ---- Formats -------------------------------------------------------------

const fmtJour = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtHeure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtMois = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const fmtDateCourte = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const nombre = (v, dec = 0) => v.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const km = (m) => nombre(m / 1000, m < 100000 ? 1 : 0);

function duree(s) {
  if (s == null) return '–';
  const totalMin = Math.round(s / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  return `${h} h ${String(totalMin % 60).padStart(2, '0')}`;
}

function ilYA(t) {
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${fmtDateCourte.format(t)}`;
}

const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function echapper(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

function carteSortie(s) {
  const d = new Date(s.debut);
  const effort = [];
  if (s.puissanceNormW) effort.push(`<span><span class="p">${s.puissanceNormW} W</span> NP</span>`);
  else if (s.puissanceMoyW) effort.push(`<span><span class="p">${s.puissanceMoyW} W</span> moy.</span>`);
  if (s.tss != null) effort.push(`<span>TSS ${nombre(s.tss)}</span>`);
  if (s.fcMoy) effort.push(`<span><span class="c">${s.fcMoy}</span> bpm</span>`);

  const details = [];
  const ajout = (nom, val) => { if (val != null && val !== '') details.push(`<div class="detail"><dt>${nom}</dt><dd>${val}</dd></div>`); };
  if (s.nom) ajout('Type', echapper(s.nomSport));
  ajout('Vitesse moyenne', s.vitesseMoyMs != null ? `${nombre(s.vitesseMoyMs * 3.6, 1)} km/h` : null);
  ajout('Temps total', s.dureeTotaleS != null ? duree(s.dureeTotaleS) : null);
  ajout('Puissance moyenne', s.puissanceMoyW != null ? `${s.puissanceMoyW} W` : null);
  ajout('Puissance max', s.puissanceMaxW != null ? `${s.puissanceMaxW} W` : null);
  ajout("Facteur d'intensité", s.facteurIntensite != null ? nombre(s.facteurIntensite, 2) : null);
  ajout('FC max', s.fcMax != null ? `${s.fcMax} bpm` : null);
  ajout('Cadence moyenne', s.cadenceMoy != null ? `${s.cadenceMoy} tr/min` : null);
  ajout('Calories', s.calories != null ? `${nombre(s.calories)} kcal` : null);
  ajout('Température moy.', s.temperatureMoy != null ? `${s.temperatureMoy} °C` : null);
  ajout('Tours', s.nbTours || null);
  const note = [
    s.ftpCompteurW ? `IF et TSS calculés par le compteur avec une FTP de ${s.ftpCompteurW} W.` : '',
    s.sansTrace ? 'Sans trace (saisie à la main sur Strava ou fichier inutilisable) : chiffres repris de Strava.' : '',
    s.format === 'gpx' || s.format === 'tcx'
      ? `Fichier ${s.format.toUpperCase()}${s.source === 'strava' ? ' de Strava' : ''} : chiffres calculés depuis les points.` : '',
    s.source === 'strava' && !s.sansTrace && s.format === 'fit' ? 'Fichier FIT récupéré dans l\'archive Strava.' : '',
    s.nbPoints ? `${nombre(s.nbPoints)} points enregistrés.` : '',
  ].filter(Boolean).join(' ');

  return `
  <details class="sortie">
    <summary class="sortie-tete">
      <div class="vignette">${vignette(s.trace)}</div>
      <div>
        <div class="sortie-titre">
          <p class="sortie-nom">${echapper(s.nom || s.nomSport)}</p>
          <span class="sortie-date">${majuscule(fmtJour.format(d))} · ${fmtHeure.format(d)}</span>
        </div>
        <div class="chiffres">
          ${s.distanceM != null ? `<span class="chiffre">${km(s.distanceM)}<small>km</small></span>` : ''}
          ${s.dureeChronoS != null ? `<span class="chiffre">${duree(s.dureeChronoS)}</span>` : ''}
          ${s.denivelePosM != null ? `<span class="chiffre">${nombre(s.denivelePosM)}<small>m D+</small></span>` : ''}
        </div>
        ${effort.length ? `<div class="effort">${effort.join('')}</div>` : ''}
      </div>
    </summary>
    <dl class="sortie-details">${details.join('')}<div class="detail-note">${note}</div></dl>
  </details>`;
}

async function afficherListe() {
  const sorties = (await toutesLesSorties()).sort((a, b) => b.debut - a.debut);
  el.vide.hidden = sorties.length > 0;
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
        <p class="mois-cumul">${n} sortie${n > 1 ? 's' : ''} · ${km(dist)} km · ${duree(temps).replace(/ /g, ' ')} · ${nombre(dplus)} m D+</p>
      </div>
      ${liste.map(carteSortie).join('')}
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

async function demarrer() {
  $('version').textContent = `v${VERSION_APPLI}`;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { type: 'module' }).catch((e) => console.warn('Service worker', e));
  }
  await afficherListe();

  // Fichiers reçus par le menu Partager d'Android
  if (new URLSearchParams(location.search).has('partage')) {
    history.replaceState(null, '', location.pathname);
    const recus = await viderPartages();
    await importerDepuis(recus.map((p) => ({ nom: p.nom, lire: async () => p.octets })));
  }

  if (dossierPossible) dossier = await dossierMemorise();
  await afficherEtatDossier();
  if (dossier) await synchroniser({ auto: true });
}

demarrer();
