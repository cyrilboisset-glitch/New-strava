// Interface : carte de synchronisation + liste des sorties par mois, et
// navigation vers le détail d'une sortie (#sortie=…) et les réglages (#reglages).
import { toutesLesSorties, lireReglage, ecrireReglage, viderPartages, versionBase } from './db.js';
import { familleSortie } from './sortie.js';
import { chargeSortie } from './analyse.js';
import { lireProfil, calculerEstimationsManquantes, calculerEffortsManquants, reglerFtpAuto } from './profil.js';
import { htmlCarteStatique } from './carte-statique.js';
import { afficherDetail, fermerDetail } from './detail.js';
import { afficherReglages } from './reglages.js';
import { afficherProgres, htmlFiltres } from './progres.js';
import { afficherSegment, mettreAJourPassages, suivreRecherche, recordsDesSorties } from './segments.js';
import { afficherTraces, fermerTraces } from './traces.js';
import { brancherCache } from './lieux.js';
import { htmlMannequin, nettoyer as nettoyerMuscles, resumeMuscles } from './mannequin.js';
import { iconeSport, iconeFamille } from './icones.js';
import { htmlBandeauObjectifs } from './objectifs.js';
import { nombre, km, duree, ilYA, majuscule, echapper, fmtJour, fmtHeure, fmtMois } from './format.js';
import {
  importerFichiers, dossierPossible, selecteurFichiersPossible, choisirDansTelechargements, choisirDossier, dossierMemorise,
  etatAutorisation, demanderAutorisation, synchroniserDossier,
} from './import.js';


export const VERSION_APPLI = '0.36.0 · carte plein écran';

// Noms de lieux (OpenStreetMap) gardés dans le réglage « lieux »
brancherCache(() => lireReglage('lieux'), (c) => ecrireReglage('lieux', c));

const $ = (id) => document.getElementById(id);
const el = {
  titre: $('synchro-titre'), detail: $('synchro-detail'), pastille: $('pastille'),
  progression: $('progression'), btnDossier: $('btn-dossier'), btnSynchro: $('btn-synchro'),
  btnImporter: $('btn-importer'), champ: $('champ-fichier'),
  btnChanger: $('btn-changer-dossier'), liste: $('liste'), btnActivite: $('btn-activite'), menuActivite: $('menu-activite'), vide: $('vide'), toast: $('toast'),
  btnMenuSynchro: $('btn-menu-synchro'), menuSynchro: $('menu-synchro'), synchroCourt: $('synchro-court'),
  accueil: $('accueil'), pageDetail: $('page-detail'), pageReglages: $('page-reglages'), pageProgres: $('page-progres'),
  pageSegment: $('page-segment'), pageTraces: $('page-traces'),
  titrePage: $('titre-page'), btnRetour: $('btn-retour'),
};

let dossier = null;
let occupe = false;
let rechargerApres = false; // nouvelle version arrivée pendant un import
let filtre = 'tout'; // famille d'activités affichée (clé de familleSortie)

// ---- Aperçu du parcours (dessiné depuis la trace simplifiée) ----------------

function apercu(trace) {
  return htmlCarteStatique(trace);
}

// Grande carte de la liste (le tracé coloré est réservé au détail : plus léger)
const CARTE_L = 360; const CARTE_H = 250;

// ---- Liste -----------------------------------------------------------------

// nbRecords : records perso battus sur les segments (petite coupe en or)
function carteSortie(s, profil, nbRecords = 0) {
  const d = new Date(s.debut);
  const { tss } = chargeSortie(s, profil.ftpW);
  const stats = [];
  if (s.distanceM) stats.push(['Distance', `${km(s.distanceM)}<small>km</small>`]);
  if (s.denivelePosM != null && (s.denivelePosM > 0 || s.distanceM)) stats.push(['Dénivelé', `${nombre(s.denivelePosM)}<small>m</small>`]);
  if (s.dureeChronoS != null) stats.push(['Temps', duree(s.dureeChronoS)]);
  const effort = [];
  if (s.puissanceNormW) effort.push(`<span><span class="p">${s.puissanceNormW} W</span> NP</span>`);
  else if (s.puissanceMoyW) effort.push(`<span><span class="p">${s.puissanceMoyW} W</span> moy.</span>`);
  else if (s.puissanceEstimee?.normW) effort.push(`<span title="Puissance estimée (pas de capteur)"><span class="p">≈ ${s.puissanceEstimee.normW} W</span> NP estimée</span>`);
  if (tss != null) effort.push(`<span>TSS ${nombre(tss)}</span>`);
  if (s.fcMoy) effort.push(`<span><span class="c">${s.fcMoy}</span> bpm</span>`);

  const entete = `<span class="pastille-sport">${iconeSport(s)}</span>
      <div class="sortie-titres">
        <p class="sortie-nom">${echapper(s.nom || s.nomSport)}</p>
        <p class="sortie-date">${majuscule(fmtJour.format(d))} · ${fmtHeure.format(d)}${s.nom ? ` · ${echapper(s.nomSport)}` : ''}</p>
      </div>
      ${nbRecords ? coupeRecords(nbRecords) : ''}`;
  // avec un tracé : grande carte, titre posé dessus, puces pour colorer le tracé
  if (s.trace?.length > 1) {
    return `
  <a class="sortie sortie-grande" href="#sortie=${encodeURIComponent(s.id)}" data-id="${echapper(s.id)}">
    <div class="sortie-carte">
      ${htmlCarteStatique(s.trace, { largeur: CARTE_L, hauteur: CARTE_H })}
      <div class="sortie-voile sortie-entete">${entete}</div>
    </div>
    ${stats.length ? `<div class="stats">${stats.map(([l, v]) => `<div><span class="stat-label">${l}</span><span class="stat-val">${v}</span></div>`).join('')}</div>` : ''}
    ${effort.length ? `<div class="effort">${effort.join('')}</div>` : ''}
  </a>`;
  }

  return `
  <a class="sortie" href="#sortie=${encodeURIComponent(s.id)}" data-id="${echapper(s.id)}">
    <div class="sortie-entete">
      ${entete}
    </div>
    ${stats.length ? `<div class="stats">${stats.map(([l, v]) => `<div><span class="stat-label">${l}</span><span class="stat-val">${v}</span></div>`).join('')}</div>` : ''}
    ${effort.length ? `<div class="effort">${effort.join('')}</div>` : ''}
    ${!s.trace?.length && Object.keys(nettoyerMuscles(s.muscles)).length ? `<div class="sortie-muscles" title="${echapper(resumeMuscles(s.muscles))}">${htmlMannequin(s.muscles, { classe: 'mini' })}</div>` : ''}
  </a>`;
}

export function coupeRecords(n) {
  return `<span class="coupe-pr" title="${n} record${n > 1 ? 's' : ''} perso sur des segments" aria-label="${n} record${n > 1 ? 's' : ''} perso">🏆<b>${n}</b></span>`;
}

// Boutons de tri : « Tout » + chaque famille présente, la plus fréquente d'abord
// Menu déroulant du type d'activité : « Tout » + chaque famille présente, la plus fréquente d'abord
function afficherFiltres(toutes) {
  const { familles, choix } = htmlFiltres(toutes, filtre);
  if (filtre !== 'tout' && !familles.has(filtre)) { filtre = 'tout'; return afficherFiltres(toutes); }
  // menu : une icône par activité (le nom et le nombre restent pour le lecteur d'écran)
  el.menuActivite.innerHTML = choix.map((f) =>
    `<button type="button" class="menu-icone-item${f.cle === filtre ? ' actif' : ''}" role="menuitemradio" aria-checked="${f.cle === filtre}" data-cle="${echapper(f.cle)}" aria-label="${echapper(f.nom)} (${nombre(f.n)})" title="${echapper(f.nom)}"><span class="menu-icone-nom" aria-hidden="true">${echapper(f.nom)}</span><span class="menu-icone-svg">${iconeFamille(f.cle, 30)}</span></button>`).join('');
  el.btnActivite.disabled = familles.size < 2;
  if (el.btnActivite.disabled) menuActivite(false);
  // bouton rond : icône de l'activité choisie, nom complet pour le lecteur d'écran
  $('icone-activite').innerHTML = iconeFamille(filtre, 24);
  const choisi = choix.find((f) => f.cle === filtre);
  el.btnActivite.setAttribute('aria-label', `Type d'activité : ${choisi ? `${choisi.nom} (${choisi.n})` : 'Tout'}`);
  el.btnActivite.title = choisi ? choisi.nom : 'Tout';
}

let minuterieActivite;
const activiteOuvert = () => el.btnActivite.getAttribute('aria-expanded') === 'true';
function menuActivite(oui) {
  clearTimeout(minuterieActivite);
  el.btnActivite.setAttribute('aria-expanded', String(oui));
  if (oui) {
    el.menuActivite.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => el.menuActivite.classList.add('ouvert')));
  } else {
    el.menuActivite.classList.remove('ouvert');
    minuterieActivite = setTimeout(() => { el.menuActivite.hidden = true; }, 200);
  }
}
// Geste en un seul mouvement : on appuie sur le bouton rond, le menu s'ouvre ; sans lever le
// doigt on le glisse sur une icône (seule sa ligne s'élargit) et on le relâche pour choisir.
// Un simple toucher ouvre le menu, et il reste ouvert.
let gesteBouton = null; // { id, x, y, bouge }
let ignorerClicBouton = false;
let jetonClicBouton = 0; // une minuterie d'un geste précédent ne doit pas toucher au geste suivant
const ouvrirMenuActivite = () => { ouvrirMenu(false); menuActivite(true); };
el.btnActivite.addEventListener('pointerdown', (e) => {
  if (el.btnActivite.disabled || e.button > 0 || activiteOuvert()) return; // déjà ouvert : le clic le refermera
  gesteBouton = { id: e.pointerId, x: e.clientX, y: e.clientY, bouge: false };
  ignorerClicBouton = true;
  jetonClicBouton++;
  try { el.btnActivite.setPointerCapture(e.pointerId); } catch { /* sans importance */ }
  ouvrirMenuActivite();
});
el.btnActivite.addEventListener('pointermove', (e) => {
  if (!gesteBouton || e.pointerId !== gesteBouton.id) return;
  if (Math.hypot(e.clientX - gesteBouton.x, e.clientY - gesteBouton.y) > 8) gesteBouton.bouge = true;
  if (gesteBouton.bouge) survolerIcone(iconeSous(e));
});
const finGeste = (e) => {
  if (!gesteBouton || e.pointerId !== gesteBouton.id) return;
  const { bouge } = gesteBouton;
  gesteBouton = null;
  const it = e.type === 'pointerup' ? iconeSous(e) : null;
  survolerIcone(null);
  if (it) choisirActivite(it.dataset.cle); // relâché sur une icône : choisie
  else if (bouge && e.type === 'pointerup') menuActivite(false); // glissé puis relâché dans le vide : on referme
  const jeton = jetonClicBouton;
  setTimeout(() => { if (jeton === jetonClicBouton) ignorerClicBouton = false; }, 80);
};
el.btnActivite.addEventListener('pointerup', finGeste);
el.btnActivite.addEventListener('pointercancel', finGeste);
el.btnActivite.addEventListener('click', (e) => {
  e.stopPropagation();
  if (ignorerClicBouton) { ignorerClicBouton = false; return; } // le toucher a déjà ouvert le menu
  if (!activiteOuvert()) ouvrirMenu(false);
  menuActivite(!activiteOuvert());
});
document.addEventListener('click', (e) => { if (activiteOuvert() && !e.target.closest('.menu-activite')) menuActivite(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && activiteOuvert()) { menuActivite(false); el.btnActivite.focus(); } });

async function changerFiltre(cle) {
  filtre = cle;
  try { await ecrireReglage('filtre', filtre); } catch { /* sans importance */ }
}

async function choisirActivite(cle) {
  menuActivite(false);
  if (cle === filtre) return;
  await changerFiltre(cle);
  await afficherListe();
  window.scrollTo({ top: 0, behavior: mouvementReduit() ? 'auto' : 'smooth' });
  cascade(el.liste);
}

// Menu en icônes : l'icône sous le doigt (ou la souris) se déroule vers la gauche et
// montre le nom de l'activité. On peut aussi faire glisser le doigt d'une icône à l'autre
// et relâcher sur celle qu'on veut.
let iconeSurvolee = null;
let iconeAppuyee = null; // icône où le doigt s'est posé
function survolerIcone(it) {
  if (it === iconeSurvolee) return;
  iconeSurvolee?.classList.remove('survol');
  iconeSurvolee = it;
  it?.classList.add('survol');
}
const iconeSous = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.menu-icone-item') ?? null;
el.menuActivite.addEventListener('pointerdown', (e) => { iconeAppuyee = iconeSous(e); survolerIcone(iconeAppuyee); });
el.menuActivite.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) survolerIcone(iconeSous(e)); });
el.menuActivite.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') survolerIcone(null); });
el.menuActivite.addEventListener('pointerup', (e) => {
  const it = iconeSous(e);
  const glisse = iconeAppuyee && it && it !== iconeAppuyee; // relâché sur une autre icône que celle de départ
  iconeAppuyee = null;
  if (glisse) { e.preventDefault(); survolerIcone(null); choisirActivite(it.dataset.cle); } // (pas de « click » dans ce cas)
});
el.menuActivite.addEventListener('pointercancel', () => { iconeAppuyee = null; survolerIcone(null); });
el.menuActivite.addEventListener('focusin', (e) => { if (e.target.matches?.(':focus-visible')) survolerIcone(e.target.closest('.menu-icone-item')); });
el.menuActivite.addEventListener('focusout', () => survolerIcone(null));
el.menuActivite.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cle]');
  if (b) { survolerIcone(null); choisirActivite(b.dataset.cle); }
});

// ---- Liste : par morceaux de 30, gardée en mémoire ------------------------------
// - seules les sorties les plus récentes sont dessinées ; les suivantes arrivent en descendant ;
// - la liste reste dans la page : revenir sur l'accueil est instantané si rien n'a changé ;
// - les calculs en arrière-plan ne refont que les cartes dont le contenu a changé.
const TAILLE_MORCEAU = 30;
const liste = { version: -1, filtre: null, toutes: [], profil: null, records: new Map(), sorties: [], cumuls: new Map(), nAffiche: 0, cleDerniere: null, htmls: new Map() };
let jetonListe = 0;
let observateurListe = null;
const suite = document.createElement('div');
suite.id = 'liste-suite';
suite.hidden = true;
el.liste.after(suite);

const cleMois = (debut) => { const d = new Date(debut); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** Lit les données et prépare sorties filtrées / triées et totaux par mois (rien n'est dessiné) */
async function chargerListe() {
  const version = versionBase(); // avant la lecture : une écriture pendant la lecture rend la liste « à refaire »
  const toutes = await toutesLesSorties();
  const profil = await lireProfil(toutes);
  const records = await recordsDesSorties().catch(() => new Map());
  return { version, toutes, profil, records };
}

// Bandeau des objectifs (anneaux) : refait seulement si son contenu change (la position du
// glissement est gardée, les anneaux ne se remplissent qu'à l'apparition ou au changement)
let bandeauHtml = '';
async function afficherBandeau() {
  let objectifs = [];
  try { objectifs = (await lireReglage('objectifs')) ?? []; } catch { /* sans objectif */ }
  const section = $('objectifs-accueil');
  const rail = $('objectifs-rail');
  if (!liste.toutes.length && !objectifs.length) { section.hidden = true; return; }
  const html = htmlBandeauObjectifs(objectifs, liste.toutes, liste.profil, Date.now());
  section.hidden = false;
  if (html === bandeauHtml) return;
  bandeauHtml = html;
  const x = rail.scrollLeft;
  rail.innerHTML = html;
  rail.scrollLeft = x;
}

function appliquerDonnees({ version, toutes, profil, records }) {
  el.vide.hidden = toutes.length > 0;
  afficherFiltres(toutes); // peut remettre le filtre sur « tout »
  Object.assign(liste, { version, toutes, profil, records, filtre });
  liste.sorties = toutes.filter((s) => filtre === 'tout' || familleSortie(s).cle === filtre).sort((a, b) => b.debut - a.debut);
  const groupes = new Map();
  for (const s of liste.sorties) {
    const cle = cleMois(s.debut);
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(s);
  }
  afficherBandeau().catch((e) => console.warn('Objectifs', e));
  liste.cumuls = new Map([...groupes].map(([cle, l]) => {
    const dist = l.reduce((a, s) => a + (s.distanceM ?? 0), 0);
    const temps = l.reduce((a, s) => a + (s.dureeChronoS ?? 0), 0);
    const dplus = l.reduce((a, s) => a + (s.denivelePosM ?? 0), 0);
    return [cle, { titre: majuscule(fmtMois.format(new Date(l[0].debut))), texte: [
      `${l.length} sortie${l.length > 1 ? 's' : ''}`,
      dist > 0 ? `${km(dist)} km` : '',
      duree(temps).replace(/ /g, ' '),
      dist > 0 ? `${nombre(dplus)} m D+` : '',
    ].filter(Boolean).join(' · ') }];
  }));
}

const carteListe = (s) => carteSortie(s, liste.profil, liste.records.get(s.id));

/** Dessine les `n` sorties suivantes (ajoutées au dernier mois si elles en font partie) */
function dessinerMorceau(n) {
  const fin = Math.min(liste.sorties.length, liste.nAffiche + n);
  const lot = liste.sorties.slice(liste.nAffiche, fin);
  const suites = []; // suites de sorties du même mois
  for (const s of lot) {
    const cle = cleMois(s.debut);
    const derniere = suites[suites.length - 1];
    if (derniere?.cle === cle) derniere.l.push(s); else suites.push({ cle, l: [s] });
  }
  for (const { cle, l } of suites) {
    const cartes = l.map((s) => { const h = carteListe(s); liste.htmls.set(s.id, h); return h; }).join('');
    if (cle === liste.cleDerniere) { el.liste.lastElementChild.insertAdjacentHTML('beforeend', cartes); continue; }
    const c = liste.cumuls.get(cle);
    el.liste.insertAdjacentHTML('beforeend', `
    <section class="mois">
      <div class="mois-entete">
        <h2 class="mois-titre">${c.titre}</h2>
        <p class="mois-cumul">${c.texte}</p>
      </div>
      ${cartes}
    </section>`);
    liste.cleDerniere = cle;
  }
  liste.nAffiche = fin;
  const reste = liste.sorties.length - fin;
  suite.hidden = reste <= 0;
  suite.textContent = reste > 0 ? `Encore ${nombre(reste)} sortie${reste > 1 ? 's' : ''}…` : '';
  if (reste > 0 && observateurListe) { observateurListe.unobserve(suite); observateurListe.observe(suite); } // revérifie tout de suite
}

if ('IntersectionObserver' in window) {
  observateurListe = new IntersectionObserver((entrees) => {
    if (entrees.some((e) => e.isIntersecting) && liste.nAffiche < liste.sorties.length) dessinerMorceau(TAILLE_MORCEAU);
  }, { rootMargin: '900px 0px' });
  observateurListe.observe(suite);
} else {
  suite.addEventListener('click', () => dessinerMorceau(TAILLE_MORCEAU));
}

/** Refait toute la liste (nombre de sorties déjà affichées conservé pour garder la position) */
async function afficherListe() {
  const jeton = ++jetonListe;
  const donnees = await chargerListe();
  if (jeton !== jetonListe) return;
  const memeFiltre = liste.filtre === filtre;
  const dejaAffichees = liste.nAffiche;
  appliquerDonnees(donnees);
  el.liste.innerHTML = '';
  liste.nAffiche = 0; liste.cleDerniere = null; liste.htmls.clear();
  dessinerMorceau(Math.max(TAILLE_MORCEAU, memeFiltre ? dejaAffichees : 0));
}

/** La liste affichée correspond-elle encore aux données ? */
const listeAJour = () => liste.version === versionBase() && liste.filtre === filtre;

/** Mise à jour discrète (calculs en arrière-plan) : seules les cartes qui ont changé sont refaites */
export async function rafraichirListe() {
  const jeton = ++jetonListe;
  const donnees = await chargerListe();
  if (jeton !== jetonListe) return;
  appliquerDonnees(donnees);
  const cartes = [...el.liste.querySelectorAll('a.sortie[data-id]')];
  const attendues = liste.sorties.slice(0, liste.nAffiche);
  if (cartes.length !== attendues.length || attendues.some((s, i) => s.id !== cartes[i].dataset.id)) {
    jetonListe--; // même numéro : la reconstruction prend la main
    return afficherListe();
  }
  attendues.forEach((s, i) => {
    const h = carteListe(s);
    if (h === liste.htmls.get(s.id)) return;
    liste.htmls.set(s.id, h);
    cartes[i].outerHTML = h;
  });
}

// ---- Carte de synchronisation ----------------------------------------------

// ---- Animations douces (coupées si Android demande moins d'animations) ----------
// classes : entree-droite (page suivante), entree-gauche (retour), entree-fondu
let transitionNative = false; // pendant une transition de Chrome (View Transitions) : rien d'autre
const mouvementReduit = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function animer(element, classe) {
  if (!element || transitionNative) return;
  element.classList.remove('entree-droite', 'entree-gauche', 'entree-fondu');
  void element.offsetWidth; // relance l'animation même si la classe était déjà là
  element.classList.add(classe);
  element.addEventListener('animationend', () => element.classList.remove(classe), { once: true });
}

// Cartes de la liste qui arrivent en cascade (changement d'activité, ouverture)
function cascade(conteneur) {
  if (mouvementReduit()) return;
  [...conteneur.querySelectorAll('.sortie')].slice(0, 12).forEach((c, k) => c.style.setProperty('--k', k));
  conteneur.classList.remove('cascade');
  void conteneur.offsetWidth;
  conteneur.classList.add('cascade');
  setTimeout(() => conteneur.classList.remove('cascade'), 1200);
}

// court : texte du bouton « Synchro » (ex. « il y a 2 h »)
function etat(titre, detail, pastille = '', court = '') {
  el.titre.textContent = titre;
  el.detail.textContent = detail;
  el.pastille.className = `pastille ${pastille}`;
  el.synchroCourt.textContent = court || titre;
}

// ---- Menu « Synchro » (ouvert / fermé ; se ferme au choix, en dehors, ou par Échap)
let minuterieMenu;
function ouvrirMenu(oui) {
  clearTimeout(minuterieMenu);
  el.btnMenuSynchro.setAttribute('aria-expanded', String(oui));
  if (oui) {
    el.menuSynchro.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => el.menuSynchro.classList.add('ouvert')));
  } else {
    el.menuSynchro.classList.remove('ouvert');
    minuterieMenu = setTimeout(() => { el.menuSynchro.hidden = true; }, 200);
  }
}
const menuOuvert = () => el.btnMenuSynchro.getAttribute('aria-expanded') === 'true';
el.btnMenuSynchro.addEventListener('click', (e) => { e.stopPropagation(); if (activiteOuvert()) menuActivite(false); ouvrirMenu(!menuOuvert()); });
el.menuSynchro.addEventListener('click', (e) => { if (e.target.closest('.menu-item')) ouvrirMenu(false); });
document.addEventListener('click', (e) => { if (menuOuvert() && !e.target.closest('.menu')) ouvrirMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOuvert()) { ouvrirMenu(false); el.btnMenuSynchro.focus(); } });
$('btn-restaurer-menu').addEventListener('click', () => el.champ.click());

// Avancement de l'analyse des segments dans le bandeau (sauf pendant un import)
suivreRecherche((t) => { if (!occupe) progression(t); });

function progression(texte) {
  el.progression.hidden = !texte;
  el.progression.textContent = texte || '';
}

let minuterieToast;
function toast(texte) {
  el.toast.textContent = texte;
  el.toast.hidden = false;
  el.toast.classList.remove('apparait');
  void el.toast.offsetWidth;
  el.toast.classList.add('apparait');
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => { el.toast.hidden = true; }, 4500);
}

function occuper(oui) {
  occupe = oui;
  if (!oui && rechargerApres) { location.reload(); return; }
  for (const b of [el.btnDossier, el.btnSynchro, el.btnImporter, el.btnChanger, $('btn-restaurer-menu'), $('btn-telechargements')]) b.disabled = oui;
  el.btnMenuSynchro.classList.toggle('occupe', oui);
  el.btnMenuSynchro.classList.toggle('tourne', oui);
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
  el.btnChanger.hidden = true;

  if (!dossierPossible) {
    etat('Import manuel', "Ce navigateur ne permet pas de lire un dossier : importez le zip de Gadgetbridge, l'archive Strava ou un fichier .fit.", '', 'Import');
    return;
  }
  if (!dossier) {
    etat('Aucun dossier relié', "Choisissez le dossier où Gadgetbridge dépose son zip d'export automatique.", '', 'À régler');
    el.btnDossier.hidden = false;
    return;
  }
  el.btnChanger.hidden = false;
  el.btnSynchro.hidden = false;
  const derniere = await lireReglage('derniereSynchro');
  const autorisation = await etatAutorisation(dossier);
  if (autorisation === 'granted') {
    etat(`Dossier « ${dossier.name} »`, derniere ? `Dernière synchro ${ilYA(derniere)}` : 'Pas encore synchronisé', 'ok',
      derniere ? ilYA(derniere) : 'À faire');
  } else {
    etat(`Dossier « ${dossier.name} »`, "Touchez Synchroniser maintenant pour autoriser la lecture du dossier.", 'attente', 'À autoriser');
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
    if (bilan.nouvelles) chercherSegments();
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
    if (bilan.nouvelles) chercherSegments();
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
    if (e.name === 'SecurityError') toast("Android interdit au navigateur de relier ce dossier (Téléchargements, racine…). Utilisez « Importer depuis Téléchargements », ou faites déposer le zip de Gadgetbridge dans un autre dossier (par exemple Documents).");
    else if (e.name !== 'AbortError') toast(`Dossier non accessible : ${e.message}`);
    return;
  }
  await afficherEtatDossier();
  await synchroniser({ forcer: true });
});
el.btnChanger.addEventListener('click', () => el.btnDossier.click());
// Téléchargements : le navigateur ne laisse pas relier ce dossier, mais on peut y choisir le zip
$('btn-telechargements').hidden = !selecteurFichiersPossible;
$('btn-telechargements').addEventListener('click', async () => {
  let fichiers;
  try { fichiers = await choisirDansTelechargements(); } catch (e) {
    if (e.name !== 'AbortError') toast(`Téléchargements non accessible : ${e.message}`);
    return;
  }
  await importerDepuis(fichiers);
});
el.btnSynchro.addEventListener('click', () => synchroniser());
el.btnImporter.addEventListener('click', () => el.champ.click());
el.champ.addEventListener('change', async () => {
  const fichiers = [...el.champ.files].map((f) => ({ nom: f.name, lire: async () => f }));
  el.champ.value = '';
  await importerDepuis(fichiers);
});

// Passages sur les segments : nouvelles sorties, ou recherche interrompue (en arrière-plan)
function chercherSegments() {
  // records perso : la liste se met à jour quand l'analyse a trouvé des passages
  mettreAJourPassages().then((n) => { if (n && pageActuelle === 'sorties') rafraichirListe(); })
    .catch((e) => console.warn('Segments', e));
  // puissance estimée des sorties sans capteur, puis liste à jour (TSS)
  calculerEstimationsManquantes().then((n) => { if (n && pageActuelle === 'sorties') rafraichirListe(); })
    .catch((e) => console.warn('Estimations', e));
  // efforts (meilleures puissances) des nouvelles sorties : records et FTP à jour après chaque sortie
  // puis réglage automatique de la FTP (seulement à la hausse)
  toutesLesSorties().then((toutes) => calculerEffortsManquants(toutes))
    .then(() => reglerFtpAuto())
    .then((h) => {
      if (!h) return;
      toast(`FTP réglée automatiquement : ${h.avantW} → ${h.ftpW} W (meilleur 20 min du ${fmtJour.format(new Date(h.sortie.debut))}).`);
      if (pageActuelle === 'sorties') rafraichirListe();
    })
    .catch((e) => console.warn('Efforts / FTP', e));
}

// ---- Navigation : accueil, détail d'une sortie, réglages -------------------

let navigationInterne = false; // arrivé sur le détail par un lien de l'appli
let defilementListe = 0;
let pageActuelle = 'sorties';

const TITRES = { sorties: 'Mes sorties', progres: 'Progrès', profil: 'Profil', detail: 'Sortie', segment: 'Segment', traces: 'Tracés' };

document.addEventListener('click', (e) => { if (e.target.closest('a[href^="#sortie="], a[href^="#segment="]')) navigationInterne = true; });
el.btnRetour.addEventListener('click', () => {
  if (navigationInterne) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); router({ retour: true }); }
});

function pageDepuisAdresse() {
  const h = location.hash;
  if (h.startsWith('#sortie=')) return { page: 'detail', id: decodeURIComponent(h.slice(8)) };
  if (h.startsWith('#segment=')) return { page: 'segment', id: decodeURIComponent(h.slice(9)) };
  if (h === '#progres') return { page: 'progres' };
  if (h === '#traces') return { page: 'traces' };
  if (h.startsWith('#trace=')) return { page: 'traces', id: decodeURIComponent(h.slice(7)) };
  if (h === '#profil' || h === '#reglages') return { page: 'profil' };
  return { page: 'sorties' };
}

// Sens de la navigation : chaque entrée de l'historique reçoit un numéro ;
// revenir à un numéro plus petit = retour (glisse depuis la gauche)
let dernierN = history.state?.n ?? 0;
let compteurN = dernierN;
// Position de chaque page de l'historique : en revenant en arrière (ou en avant),
// on retrouve la page là où on l'avait laissée (ex. le bloc Segments d'une sortie)
try { history.scrollRestoration = 'manual'; } catch { /* vieux navigateur */ }
const defilements = new Map(); // numéro d'entrée -> scrollY
let nQuitte = dernierN;
let dejaVue = false; // l'entrée affichée existait déjà (retour ou avance dans l'historique)
function sensNavigation(page, avant, retourForce) {
  let n = history.state?.n;
  let retour = !!retourForce;
  nQuitte = dernierN;
  dejaVue = n != null;
  if (n == null) {
    n = ++compteurN;
    history.replaceState({ ...(history.state || {}), n }, '');
  } else {
    retour = retour || n < dernierN;
    compteurN = Math.max(compteurN, n);
  }
  dernierN = n;
  const sous = (p) => p === 'detail' || p === 'segment';
  if (retour) return 'entree-gauche';
  if (sous(page)) return 'entree-droite';
  if (sous(avant)) return 'entree-gauche';
  return 'entree-fondu';
}

async function router(options = {}) {
  const { page, id } = pageDepuisAdresse();
  const avant = pageActuelle;
  const sens = sensNavigation(page, avant, options.retour === true);
  // Transition native de Chrome : l'ancienne page reste affichée jusqu'à ce que
  // la nouvelle soit prête, puis les deux glissent (ou se fondent) ensemble
  if (document.startViewTransition && !mouvementReduit()) {
    document.documentElement.dataset.sens = { 'entree-droite': 'avant', 'entree-gauche': 'retour' }[sens] ?? 'onglet';
    transitionNative = true;
    try {
      const t = document.startViewTransition(() => afficherPage(page, id, avant, sens));
      // repère « transition en cours » (la page n'est touchable qu'à la fin du glissement)
      document.documentElement.dataset.transition = 'oui';
      t.finished.catch(() => {}).finally(() => { delete document.documentElement.dataset.transition; });
      await t.updateCallbackDone;
    } catch (e) {
      console.warn('Transition', e);
    } finally {
      transitionNative = false;
    }
    return;
  }
  await afficherPage(page, id, avant, sens);
}

/** Remet la page à `y` ; si elle n'est pas encore assez haute (blocs qui arrivent), réessaie */
let arretDefilement = () => {};
function remettreDefilement(y) {
  arretDefilement();
  window.scrollTo(0, y);
  if (!y) return;
  const obs = new ResizeObserver(() => { if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y); });
  obs.observe(document.body);
  const arret = () => { obs.disconnect(); clearTimeout(fin); for (const t of ['touchstart', 'wheel', 'keydown', 'mousedown']) window.removeEventListener(t, arret); };
  const fin = setTimeout(arret, 2500);
  for (const t of ['touchstart', 'wheel', 'keydown', 'mousedown']) window.addEventListener(t, arret, { passive: true });
  arretDefilement = arret;
}

async function afficherPage(page, id, avant, sens) {
  arretDefilement();
  defilements.set(nQuitte, window.scrollY);
  const defilement = dejaVue ? (defilements.get(dernierN) ?? 0) : 0;
  if (avant === 'sorties' && page !== 'sorties') defilementListe = window.scrollY;
  // en revenant d'une sous-page vers une autre sous-page (segment -> sortie), on garde le lien de retour
  pageActuelle = page;
  fermerDetail();
  fermerTraces();
  el.accueil.hidden = page !== 'sorties';
  el.pageProgres.hidden = page !== 'progres';
  el.pageTraces.hidden = page !== 'traces';
  el.pageDetail.hidden = page !== 'detail';
  el.pageReglages.hidden = page !== 'profil';
  el.pageSegment.hidden = page !== 'segment';
  const sousPage = page === 'detail' || page === 'segment';
  document.body.classList.toggle('sous-page', sousPage);
  el.titrePage.textContent = TITRES[page];
  for (const o of document.querySelectorAll('.onglet')) {
    if (o.dataset.onglet === page) o.setAttribute('aria-current', 'page'); else o.removeAttribute('aria-current');
  }

  if (page === 'detail') {
    el.pageDetail.innerHTML = '<p class="chargement">Chargement…</p>';
    window.scrollTo(0, 0);
    try { await afficherDetail(el.pageDetail, id, toast); } catch (e) {
      console.error(e);
      el.pageDetail.innerHTML = `<section class="carte"><p>Détail impossible : ${echapper(e.message)}</p></section>`;
    }
    animer(el.pageDetail, sens);
    remettreDefilement(defilement);
    return;
  }
  if (page === 'segment') {
    el.pageSegment.innerHTML = '<p class="chargement">Chargement…</p>';
    window.scrollTo(0, 0);
    try { await afficherSegment(el.pageSegment, id, toast); } catch (e) {
      console.error(e);
      el.pageSegment.innerHTML = `<section class="carte"><p>Segment impossible : ${echapper(e.message)}</p></section>`;
    }
    animer(el.pageSegment, sens);
    remettreDefilement(defilement);
    return;
  }
  navigationInterne = false;
  if (page === 'progres') {
    window.scrollTo(0, 0);
    const options = {
      filtre,
      changerFiltre: async (cle) => { await changerFiltre(cle); options.filtre = filtre; await afficherProgres(el.pageProgres, options); },
    };
    animer(el.pageProgres, sens);
    await afficherProgres(el.pageProgres, options);
    remettreDefilement(defilement);
  } else if (page === 'traces') {
    window.scrollTo(0, 0);
    await afficherTraces(el.pageTraces, toast, id ?? null);
    remettreDefilement(defilement);
  } else if (page === 'profil') {
    window.scrollTo(0, 0);
    animer(el.pageReglages, sens);
    await afficherReglages(el.pageReglages, toast);
    remettreDefilement(defilement);
  } else if (avant !== 'sorties') {
    if (!listeAJour()) await afficherListe(); // FTP, tri ou sorties ont pu changer ailleurs ; sinon la liste gardée est réaffichée telle quelle
    remettreDefilement(dejaVue ? defilement : (avant === 'detail' ? defilementListe : 0));
    animer(el.accueil, sens);
  }
}
window.addEventListener('hashchange', () => router());

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
  // pas de service worker pour le fichier unique ouvert depuis le téléphone (file://, content://)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) miseAJourAuto();
  await afficherListe();
  if (!location.hash) cascade(el.liste);

  // Fichiers reçus par le menu Partager d'Android
  if (new URLSearchParams(location.search).has('partage')) {
    history.replaceState(null, '', location.pathname);
    const recus = await viderPartages();
    await importerDepuis(recus.map((p) => ({ nom: p.nom, lire: async () => p.octets })));
  }

  if (location.hash) await router();

  if (dossierPossible) dossier = await dossierMemorise();
  await afficherEtatDossier();
  chercherSegments();
  if (dossier) await synchroniser({ auto: true });
}

demarrer();
