// Onglet « Tracés » : créer un parcours sur la carte (calcul de route vélo
// BRouter), voir son profil et sa 3D, l'enregistrer, l'exporter en GPX.
import { lireReglage, ecrireReglage, toutesLesSorties } from './db.js';
import { lireProfil } from './profil.js';
import {
  PROFILS, calculerRoute, denivele, tempsEstimeS, gpxDepuisTrace, nomFichierGpx, distanceM,
} from './routage.js';
import { creerVue3d, construireTrace, GCOL } from './vue3d.js';
import { telecharger } from './sauvegarde.js';
import { nombre, km, duree, echapper, fmtDate } from './format.js';

const CENTRE_DEFAUT = [45.188, 5.725]; // Grenoble
const PUISSANCE_DEFAUT_W = 150; // comme le temps estimé de Parcours 3D

// Tracé en cours (gardé quand on change d'onglet)
const ed = { id: null, nom: '', profil: 'fastbike', points: [], route: null, calcul: 0, erreur: '' };
let carte = null;
let couches = null;
let vue3d = null;
let toastFn = () => {};

export function fermerTraces() {
  if (vue3d) { vue3d.detruire(); vue3d = null; }
  if (carte) { retirerCarte(carte); carte = null; couches = null; }
}

// Retire une carte Leaflet ; si un zoom animé est en cours, à la fin du zoom
// (sinon Leaflet plante en terminant son animation sur une carte retirée)
export function retirerCarte(c) {
  if (c._animatingZoom) c.once('zoomend', () => c.remove());
  else c.remove();
}

// ---- Stockage : index « traces » + un réglage « trace:<id> » par tracé ----------

export async function lireIndexTraces() { return (await lireReglage('traces')) ?? []; }
export async function lireTrace(id) { return lireReglage(`trace:${id}`); }

async function enregistrerTrace(t) {
  await ecrireReglage(`trace:${t.id}`, t);
  const index = (await lireIndexTraces()).filter((x) => x.id !== t.id);
  index.unshift({ id: t.id, nom: t.nom, distanceM: t.distanceM, denivelePosM: t.denivelePosM, modifieLe: t.modifieLe });
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
  page.innerHTML = `
  <section class="editeur-trace">
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
    <p class="aide" id="trace-etat"></p>
    <div id="trace-resume"></div>
    <div class="segments vues" role="group" data-segments="vue-trace" hidden>
      <button type="button" data-valeur="profil" aria-pressed="true">Profil</button>
      <button type="button" data-valeur="3d" aria-pressed="false">3D</button>
    </div>
    <div id="trace-profil"></div>
    <div class="vue3d" id="trace-3d" hidden></div>
    <div class="trace-enregistrement">
      <label class="champ-ligne"><span>Nom du tracé</span><input id="nom-trace" type="text" maxlength="60" value="${echapper(ed.nom)}" placeholder="Ex. : boucle du Vercors"></label>
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
  page.querySelector('.editeur-trace').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'annuler') { ed.points.pop(); recalculer(page, profil); }
    else if (a === 'boucle') {
      if (ed.points.length < 2) { toastFn('Place au moins deux points.'); return; }
      ed.points.push([...ed.points[0]]); recalculer(page, profil);
    } else if (a === 'inverser') { ed.points.reverse(); recalculer(page, profil); }
    else if (a === 'effacer') {
      if (ed.points.length && !confirm('Effacer le tracé en cours ?')) return;
      Object.assign(ed, { id: null, nom: '', points: [], route: null, erreur: '' });
      page.querySelector('#nom-trace').value = '';
      dessiner(page, profil);
    } else if (a === 'nouveau') {
      Object.assign(ed, { id: null, nom: '', points: [], route: null, erreur: '' });
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
  Object.assign(ed, { id: t.id, nom: t.nom, profil: t.profil, points: t.points, route: { coords: t.coords, distanceM: t.distanceM, denivelePosM: t.denivelePosM }, erreur: '' });
}

let minuterie = 0;
function recalculer(page, profil) {
  clearTimeout(minuterie);
  dessiner(page, profil, true);
  minuterie = setTimeout(async () => {
    const n = ++ed.calcul;
    if (ed.points.length < 2) { ed.route = null; ed.erreur = ''; dessiner(page, profil); return; }
    try {
      const route = await calculerRoute(ed.points, ed.profil);
      if (n !== ed.calcul) return; // une demande plus récente est partie
      ed.route = route;
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
  else etat.textContent = `${ed.points.length} points · ${PROFILS[ed.profil]}`;
  etat.classList.toggle('erreur', !!ed.erreur && !enCalcul);

  const resume = page.querySelector('#trace-resume');
  const blocProfil = page.querySelector('#trace-profil');
  const boutonsVue = page.querySelector('[data-segments="vue-trace"]');
  if (!ed.route || ed.points.length < 2) {
    resume.innerHTML = ''; blocProfil.innerHTML = ''; boutonsVue.hidden = true;
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
  installerCurseurProfil(page);
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
    vue3d?.afficher(true);
  } else vue3d?.afficher(false);
}

async function enregistrer(page, profil) {
  if (!ed.route || ed.points.length < 2) { toastFn('Place au moins deux points.'); return; }
  const nom = ed.nom.trim();
  if (!nom) { toastFn('Donne un nom au tracé.'); page.querySelector('#nom-trace').focus(); return; }
  const dn = denivele(ed.route.coords);
  const t = {
    id: ed.id ?? `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    nom, profil: ed.profil, points: ed.points, coords: ed.route.coords,
    distanceM: ed.route.distanceM, denivelePosM: ed.route.denivelePosM ?? (dn.avecAltitude ? dn.plus : null),
    modifieLe: Date.now(),
  };
  await enregistrerTrace(t);
  ed.id = t.id;
  toastFn(`Tracé « ${nom} » enregistré.`);
  await afficherListe(page, profil);
}

async function exporter(partager) {
  if (!ed.route || ed.points.length < 2) { toastFn('Place au moins deux points.'); return; }
  const nom = ed.nom.trim() || 'Parcours';
  const fichier = new File([gpxDepuisTrace(nom, ed.route.coords)], nomFichierGpx(nom), { type: 'application/gpx+xml' });
  if (partager && navigator.canShare?.({ files: [fichier] })) {
    try { await navigator.share({ files: [fichier], title: nom }); } catch (e) { if (e.name !== 'AbortError') toastFn(`Partage impossible : ${e.message}`); }
    return;
  }
  telecharger(fichier, fichier.name);
  toastFn(`${fichier.name} enregistré dans Téléchargements.`);
}

async function afficherListe(page, profil) {
  const bloc = page.querySelector('#mes-traces');
  const index = await lireIndexTraces();
  bloc.innerHTML = `<h2 class="bloc-titre">Mes tracés</h2>
    ${index.length ? `<div class="passages">${index.map((t) => `
      <div class="passage trace-ligne" data-id="${t.id}">
        <span class="passage-nom">${echapper(t.nom)}<small>${km(t.distanceM)} km${t.denivelePosM != null ? ` · ${nombre(t.denivelePosM)} m D+` : ''} · ${fmtDate.format(t.modifieLe)}</small></span>
        <span class="trace-actions">
          <button class="btn secondaire petit" type="button" data-t="ouvrir">Ouvrir</button>
          <button class="btn secondaire petit" type="button" data-t="gpx" aria-label="Exporter le GPX">GPX</button>
          <button class="btn secondaire petit danger" type="button" data-t="supprimer" aria-label="Supprimer">✕</button>
        </span></div>`).join('')}</div>` : '<p class="aide">Aucun tracé enregistré pour l\'instant.</p>'}`;
  bloc.onclick = async (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    if (b.dataset.t === 'ouvrir') {
      await ouvrir(id);
      page.querySelector('#nom-trace').value = ed.nom;
      page.querySelector('#profil-route').value = ed.profil;
      dessiner(page, profil);
      if (carte && ed.route) carte.fitBounds(globalThis.L.latLngBounds(ed.route.coords.map((c) => [c[0], c[1]])), { padding: [24, 24], animate: false });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (b.dataset.t === 'gpx') {
      const t = await lireTrace(id);
      telecharger(new Blob([gpxDepuisTrace(t.nom, t.coords)], { type: 'application/gpx+xml' }), nomFichierGpx(t.nom));
    } else if (b.dataset.t === 'supprimer') {
      const t = (await lireIndexTraces()).find((x) => x.id === id);
      if (!confirm(`Supprimer le tracé « ${t?.nom} » ?`)) return;
      await supprimerTrace(id);
      if (ed.id === id) ed.id = null;
      await afficherListe(page, profil);
    }
  };
}
