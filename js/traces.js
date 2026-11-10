// Onglet « Tracés » : créer un parcours sur la carte (calcul de route vélo
// BRouter), voir son profil et sa 3D, l'enregistrer, l'exporter en GPX.
import { lireReglage, ecrireReglage, toutesLesSorties } from './db.js';
import { lireProfil } from './profil.js';
import {
  PROFILS, calculerRoute, denivele, tempsEstimeS, gpxDepuisTrace, nomFichierGpx, distanceM, lireGpxParcours,
} from './routage.js';
import { creerVue3d, construireTrace, GCOL } from './vue3d.js';
import { telecharger } from './sauvegarde.js';
import { retirerCarte, htmlCarteStatique } from './carte-statique.js';
import { nombre, km, duree, chrono, echapper, fmtDate, htmlRepli, suivreReplis } from './format.js';
import { lireSegments, lirePassages } from './segments.js';
import { bboxCompatible, trouverPassages } from './segments-calc.js';
import { proposerNomTrace } from './lieux.js';
import { chargerMeteo, planifier, echantillonner, couleurVent, CLASSES_VENT, pointCardinal, risquePluie, SEUIL_PLUIE_PCT } from './vent.js';

const CENTRE_DEFAUT = [45.188, 5.725]; // Grenoble
const PUISSANCE_DEFAUT_W = 150; // comme le temps estimé de Parcours 3D

// Tracé en cours (gardé quand on change d'onglet)
// heure : départ prévu « HH:MM » (avec le jour du bloc vent) ; nomPropose : dernier nom
// proposé par l'appli (remplacé tant que Cyril ne l'a pas changé)
const ed = { id: null, nom: '', nomPropose: '', heure: '', profil: 'fastbike', points: [], route: null, calcul: 0, erreur: '' };
let jetonNom = 0;
let jetonSegments = 0;
const COULEUR_SEGMENT = '#1e88e5';
// Vent : prévisions gardées pour le tracé en cours, plan (heures × sens), heure choisie, couleurs
const vent = { series: null, jour: 0, plan: null, choix: null, couleurs: false, erreur: '', enCours: false };
const oublierVent = () => Object.assign(vent, { series: null, plan: null, choix: null, erreur: '' });
let carte = null;
let couches = null;
let vue3d = null;
let toastFn = () => {};

export function fermerTraces() {
  if (vue3d) { vue3d.detruire(); vue3d = null; }
  if (carte) { retirerCarte(carte); carte = null; couches = null; }
}

export { retirerCarte };

// ---- Stockage : index « traces » + un réglage « trace:<id> » par tracé ----------

export async function lireIndexTraces() { return (await lireReglage('traces')) ?? []; }
export async function lireTrace(id) { return lireReglage(`trace:${id}`); }

// Aperçu de la liste : au plus 160 points [lat, lon] du tracé (comme la trace simplifiée des sorties)
export function apercuTrace(coords, max = 160) {
  if (!coords?.length) return [];
  const pas = Math.max(1, Math.ceil(coords.length / max));
  const res = coords.filter((_, i) => i % pas === 0).map((c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]);
  const fin = coords[coords.length - 1];
  if ((coords.length - 1) % pas) res.push([Math.round(fin[0] * 1e5) / 1e5, Math.round(fin[1] * 1e5) / 1e5]);
  return res;
}

async function enregistrerTrace(t) {
  await ecrireReglage(`trace:${t.id}`, t);
  const index = (await lireIndexTraces()).filter((x) => x.id !== t.id);
  index.unshift({ id: t.id, nom: t.nom, distanceM: t.distanceM, denivelePosM: t.denivelePosM, departMs: t.departMs ?? null, modifieLe: t.modifieLe, apercu: apercuTrace(t.coords) });
  await ecrireReglage('traces', index);
}

async function supprimerTrace(id) {
  await ecrireReglage(`trace:${id}`, null);
  await ecrireReglage('traces', (await lireIndexTraces()).filter((x) => x.id !== id));
}

// ---- Calculs d'affichage ----------------------------------------------------------

function pointsDeRoute(coords) {
  let d = 0;
  return coords.map((c, i) => {
    if (i) d += distanceM(coords[i - 1], c);
    const p = { lat: c[0], lon: c[1], distanceM: d, tS: i, horodatage: new Date(i * 1000) };
    if (typeof c[2] === 'number') p.altitudeM = c[2];
    return p;
  });
}

function stats(route, puissanceW, poidsKg) {
  const dn = denivele(route.coords);
  const T = dn.avecAltitude ? construireTrace(pointsDeRoute(route.coords)) : null;
  const penteMax = T ? Math.max(...T.G) : null;
  return {
    distanceM: route.distanceM,
    denivelePosM: route.denivelePosM ?? (dn.avecAltitude ? dn.plus : null),
    penteMax,
    tempsS: tempsEstimeS(route.coords, puissanceW, poidsKg),
    avecAltitude: dn.avecAltitude,
  };
}

// Profil coloré selon la pente (300 colonnes), comme la courbe d'altitude du détail
function profilSvg(route) {
  const pts = pointsDeRoute(route.coords).filter((p) => typeof p.altitudeM === 'number');
  if (pts.length < 2) return '';
  const N = 300;
  const tot = pts[pts.length - 1].distanceM || 1;
  const col = Array.from({ length: N }, () => ({ s: 0, n: 0 }));
  for (const p of pts) { const c = Math.min(N - 1, Math.floor((p.distanceM / tot) * N)); col[c].s += p.altitudeM; col[c].n++; }
  const ys = col.map((c) => (c.n ? c.s / c.n : null));
  for (let c = 1; c < N; c++) if (ys[c] === null) ys[c] = ys[c - 1];
  for (let c = N - 2; c >= 0; c--) if (ys[c] === null) ys[c] = ys[c + 1];
  const bas = Math.min(...ys); const haut = Math.max(...ys);
  const marge = Math.max(5, (haut - bas) * 0.1);
  const y = (v) => 100 - ((v - (bas - marge)) / (haut + marge - (bas - marge))) * 100;
  const largeurM = tot / N;
  const rects = ys.map((v, c) => {
    const a = ys[Math.max(0, c - 1)]; const b = ys[Math.min(N - 1, c + 1)];
    const n = Math.min(N - 1, c + 1) - Math.max(0, c - 1);
    const pente = ((b - a) / (n * largeurM)) * 100;
    return `<rect x="${c}" y="${y(v).toFixed(2)}" width="1.02" height="${(100 - y(v)).toFixed(2)}" fill="${GCOL(pente)}"/>`;
  }).join('');
  const ligne = ys.map((v, c) => `${c ? 'L' : 'M'}${c + 0.5} ${y(v).toFixed(2)}`).join('');
  return `<div class="profil-trace" data-tot="${tot}">
    <svg viewBox="0 0 ${N} 100" preserveAspectRatio="none" aria-hidden="true">${rects}<path d="${ligne}" class="profil-ligne"/></svg>
    <span class="courbe-axe haut">${nombre(haut)} m</span><span class="courbe-axe bas">${nombre(bas)} m</span>
    <span class="curseur" hidden></span>
  </div>
  <p class="courbes-position" id="profil-position">Touchez le profil pour situer un point</p>`;
}

// ---- Page ----------------------------------------------------------------------------

export async function afficherTraces(page, toast, idAOuvrir = null) {
  toastFn = toast;
  fermerTraces();
  if (idAOuvrir) await ouvrir(idAOuvrir);
  const profil = await lireProfil();
  const puissanceW = (await lireReglage('puissanceParcoursW')) ?? PUISSANCE_DEFAUT_W;
  planPoids = profil.poidsKg ?? 98;
  page.innerHTML = `
  <section class="editeur-trace">
    <div class="carte-plein">
      <div class="carte-trace" id="carte-trace"></div>
      <div class="outils-trace">
        <label class="menu-bouton choix-profil">
          <span class="menu-libelle">Itinéraire</span>
          <select id="profil-route">${Object.entries(PROFILS).map(([k, t]) => `<option value="${k}"${k === ed.profil ? ' selected' : ''}>${t}</option>`).join('')}</select>
          <svg class="chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </label>
        <div class="outils-boutons">
          <button class="btn secondaire petit" type="button" data-a="annuler" title="Retirer le dernier point">↶ Annuler</button>
          <button class="btn secondaire petit" type="button" data-a="boucle" title="Revenir au point de départ">⟲ Boucle</button>
          <button class="btn secondaire petit" type="button" data-a="inverser" title="Parcourir dans l'autre sens">⇄ Inverser</button>
          <button class="btn secondaire petit" type="button" data-a="position" title="Centrer sur ma position">◎</button>
          <button class="btn secondaire petit danger" type="button" data-a="effacer">Effacer</button>
        </div>
      </div>
      <p class="aide etat-flottant" id="trace-etat"></p>
      <button class="btn principal bouton-creer" type="button" data-a="gpx">⬇ Créer le GPX</button>
    </div>
    <div id="trace-resume"></div>
    <div class="segments vues" role="group" data-segments="vue-trace" hidden>
      <button type="button" data-valeur="profil" aria-pressed="true">Profil</button>
      <button type="button" data-valeur="3d" aria-pressed="false">3D</button>
    </div>
    <div id="trace-profil"></div>
    <div class="vue3d" id="trace-3d" hidden></div>
    <section class="carte bloc" id="segments-trace" hidden></section>
    <section class="carte bloc" id="bloc-vent" hidden>
      <h2 class="bloc-titre">Vent : quand partir, dans quel sens ?</h2>
      <div class="vent-choix">
        <label class="menu-bouton choix-jour">
          <span class="menu-libelle">Jour</span>
          <select id="jour-vent">${joursProposes().map(([v, t]) => `<option value="${v}"${v === vent.jour ? ' selected' : ''}>${t}</option>`).join('')}</select>
          <svg class="chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </label>
        <label class="menu-bouton choix-heure">
          <span class="menu-libelle">Heure</span>
          <input type="time" id="heure-depart" step="300" value="${ed.heure}" aria-label="Heure de départ prévue">
        </label>
        <button class="btn principal" type="button" data-a="vent">Prévoir</button>
      </div>
      <div id="vent-resultat"></div>
      <label class="case"><input type="checkbox" id="couleurs-vent"${vent.couleurs ? ' checked' : ''}> Couleurs du vent sur la 3D (bleu : dans le dos, rouge : de face)</label>
      <p class="bloc-note">Heure : facultative ; elle est ajoutée au tableau (même avant 6 h ou après 20 h), gardée avec le tracé et mise dans le GPX. Repris de l'appli « Vent et températures » : prévisions Open-Meteo (seule la zone du parcours, une trentaine de points, est envoyée). Sens conseillé : vent dans le dos sur le dernier tiers. Durée avec le vent prévu : puissance pour le temps estimé sur le plat, +30 % en montée, roue libre en descente.</p>
    </section>
    <div class="trace-enregistrement">
      <label class="champ-ligne"><span>Nom du tracé</span><input id="nom-trace" type="text" maxlength="60" value="${echapper(ed.nom)}" placeholder="Ex. : boucle du Vercors"></label>
      <button class="btn secondaire petit" type="button" data-a="nom">Proposer un nom</button>
      <label class="champ-ligne"><span>Puissance pour le temps estimé (W)</span><input id="puissance-trace" type="number" inputmode="numeric" min="50" max="600" value="${puissanceW}"></label>
      <div class="synchro-actions">
        <button class="btn principal" type="button" data-a="enregistrer">Enregistrer</button>
        <button class="btn secondaire" type="button" data-a="gpx">Exporter le GPX</button>
        <button class="btn secondaire" type="button" data-a="partager">Partager</button>
        <button class="btn secondaire" type="button" data-a="nouveau">Nouveau tracé</button>
      </div>
    </div>
    <p class="bloc-note">Itinéraire calculé en ligne par BRouter (OpenStreetMap) : seuls les points placés sur la carte sont envoyés.
      Temps estimé à puissance constante, sans vent ni arrêts. Pour le BiNavi : « Partager » puis choisis l'appli qui l'envoie au compteur, ou garde le fichier GPX.</p>
  </section>
  <section class="carte bloc" id="mes-traces"></section>`;

  // Carte
  const L = globalThis.L;
  const div = page.querySelector('#carte-trace');
  if (L) {
    carte = L.map(div, { scrollWheelZoom: true, attributionControl: true, doubleClickZoom: false });
    carte.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(carte);
    couches = L.layerGroup().addTo(carte);
    carte.on('click', (e) => { ed.points.push([e.latlng.lat, e.latlng.lng]); recalculer(page, profil); });
    if (ed.points.length) carte.fitBounds(L.latLngBounds(ed.route?.coords.map((c) => [c[0], c[1]]) ?? ed.points), { padding: [24, 24], animate: false });
    else carte.setView(await centreInitial(), 12);
  }
  dessiner(page, profil);
  await afficherListe(page, profil);

  page.querySelector('#profil-route').addEventListener('change', (e) => { ed.profil = e.target.value; recalculer(page, profil); });
  page.querySelector('#nom-trace').addEventListener('input', (e) => { ed.nom = e.target.value; });
  page.querySelector('#puissance-trace').addEventListener('change', async (e) => {
    const w = Math.round(Number(e.target.value));
    if (w >= 50 && w <= 600) { await ecrireReglage('puissanceParcoursW', w); dessiner(page, profil); }
  });
  page.querySelector('[data-segments="vue-trace"]').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) montrerVue(page, b.dataset.valeur);
  });
  page.querySelector('#jour-vent').addEventListener('change', (e) => { vent.jour = Number(e.target.value); oublierVent(); afficherVent(page); });
  page.querySelector('#heure-depart').addEventListener('change', async (e) => {
    ed.heure = e.target.value;
    if (vent.plan) await prevoirVent(page, profil); // nouvelle heure : tableau refait
    else afficherVent(page);
  });
  page.querySelector('#segments-trace').addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg-voir]');
    if (!b || !carte || !ed.route) return;
    const [i0, i1] = b.dataset.segVoir.split('-').map(Number);
    carte.fitBounds(globalThis.L.latLngBounds(ed.route.coords.slice(i0, i1 + 1).map((c) => [c[0], c[1]])), { padding: [40, 40] });
    page.querySelector('#carte-trace').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  page.querySelector('#couleurs-vent').addEventListener('change', (e) => { vent.couleurs = e.target.checked; appliquerCouleursVent(); afficherVent(page); });
  page.querySelector('#vent-resultat').addEventListener('click', (e) => {
    const ligne = e.target.closest('[data-heure]');
    if (ligne) { vent.choix = Number(ligne.dataset.heure); afficherVent(page); appliquerCouleursVent(); return; }
    if (e.target.closest('[data-a="sens-vent"]')) mettreDansLeSens(page, profil);
  });
  page.querySelector('.editeur-trace').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'vent') { await prevoirVent(page, profil); return; }
    if (a === 'nom') { await proposerNom(page, true); return; }
    if (a === 'annuler') { ed.points.pop(); recalculer(page, profil); }
    else if (a === 'boucle') {
      if (ed.points.length < 2) { toastFn('Place au moins deux points.'); return; }
      ed.points.push([...ed.points[0]]); recalculer(page, profil);
    } else if (a === 'inverser') { ed.points.reverse(); recalculer(page, profil); }
    else if (a === 'effacer') {
      if (ed.points.length && !confirm('Effacer le tracé en cours ?')) return;
      Object.assign(ed, { id: null, nom: '', nomPropose: '', points: [], route: null, erreur: '' });
      page.querySelector('#nom-trace').value = '';
      dessiner(page, profil);
    } else if (a === 'nouveau') {
      Object.assign(ed, { id: null, nom: '', nomPropose: '', points: [], route: null, erreur: '' });
      page.querySelector('#nom-trace').value = '';
      dessiner(page, profil);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (a === 'position') {
      navigator.geolocation?.getCurrentPosition(
        (p) => carte?.setView([p.coords.latitude, p.coords.longitude], 14),
        () => toastFn('Position indisponible.'), { enableHighAccuracy: true, timeout: 10000 },
      );
    } else if (a === 'enregistrer') await enregistrer(page, profil);
    else if (a === 'gpx') exporter(false);
    else if (a === 'partager') exporter(true);
  });
}

async function centreInitial() {
  // départ de la sortie la plus récente, sinon Grenoble
  const sorties = (await toutesLesSorties()).filter((s) => s.trace?.length).sort((a, b) => b.debut - a.debut);
  return sorties[0]?.trace[0] ?? CENTRE_DEFAUT;
}

async function ouvrir(id) {
  const t = await lireTrace(id);
  if (!t) return;
  Object.assign(ed, { id: t.id, nom: t.nom, nomPropose: '', profil: t.profil, points: t.points, route: { coords: t.coords, distanceM: t.distanceM, denivelePosM: t.denivelePosM }, erreur: '', importe: !!t.importe });
  // départ prévu : l'heure est reprise ; le jour aussi s'il est dans les 7 jours qui viennent
  ed.heure = t.departMs ? heureDe(t.departMs) : '';
  oublierVent();
  if (t.departMs) {
    const j = Math.round((new Date(t.departMs).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
    if (j >= 0 && j < 7) vent.jour = j;
  }
}

const heureDe = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** Date du départ prévu (jour du bloc vent + heure), ou null */
export function dateDepart(jourDecale, heure, maintenant = new Date()) {
  if (!/^\d{1,2}:\d{2}$/.test(heure ?? '')) return null;
  const [h, m] = heure.split(':').map(Number);
  const d = new Date(maintenant); d.setDate(d.getDate() + jourDecale); d.setHours(h, m, 0, 0);
  return d.getTime();
}

// Nom proposé (lieux OpenStreetMap) : rempli tant que le champ est vide ou garde
// l'ancienne proposition ; « Proposer un nom » le remplace dans tous les cas
async function proposerNom(page, force = false) {
  if (!ed.route || ed.points.length < 2) { if (force) toastFn('Place au moins deux points.'); return; }
  if (!force && ed.nom.trim() && ed.nom !== ed.nomPropose) return;
  const jeton = ++jetonNom;
  const dn = denivele(ed.route.coords);
  const nom = await proposerNomTrace(ed.route.coords, ed.route.distanceM, ed.route.denivelePosM ?? (dn.avecAltitude ? dn.plus : null));
  if (jeton !== jetonNom || (!force && ed.nom.trim() && ed.nom !== ed.nomPropose)) return;
  ed.nom = nom; ed.nomPropose = nom;
  const champ = page.querySelector('#nom-trace');
  if (champ) champ.value = nom;
}

// Segments enregistrés que le tracé emprunte : en bleu sur la carte, liste sous le profil
async function afficherSegmentsTrace(page, profil) {
  const bloc = page.querySelector('#segments-trace');
  if (!bloc) return;
  const jeton = ++jetonSegments;
  if (!ed.route) { bloc.hidden = true; return; }
  const [segments, passages] = await Promise.all([lireSegments(), lirePassages()]);
  if (jeton !== jetonSegments || !ed.route) return;
  const coords = ed.route.coords;
  const simple = coords.map((c) => [c[0], c[1]]);
  const pts = pointsDeRoute(coords);
  const trouves = [];
  for (const g of segments) {
    if (!bboxCompatible(g, simple)) continue;
    for (const p of trouverPassages(g, pts)) trouves.push({ g, i0: p.iDebut, i1: p.iFin });
  }
  trouves.sort((a, b) => a.i0 - b.i0);
  bloc.hidden = !trouves.length;
  if (!trouves.length) { bloc.innerHTML = ''; return; }
  const L = globalThis.L;
  if (carte && L && couches) {
    for (const t of trouves) {
      const ligne = coords.slice(t.i0, t.i1 + 1).map((c) => [c[0], c[1]]);
      L.polyline(ligne, { color: '#fff', weight: 9, opacity: 0.85, interactive: false }).addTo(couches);
      L.polyline(ligne, { color: COULEUR_SEGMENT, weight: 6, opacity: 1, className: 'trait-segment' }).addTo(couches).bindTooltip(t.g.nom);
    }
  }
  const puissanceW = Number(page.querySelector('#puissance-trace')?.value) || PUISSANCE_DEFAUT_W;
  const pasFaits = trouves.filter((t) => !passages.some((p) => p.segmentId === t.g.id)).length;
  const resume = `${trouves.length} segment${trouves.length > 1 ? 's' : ''}${pasFaits ? ` · ${pasFaits} pas encore fait${pasFaits > 1 ? 's' : ''}` : ''}`;
  bloc.innerHTML = htmlRepli('segments-trace', 'Segments sur ce tracé', resume, `
    <div class="passages">${trouves.map((t) => {
      const record = passages.filter((p) => p.segmentId === t.g.id).sort((a, b) => a.dureeS - b.dureeS)[0];
      const estime = tempsEstimeS(coords.slice(t.i0, t.i1 + 1), puissanceW, profil.poidsKg);
      return `<div class="passage-suivi"><a class="passage" href="#segment=${encodeURIComponent(t.g.id)}">
        <span class="passage-nom">${echapper(t.g.nom)}<small>km ${nombre(pts[t.i0].distanceM / 1000, 1)} → ${nombre(pts[t.i1].distanceM / 1000, 1)} · ${km(t.g.distanceM)} km${t.g.penteMoyPct != null ? ` à ${nombre(t.g.penteMoyPct, 1)} %` : ''}</small></span>
        <span class="passage-temps">${record ? chrono(record.dureeS) : '–'}<span class="rang${record ? ' or' : ' discret'}">${record ? '🏆 Record' : 'Pas encore fait'}</span></span>
        <span class="passage-mesures">Temps estimé à ${puissanceW} W : ${chrono(estime)}</span></a>
        <button class="btn secondaire petit" type="button" data-seg-voir="${t.i0}-${t.i1}">Voir</button></div>`;
    }).join('')}</div>
    <p class="bloc-note">En bleu sur la carte. « Voir » cadre la carte sur le segment ; touche son nom pour son historique.</p>`);
  suivreReplis(bloc);
}

let minuterie = 0;
function recalculer(page, profil) {
  clearTimeout(minuterie);
  // tracé importé : dès qu'on touche aux points, l'itinéraire est recalculé (le GPX d'origine est remplacé)
  if (ed.importe) { ed.importe = false; toastFn('Tracé importé modifié : itinéraire recalculé entre ses points.'); }
  dessiner(page, profil, true);
  minuterie = setTimeout(async () => {
    const n = ++ed.calcul;
    if (ed.points.length < 2) { ed.route = null; ed.erreur = ''; dessiner(page, profil); return; }
    try {
      const route = await calculerRoute(ed.points, ed.profil);
      if (n !== ed.calcul) return; // une demande plus récente est partie
      ed.route = route;
      oublierVent(); // nouveau tracé : prévisions et plan à refaire
      ed.erreur = '';
    } catch (e) {
      if (n !== ed.calcul) return;
      ed.erreur = e.message;
    }
    dessiner(page, profil);
  }, 350);
}

function dessiner(page, profil, enCalcul = false) {
  const L = globalThis.L;
  if (carte && L) {
    couches.clearLayers();
    const trait = getComputedStyle(document.documentElement).getPropertyValue('--trace-carte').trim() || '#e8590c';
    if (ed.route) L.polyline(ed.route.coords.map((c) => [c[0], c[1]]), { color: trait, weight: 5, opacity: 0.95 }).addTo(couches);
    ed.points.forEach((p, k) => {
      const dernier = k === ed.points.length - 1;
      const m = L.marker(p, {
        draggable: true,
        icon: L.divIcon({ className: `repere-trace${k === 0 ? ' depart' : dernier ? ' arrivee' : ''}`, html: `<span>${k + 1}</span>`, iconSize: [26, 26] }),
      }).addTo(couches);
      m.on('dragend', () => { const ll = m.getLatLng(); ed.points[k] = [ll.lat, ll.lng]; recalculer(page, profil); });
      m.on('click', () => {
        if (confirm(`Retirer le point ${k + 1} ?`)) { ed.points.splice(k, 1); recalculer(page, profil); }
      });
    });
  }
  const etat = page.querySelector('#trace-etat');
  if (!ed.points.length) etat.textContent = 'Touche la carte pour placer le départ, puis les points de passage. Fais glisser un point pour le déplacer ; touche-le pour le retirer.';
  else if (ed.points.length === 1) etat.textContent = 'Départ placé : touche la carte pour le point suivant.';
  else if (enCalcul) etat.textContent = 'Calcul de l\'itinéraire…';
  else if (ed.erreur) etat.textContent = `Calcul impossible : ${ed.erreur}. Choisis « Ligne droite » pour tracer sans réseau.`;
  else if (ed.importe) etat.textContent = 'Tracé importé d\'un GPX. Déplacer ou ajouter un point recalcule l\'itinéraire.';
  else etat.textContent = `${ed.points.length} points · ${PROFILS[ed.profil]}`;
  etat.classList.toggle('erreur', !!ed.erreur && !enCalcul);

  const resume = page.querySelector('#trace-resume');
  const blocProfil = page.querySelector('#trace-profil');
  const boutonsVue = page.querySelector('[data-segments="vue-trace"]');
  if (!ed.route || ed.points.length < 2) {
    resume.innerHTML = ''; blocProfil.innerHTML = ''; boutonsVue.hidden = true;
    page.querySelector('#bloc-vent').hidden = true;
    jetonSegments++;
    page.querySelector('#segments-trace').hidden = true;
    montrerVue(page, 'profil');
    return;
  }
  const puissanceW = Number(page.querySelector('#puissance-trace')?.value) || PUISSANCE_DEFAUT_W;
  const st = stats(ed.route, puissanceW, profil.poidsKg);
  resume.innerHTML = `<div class="stats stats-4">
    <div><span class="stat-label">Distance</span><span class="stat-val">${km(st.distanceM)}<small>km</small></span></div>
    <div><span class="stat-label">Dénivelé</span><span class="stat-val">${st.denivelePosM != null ? nombre(st.denivelePosM) : '–'}<small>m</small></span></div>
    <div><span class="stat-label">Pente max</span><span class="stat-val">${st.penteMax != null ? nombre(st.penteMax, 1) : '–'}<small>%</small></span></div>
    <div><span class="stat-label">Temps estimé</span><span class="stat-val">${duree(st.tempsS)}</span></div>
  </div>`;
  blocProfil.innerHTML = st.avecAltitude ? profilSvg(ed.route) : '<p class="aide">Pas d\'altitude en ligne droite : profil et 3D indisponibles.</p>';
  boutonsVue.hidden = !st.avecAltitude;
  page.querySelector('#bloc-vent').hidden = false;
  afficherVent(page);
  installerCurseurProfil(page);
  if (!enCalcul && !ed.erreur) {
    afficherSegmentsTrace(page, profil).catch((e) => console.warn('Segments du tracé', e));
    proposerNom(page).catch((e) => console.warn('Nom du tracé', e));
  }
  if (vue3d) { vue3d.detruire(); vue3d = null; montrerVue(page, 'profil'); }
}

function installerCurseurProfil(page) {
  const zone = page.querySelector('.profil-trace');
  if (!zone || !ed.route) return;
  const pts = pointsDeRoute(ed.route.coords);
  const tot = pts[pts.length - 1].distanceM || 1;
  let point = null;
  const placer = (clientX) => {
    const r = zone.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const d = f * tot;
    let i = pts.findIndex((p) => p.distanceM >= d);
    if (i < 0) i = pts.length - 1;
    const p = pts[i];
    const c = zone.querySelector('.curseur');
    c.hidden = false;
    c.style.left = `${(f * 100).toFixed(2)}%`;
    const a = pts[Math.max(0, i - 5)]; const b = pts[Math.min(pts.length - 1, i + 5)];
    const pente = b.distanceM > a.distanceM && typeof a.altitudeM === 'number' ? ((b.altitudeM - a.altitudeM) / (b.distanceM - a.distanceM)) * 100 : null;
    page.querySelector('#profil-position').textContent = `km ${nombre(p.distanceM / 1000, 1)} · ${nombre(p.altitudeM ?? 0)} m${pente != null ? ` · ${nombre(pente, 1)} %` : ''}`;
    if (carte && globalThis.L) {
      if (!point) point = globalThis.L.circleMarker([p.lat, p.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#ff6a13', fillOpacity: 1 }).addTo(couches);
      else point.setLatLng([p.lat, p.lon]);
    }
  };
  zone.addEventListener('pointerdown', (e) => placer(e.clientX));
  zone.addEventListener('pointermove', (e) => placer(e.clientX));
}

function montrerVue(page, mode) {
  const profilEl = page.querySelector('#trace-profil');
  const vue = page.querySelector('#trace-3d');
  if (!profilEl || !vue) return;
  for (const b of page.querySelectorAll('[data-segments="vue-trace"] button')) b.setAttribute('aria-pressed', String(b.dataset.valeur === mode));
  profilEl.hidden = mode !== 'profil';
  vue.hidden = mode !== '3d';
  if (mode === '3d' && ed.route) {
    if (!vue3d) vue3d = creerVue3d(vue, pointsDeRoute(ed.route.coords));
    appliquerCouleursVent();
    vue3d?.afficher(true);
  } else vue3d?.afficher(false);
}

// ---- Vent : prévisions, plan des heures de départ, couleurs --------------------------

const fmtHeureCourte = (ms) => { const d = new Date(ms); return `${d.getHours()} h${d.getMinutes() ? ` ${String(d.getMinutes()).padStart(2, '0')}` : ''}`; };

function joursProposes() {
  const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  return Array.from({ length: 7 }, (_, k) => {
    const d = new Date(); d.setDate(d.getDate() + k);
    return [k, k === 0 ? "Aujourd'hui" : k === 1 ? 'Demain' : fmt.format(d).replace(/^./, (c) => c.toUpperCase())];
  });
}

// Heures de départ proposées : de 6 h à 20 h (aujourd'hui : à partir de l'heure suivante),
// plus l'heure choisie par Cyril (« HH:MM ») si elle est à venir
export function heuresDeDepart(jourDecale, maintenant = new Date(), heure = '') {
  const res = [];
  for (let h = 6; h <= 20; h++) {
    const d = new Date(maintenant); d.setDate(d.getDate() + jourDecale); d.setHours(h, 0, 0, 0);
    if (d.getTime() > maintenant.getTime()) res.push(d.getTime());
  }
  const precise = dateDepart(jourDecale, heure, maintenant);
  if (precise && precise > maintenant.getTime() && !res.includes(precise)) res.push(precise);
  return res.sort((a, b) => a - b);
}

async function prevoirVent(page, profil) {
  if (!ed.route || vent.enCours) return;
  const departs = heuresDeDepart(vent.jour, new Date(), ed.heure);
  if (!departs.length) { vent.erreur = 'plus d\'heure de départ possible aujourd\'hui : choisis un autre jour'; afficherVent(page); return; }
  vent.enCours = true; vent.erreur = '';
  afficherVent(page);
  try {
    const L = ed.route.distanceM;
    const pointsMeteo = echantillonner(ed.route.coords, Math.max(500, L / 29));
    // durée la plus longue imaginable : 12 km/h de moyenne
    vent.series = await chargerMeteo(pointsMeteo, departs[0], departs[departs.length - 1] + (L / (12 / 3.6)) * 1000);
    calculerPlan(page);
  } catch (e) {
    vent.erreur = e.message;
  } finally {
    vent.enCours = false;
    afficherVent(page);
  }
}

function calculerPlan(page) {
  const platW = Number(page.querySelector('#puissance-trace')?.value) || PUISSANCE_DEFAUT_W;
  vent.plan = planifier(ed.route.coords, vent.series, heuresDeDepart(vent.jour, new Date(), ed.heure), platW, planPoids + 8);
  // heure choisie par Cyril : c'est elle qu'on montre (3D) ; sinon la meilleure
  const precise = dateDepart(vent.jour, ed.heure);
  vent.choix = vent.plan.heures.some((h) => h.debutMs === precise) ? precise : vent.plan.meilleure.debutMs;
  appliquerCouleursVent();
}
let planPoids = 98;

// Mettre le tracé dans le sens conseillé (même géométrie, parcourue à l'envers)
function mettreDansLeSens(page, profil) {
  ed.points.reverse();
  ed.route = { ...ed.route, coords: [...ed.route.coords].reverse() };
  const series = vent.series;
  dessiner(page, profil);
  vent.series = series;
  calculerPlan(page);
  afficherVent(page);
  toastFn('Tracé mis dans le sens conseillé.');
}

function heureChoisie() {
  return vent.plan?.heures.find((h) => h.debutMs === vent.choix) ?? vent.plan?.meilleure ?? null;
}

function appliquerCouleursVent() {
  if (!vue3d) return;
  const h = heureChoisie();
  if (!vent.couleurs || !h) { vue3d.colorer(null); return; }
  // vent dans l'axe au passage, dans le sens du tracé tel qu'il est dessiné
  const lignes = h.trace.lignes;
  const a = (s) => {
    let i = 0;
    while (i < lignes.length - 1 && lignes[i + 1].distanceM <= s) i++;
    return lignes[i].dos;
  };
  vue3d.colorer((s) => couleurVent(a(s)), CLASSES_VENT.map(([, c, t]) => [c, t]));
}

const signe = (v) => (Math.round(v) > 0 ? `+${Math.round(v)}` : Math.round(v) < 0 ? `−${Math.abs(Math.round(v))}` : '0');

// Températures de l'heure choisie (dans le sens conseillé à cette heure), corrigées de l'altitude
const degres = (t) => `${Math.round(t) === 0 ? 0 : Math.round(t)} °C`;
function blocTemperatures(h) {
  const tp = h?.choix?.temperatures;
  if (!tp) return '';
  const alt = (p) => (p.ele != null ? ` · ${nombre(p.ele)} m` : '');
  const cases = [
    ['Départ', tp.depart, `${fmtHeureCourte(tp.depart.t)}${alt(tp.depart)}`],
    tp.haut ? ['Point haut', tp.haut, `km ${nombre(tp.haut.distanceM / 1000, 1)} · ${fmtHeureCourte(tp.haut.t)}${alt(tp.haut)}`] : null,
    ['Arrivée', tp.arrivee, `${fmtHeureCourte(tp.arrivee.t)}${alt(tp.arrivee)}`],
  ].filter(Boolean);
  const r = tp.ressentiMin;
  const froidRessenti = r && r.ressenti < r.temp - 1
    ? `<p class="aide">Ressenti le plus froid : <b>${degres(r.ressenti)}</b> au km ${nombre(r.distanceM / 1000, 1)}${r.descente ? ', dans une descente' : ''} (${degres(r.temp)} avec la vitesse et le vent de face).</p>`
    : '';
  return `<div class="vent-temperatures">
      <p class="vent-temp-titre">Températures à ${fmtHeureCourte(h.debutMs)}${h.sens === 'inverse' ? ' (sens inverse)' : ''}</p>
      <div class="temp-cases">${cases.map(([nom, p, detail]) => `<div><span class="stat-label">${nom}</span><span class="temp-val">${degres(p.temp)}</span><small>${detail}</small></div>`).join('')}</div>
      ${froidRessenti}
    </div>`;
}

// Jour : lever, coucher, marge au retour ; avertissement si départ ou retour de nuit
function texteJour(h) {
  if (!h?.jour) return '';
  const { leverMs, coucherMs } = h.jour;
  const marge = (coucherMs - h.choix.finMs) / 1000;
  const etat = h.avantLever ? `<b class="alerte">départ avant le lever du soleil</b>`
    : h.apresCoucher ? `<b class="alerte">retour après la nuit tombée</b> (vers ${fmtHeureCourte(h.choix.finMs)})`
      : `retour vers ${fmtHeureCourte(h.choix.finMs)}, ${duree(marge)} avant la nuit`;
  return `☀ Lever ${fmtHeureCourte(leverMs)} · coucher ${fmtHeureCourte(coucherMs)} : ${etat}.`;
}

// Pluie : risque (probabilité), quand et où, et la plus forte prévue (mm sur l'heure)
function textePluie(c) {
  const r = risquePluie(c.pluieMax);
  const ou = c.pluieMax >= 20 && c.pluieQuand ? `, vers ${fmtHeureCourte(c.pluieQuand.t)} au km ${nombre(c.pluieQuand.distanceM / 1000, 0)}` : '';
  const mm = c.mmMax >= 0.1 ? `, jusqu'à ${nombre(c.mmMax, 1)} mm sur l'heure` : '';
  return `🌧 Pluie : risque <b class="pluie-${r}">${r}</b> (${Math.round(c.pluieMax)} % au plus${ou}${mm}).`;
}

function afficherVent(page) {
  const bloc = page.querySelector('#vent-resultat');
  if (!bloc) return;
  const caseCouleurs = page.querySelector('#couleurs-vent');
  caseCouleurs.disabled = !vent.plan;
  if (vent.enCours) { bloc.innerHTML = '<p class="progression">Prévisions météo…</p>'; return; }
  if (vent.erreur) { bloc.innerHTML = `<p class="aide erreur">Prévision impossible : ${echapper(vent.erreur)}.</p>`; return; }
  if (!vent.plan) { bloc.innerHTML = '<p class="aide">Choisis le jour puis « Prévoir » : l\'appli compare chaque heure de départ et les deux sens du tracé.</p>'; return; }
  const m = vent.plan.meilleure;
  const c = m.choix;
  const sensTexte = m.sens === 'trace' ? 'dans le sens du tracé' : 'dans le sens inverse';
  const choisie = heureChoisie();
  bloc.innerHTML = `
    <div class="vent-conseil">
      ${choisie && choisie !== m && choisie.debutMs === dateDepart(vent.jour, ed.heure) ? `<p>À ${fmtHeureCourte(choisie.debutMs)} (ton heure) : ${duree(choisie.choix.dureeS)}, ${choisie.sens === 'trace' ? 'dans le sens du tracé' : 'dans le sens inverse'}, vent ${signe(choisie.choix.dosFin)} km/h sur la fin${choisie.nuit ? ` — <b class="alerte">${choisie.avantLever ? 'départ avant le lever du soleil' : 'retour après la nuit tombée'}</b>` : ''}${choisie.choix.pluieMax >= SEUIL_PLUIE_PCT ? ` — <b class="alerte">pluie probable (${Math.round(choisie.choix.pluieMax)} %)</b>` : ''}.</p>` : ''}
      ${vent.plan.aucuneDeJour ? `<p class="aide erreur">Aucun départ proposé ne permet de partir après le lever du soleil et de rentrer avant la nuit : la sortie dure environ ${duree(c.dureeS)}. Raccourcis le tracé, ou prévois un éclairage.</p>` : ''}
      <p><b>Pars à ${fmtHeureCourte(m.debutMs)}, ${sensTexte}</b> : ${duree(c.dureeS)} avec le vent prévu,
        vent ${c.dosFin >= 0 ? 'dans le dos' : 'de face'} sur la fin (${signe(c.dosFin)} km/h).</p>
      <p class="aide">${texteJour(m)}</p>
      <p class="aide">${textePluie(c)}</p>
      <p class="aide">Vent moyen ${Math.round(c.ventMoy)} km/h du ${pointCardinal(c.ventDe)} · ${Math.round(c.tempMin)} à ${Math.round(c.tempMax)} °C.</p>
      ${m.sens === 'inverse' ? '<button class="btn secondaire petit" type="button" data-a="sens-vent">⇄ Mettre le tracé dans ce sens</button>' : ''}
      ${blocTemperatures(choisie ?? m)}
    </div>
    <div class="tableau-defile"><table class="tours vent-tableau">
      <thead><tr><th>Départ</th><th>Sens</th><th>Durée</th><th>Vent fin</th><th>Pluie</th><th>°C</th></tr></thead>
      <tbody>${vent.plan.heures.map((h) => `
        <tr data-heure="${h.debutMs}" class="${h === m ? 'meilleure' : ''}${h === choisie ? ' choisie' : ''}${h.debutMs === dateDepart(vent.jour, ed.heure) ? ' perso' : ''}${h.nuit ? ' nuit' : ''}"${h.nuit ? ` title="${h.avantLever ? 'Départ avant le lever du soleil' : 'Retour après la nuit tombée'}"` : ''}>
          <td>${fmtHeureCourte(h.debutMs)}${h.nuit ? ' 🌙' : ''}</td><td>${h.sens === 'trace' ? 'tracé' : 'inverse ⇄'}</td><td>${duree(h.choix.dureeS)}</td>
          <td><span class="pastille-vent" style="background:${couleurVent(h.choix.dosFin)}"></span>${signe(h.choix.dosFin)}</td>
          <td class="pluie-${risquePluie(h.choix.pluieMax)}">${Math.round(h.choix.pluieMax)} %</td><td>${Math.round(h.choix.tempMin)}–${Math.round(h.choix.tempMax)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="bloc-note">🌙 : départ avant le lever du soleil ou retour après son coucher (heures calculées au départ du tracé) ; ces heures ne sont jamais conseillées s'il en reste une de jour. Pluie : probabilité au moment de ton passage, faible sous 20 %, probable dès 50 % (heure écartée du conseil). Touche une heure pour voir son vent et ses températures. Températures au moment de ton passage, corrigées de l'altitude du tracé (6,5 °C de moins par 1 000 m entre les points de prévision) ; ressenti avec ta vitesse et le vent de face (formule du refroidissement éolien, à 10 °C et moins).</p>`;
}

async function enregistrer(page, profil) {
  if (!ed.route || ed.points.length < 2) { toastFn('Place au moins deux points.'); return; }
  const nom = ed.nom.trim();
  if (!nom) { toastFn('Donne un nom au tracé.'); page.querySelector('#nom-trace').focus(); return; }
  const dn = denivele(ed.route.coords);
  const t = {
    id: ed.id ?? `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    nom, profil: ed.profil, points: ed.points, coords: ed.route.coords, importe: !!ed.importe,
    distanceM: ed.route.distanceM, denivelePosM: ed.route.denivelePosM ?? (dn.avecAltitude ? dn.plus : null),
    departMs: dateDepart(vent.jour, ed.heure), modifieLe: Date.now(),
  };
  await enregistrerTrace(t);
  ed.id = t.id;
  toastFn(`Tracé « ${nom} » enregistré.`);
  await afficherListe(page, profil);
}

async function exporter(partager) {
  if (!ed.route || ed.points.length < 2) { toastFn('Place au moins deux points.'); return; }
  const nom = ed.nom.trim() || 'Parcours';
  const fichier = new File([gpxDepuisTrace(nom, ed.route.coords, { departMs: dateDepart(vent.jour, ed.heure) })], nomFichierGpx(nom), { type: 'application/gpx+xml' });
  if (partager && navigator.canShare?.({ files: [fichier] })) {
    try { await navigator.share({ files: [fichier], title: nom }); } catch (e) { if (e.name !== 'AbortError') toastFn(`Partage impossible : ${e.message}`); }
    return;
  }
  telecharger(fichier, fichier.name);
  toastFn(`${fichier.name} enregistré dans Téléchargements.`);
}

// Bibliothèque : GPX existants (d'un ami, d'un site, d'une autre appli) enregistrés comme tracés
async function importerGpx(fichiers) {
  const ids = [];
  const erreurs = [];
  for (const f of fichiers) {
    try {
      const g = lireGpxParcours(await f.text());
      const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const nom = g.nom || f.name.replace(/\.gpx$/i, '').replace(/[-_]+/g, ' ').trim() || 'Tracé importé';
      const pt = (c) => [c[0], c[1]];
      await enregistrerTrace({
        id, nom, profil: ed.profil, importe: true,
        points: [pt(g.coords[0]), pt(g.coords[g.coords.length - 1])], coords: g.coords,
        distanceM: g.distanceM, denivelePosM: g.denivelePosM, departMs: null, modifieLe: Date.now(),
      });
      ids.push(id);
    } catch (err) {
      erreurs.push(`${f.name} : ${err.message}`);
    }
  }
  if (ids.length) toastFn(`${ids.length} tracé${ids.length > 1 ? 's' : ''} importé${ids.length > 1 ? 's' : ''}.${erreurs.length ? ` Pas lu : ${erreurs.join(' ; ')}.` : ''}`);
  else if (erreurs.length) toastFn(`GPX illisible : ${erreurs.join(' ; ')}.`);
  return ids;
}

async function afficherListe(page, profil) {
  const bloc = page.querySelector('#mes-traces');
  const index = await lireIndexTraces();
  // tracés enregistrés avant les aperçus : aperçu calculé une fois et gardé dans l'index
  let complete = false;
  for (const t of index) {
    if (t.apercu) continue;
    t.apercu = apercuTrace((await lireTrace(t.id))?.coords);
    complete = true;
  }
  if (complete) await ecrireReglage('traces', index);
  bloc.innerHTML = `<div class="mes-traces-tete"><h2 class="bloc-titre">Mes tracés</h2>
      <label class="btn secondaire petit">Importer un GPX<input type="file" id="importer-gpx" accept=".gpx,application/gpx+xml" multiple hidden></label></div>
    ${index.length ? `<div class="traces-liste">${index.map((t) => `
      <div class="trace-carte" data-id="${t.id}">
        <div class="trace-ligne">
          <span class="passage-nom">${echapper(t.nom)}<small>${km(t.distanceM)} km${t.denivelePosM != null ? ` · ${nombre(t.denivelePosM)} m D+` : ''} · ${t.departMs ? `départ prévu ${fmtDate.format(t.departMs)} à ${fmtHeureCourte(t.departMs)}` : fmtDate.format(t.modifieLe)}</small></span>
          <span class="trace-actions">
            <button class="btn secondaire petit" type="button" data-t="ouvrir">Ouvrir</button>
            <button class="btn secondaire petit" type="button" data-t="gpx" aria-label="Exporter le GPX">GPX</button>
            <button class="btn secondaire petit danger" type="button" data-t="supprimer" aria-label="Supprimer">✕</button>
          </span>
        </div>
        ${t.apercu?.length > 1 ? `<button class="trace-apercu" type="button" data-t="ouvrir" aria-label="Ouvrir le tracé ${echapper(t.nom)}">${htmlCarteStatique(t.apercu, { hauteur: 150 })}</button>` : ''}
      </div>`).join('')}</div>` : '<p class="aide">Aucun tracé enregistré pour l\'instant.</p>'}`;
  bloc.querySelector('#importer-gpx').onchange = async (e) => {
    const fichiers = [...e.target.files];
    e.target.value = '';
    const ids = await importerGpx(fichiers);
    if (!ids.length) return;
    await afficherListe(page, profil);
    bloc.querySelector(`[data-id="${ids[0]}"] [data-t="ouvrir"]`)?.click();
  };
  bloc.onclick = async (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    if (b.dataset.t === 'ouvrir') {
      await ouvrir(id);
      page.querySelector('#nom-trace').value = ed.nom;
      page.querySelector('#heure-depart').value = ed.heure;
      page.querySelector('#jour-vent').value = String(vent.jour);
      page.querySelector('#profil-route').value = ed.profil;
      dessiner(page, profil);
      if (carte && ed.route) carte.fitBounds(globalThis.L.latLngBounds(ed.route.coords.map((c) => [c[0], c[1]])), { padding: [24, 24], animate: false });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (b.dataset.t === 'gpx') {
      const t = await lireTrace(id);
      telecharger(new Blob([gpxDepuisTrace(t.nom, t.coords, { departMs: t.departMs })], { type: 'application/gpx+xml' }), nomFichierGpx(t.nom));
    } else if (b.dataset.t === 'supprimer') {
      const t = (await lireIndexTraces()).find((x) => x.id === id);
      if (!confirm(`Supprimer le tracé « ${t?.nom} » ?`)) return;
      await supprimerTrace(id);
      if (ed.id === id) ed.id = null;
      await afficherListe(page, profil);
    }
  };
}
