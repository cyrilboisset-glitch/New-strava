// Page de détail d'une sortie : carte, chiffres, courbes (curseur commun
// avec la carte), meilleurs efforts, zones de puissance et de FC, tours.
import { lireSortie, lireFichier, completerSortie } from './db.js';
import { decoderFichier } from './fichier.js';
import {
  pointsDetail, parSeconde, meilleursEfforts, intervalleTypiqueS, tempsParZone, chargeSortie,
  ZONES_PUISSANCE, ZONES_FC, PART_FTP_20_MIN,
} from './analyse.js';
import { lireProfil, enregistrerEfforts, lireVelos, wKg, resumerEstimation, estimationAJour } from './profil.js';
import { estimationPossible } from './puissance-estimee.js';
import { memeParcoursQue } from './parcours.js';
import { toutesLesSorties } from './db.js';
import { htmlChoixVelo } from './velos.js';
import { familleSortie } from './sortie.js';
import { nombre, km, duree, chrono, echapper, majuscule, fmtJourLong, fmtHeure, fmtDate as fmtDateLongue } from './format.js';
import { creerVue3d, construireTrace, GCOL } from './vue3d.js';
import { retirerCarte } from './carte-statique.js';
import { afficherSegmentsSortie, fermerApercuSegment } from './segments.js';
import { gpxDepuisSortie, nomFichierGpx } from './routage.js';
import { telecharger } from './sauvegarde.js';

const COLONNES_COURBE = 300; // points dessinés par courbe (moyenne par colonne)

// Une courbe par grandeur (une seule série par graphique : pas de légende)
const SERIES = [
  { champ: 'altitudeM', titre: 'Altitude', unite: 'm', dec: 0, couleur: 'var(--altitude)', aire: true, depuisZero: false },
  { champ: 'vitesseMs', titre: 'Vitesse', unite: 'km/h', facteur: 3.6, dec: 1, couleur: 'var(--accent-trait)', depuisZero: true },
  { champ: 'puissanceW', titre: 'Puissance', unite: 'W', dec: 0, couleur: 'var(--puissance)', depuisZero: true },
  { champ: 'puissanceEstimeeW', titre: 'Puissance estimée', unite: 'W', dec: 0, couleur: 'var(--puissance)', depuisZero: true, estimee: true },
  { champ: 'fc', titre: 'Fréquence cardiaque', unite: 'bpm', dec: 0, couleur: 'var(--cardio)', depuisZero: false },
  { champ: 'cadence', titre: 'Cadence', unite: 'tr/min', dec: 0, couleur: 'var(--texte-2)', depuisZero: true },
];

const NOMS_EFFORTS = { 5: '5 s', 60: '1 min', 300: '5 min', 1200: '20 min', 3600: '1 h' };

let carte = null; // carte Leaflet affichée (à libérer en quittant la page)
let vue3d = null; // vue 3D (boucle d'affichage à arrêter en quittant la page)
let modeVue = 'carte'; // 'carte' ou '3d', gardé d'une sortie à l'autre
let indexCurseur = null; // point de la sortie sous le curseur des courbes (création de segment)

export function fermerDetail() {
  if (carte) { retirerCarte(carte); carte = null; }
  if (vue3d) { vue3d.detruire(); vue3d = null; }
  fermerApercuSegment();
  indexCurseur = null;
}

const valeur = (v, unite, dec = 0) => (v == null ? null : `${nombre(v, dec)} ${unite}`);

// ---- Chiffres ----------------------------------------------------------------

function grilleChiffres(s, charge, pts, estimee = false) {
  const lignes = [];
  const ajout = (nom, val) => { if (val != null && val !== '') lignes.push(`<div class="detail"><dt>${nom}</dt><dd>${val}</dd></div>`); };
  const vitesses = pts.map((p) => p.vitesseMs).filter((v) => typeof v === 'number');
  ajout('Vitesse moyenne', s.vitesseMoyMs != null ? valeur(s.vitesseMoyMs * 3.6, 'km/h', 1) : null);
  ajout('Vitesse max', vitesses.length ? valeur(Math.max(...vitesses) * 3.6, 'km/h', 1) : null);
  ajout('Temps en mouvement', s.dureeChronoS != null ? chrono(s.dureeChronoS) : null);
  ajout('Temps total', s.dureeTotaleS != null ? chrono(s.dureeTotaleS) : null);
  ajout('Puissance moyenne', valeur(s.puissanceMoyW, 'W'));
  ajout('Puissance normalisée', valeur(s.puissanceNormW, 'W'));
  if (estimee && s.puissanceEstimee) {
    ajout('Puissance moy. estimée', `≈ ${s.puissanceEstimee.moyW} W`);
    ajout('NP estimée', `≈ ${s.puissanceEstimee.normW} W`);
  }
  ajout('Puissance max', valeur(s.puissanceMaxW, 'W'));
  ajout("Facteur d'intensité", charge.facteurIntensite != null ? nombre(charge.facteurIntensite, 2) : null);
  ajout('TSS', charge.tss != null ? nombre(charge.tss) : null);
  ajout('FC moyenne', valeur(s.fcMoy, 'bpm'));
  ajout('FC max', valeur(s.fcMax, 'bpm'));
  ajout('Cadence moyenne', valeur(s.cadenceMoy, 'tr/min'));
  ajout('Calories', s.calories != null ? valeur(s.calories, 'kcal') : null);
  ajout('Température moy.', valeur(s.temperatureMoy, '°C'));
  return lignes.length ? `<dl class="sortie-details detail-grille">${lignes.join('')}</dl>` : '';
}

// ---- Courbes -------------------------------------------------------------------

// Axe horizontal : distance si la sortie a bougé, sinon temps
function axeX(pts) {
  const distTotale = pts.length ? pts[pts.length - 1].distanceM : 0;
  if (distTotale > 500) return { x: pts.map((p) => p.distanceM), texte: (v) => `${km(v)} km`, enDistance: true };
  return { x: pts.map((p) => p.tS), texte: (v) => chrono(v), enDistance: false };
}

function seriePresente(pts, serie) {
  const n = pts.filter((p) => typeof p[serie.champ] === 'number' && (serie.champ === 'altitudeM' || p[serie.champ] > 0)).length;
  return n >= Math.max(2, pts.length * 0.1);
}

function courbeSvg(pts, xs, serie) {
  const x0 = xs[0];
  const etendue = xs[xs.length - 1] - x0 || 1;
  const colonnes = Array.from({ length: COLONNES_COURBE }, () => ({ somme: 0, n: 0 }));
  pts.forEach((p, i) => {
    const v = p[serie.champ];
    if (typeof v !== 'number') return;
    const c = Math.min(COLONNES_COURBE - 1, Math.floor(((xs[i] - x0) / etendue) * COLONNES_COURBE));
    colonnes[c].somme += v * (serie.facteur ?? 1);
    colonnes[c].n++;
  });
  const ys = colonnes.map((c) => (c.n ? c.somme / c.n : null));
  // Colonnes vides entre deux points (enregistrement toutes les 8 s à vive
  // allure) : valeur interpolée si le trou fait au plus 6 colonnes
  for (let c = 1; c < ys.length; c++) {
    if (ys[c] !== null || ys[c - 1] === null) continue;
    let f = c;
    while (f < ys.length && ys[f] === null) f++;
    if (f < ys.length && f - c <= 6) {
      for (let k = c; k < f; k++) ys[k] = ys[c - 1] + ((ys[f] - ys[c - 1]) * (k - c + 1)) / (f - c + 1);
    }
    c = f;
  }
  const presents = ys.filter((v) => v !== null);
  let bas = serie.depuisZero ? 0 : Math.min(...presents);
  let haut = Math.max(...presents);
  if (haut - bas < 1e-9) { haut += 1; bas = serie.depuisZero ? 0 : bas - 1; }
  const marge = (haut - bas) * 0.08;
  const yHaut = haut + marge;
  const yBas = serie.depuisZero ? 0 : bas - marge;
  const y = (v) => (100 * (yHaut - v)) / (yHaut - yBas);
  let d = '';
  let dansTrait = false;
  ys.forEach((v, c) => {
    if (v === null) { dansTrait = false; return; }
    d += `${dansTrait ? 'L' : 'M'}${(c + 0.5).toFixed(1)} ${y(v).toFixed(2)}`;
    dansTrait = true;
  });
  const premier = ys.findIndex((v) => v !== null);
  const dernier = ys.length - 1 - [...ys].reverse().findIndex((v) => v !== null);
  let aire = serie.aire && !ys.slice(premier, dernier + 1).includes(null)
    ? `<path class="courbe-aire" d="${d} L${(dernier + 0.5).toFixed(1)} 100 L${(premier + 0.5).toFixed(1)} 100 Z" style="fill:${serie.couleur}"/>`
    : '';
  if (serie.aire && serie.pentes && aire) {
    // une colonne par point dessiné, couleur de la pente (sur ± 1 colonne)
    const largeurM = etendue / COLONNES_COURBE;
    aire = ys.map((v, c) => {
      if (v === null) return '';
      const a = ys[Math.max(premier, c - 1)] ?? v;
      const b = ys[Math.min(dernier, c + 1)] ?? v;
      const n = Math.min(dernier, c + 1) - Math.max(premier, c - 1);
      const pente = n ? ((b - a) / (n * largeurM)) * 100 : 0;
      return `<rect x="${c}" y="${y(v).toFixed(2)}" width="1.02" height="${(100 - y(v)).toFixed(2)}" fill="${GCOL(pente)}"/>`;
    }).join('');
    aire = `<g class="courbe-pentes">${aire}</g>`;
  }
  return {
    svg: `<svg class="courbe-svg" viewBox="0 0 ${COLONNES_COURBE} 100" preserveAspectRatio="none" aria-hidden="true">${aire}<path class="courbe-trait" d="${d}" style="stroke:${serie.couleur}"/></svg>`,
    haut, bas,
  };
}

function moyenneSerie(pts, serie) {
  const sec = parSeconde(pts, serie.champ).filter((v) => serie.champ === 'altitudeM' || v > 0);
  return sec.length ? (sec.reduce((a, v) => a + v, 0) / sec.length) * (serie.facteur ?? 1) : null;
}

function blocCourbes(pts, axe) {
  const series = SERIES.filter((s) => seriePresente(pts, s));
  if (!series.length || pts.length < 2) return { html: '', series };
  const html = series.map((serie) => {
    const { svg, haut, bas } = courbeSvg(pts, axe.x, { ...serie, pentes: axe.enDistance });
    const moy = serie.champ === 'altitudeM' ? null : moyenneSerie(pts, serie);
    const defaut = moy != null ? `moy. ${nombre(moy, serie.dec)} ${serie.unite}` : '';
    return `
    <div class="courbe" data-champ="${serie.champ}">
      <div class="courbe-tete">
        <h3 class="courbe-titre"><span class="puce" style="background:${serie.couleur}"></span>${serie.titre}</h3>
        <span class="courbe-valeur" data-defaut="${defaut}">${defaut}</span>
      </div>
      <div class="courbe-zone">
        ${svg}
        <span class="courbe-axe haut">${nombre(haut, serie.dec)}</span>
        <span class="courbe-axe bas">${nombre(serie.depuisZero ? 0 : bas, serie.dec)}</span>
        <span class="curseur" hidden></span>
      </div>
    </div>`;
  }).join('');
  const xs = axe.x;
  const milieu = xs[0] + (xs[xs.length - 1] - xs[0]) / 2;
  return {
    series,
    html: `
    <section class="carte bloc courbes" aria-label="Courbes">
      <p class="courbes-position" aria-live="off">Touchez une courbe pour lire les valeurs</p>
      ${html}
      <div class="courbes-x"><span>${axe.texte(xs[0])}</span><span>${axe.texte(milieu)}</span><span>${axe.texte(xs[xs.length - 1])}</span></div>
    </section>`,
  };
}

function plusProche(xs, v) {
  let a = 0;
  let b = xs.length - 1;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (xs[m] < v) a = m; else b = m;
  }
  return Math.abs(xs[a] - v) <= Math.abs(xs[b] - v) ? a : b;
}

// Curseur commun : le doigt (ou la souris) sur une courbe place un trait
// sur toutes les courbes, affiche les valeurs et le point sur la carte.
function installerCurseur(page, pts, axe, series, marqueur, vers3d) {
  const bloc = page.querySelector('.courbes');
  if (!bloc) return null;
  const xs = axe.x;
  const x0 = xs[0];
  const etendue = xs[xs.length - 1] - x0 || 1;
  const position = bloc.querySelector('.courbes-position');
  const courbes = [...bloc.querySelectorAll('.courbe')];

  const placer = (clientX, zone) => {
    const r = zone.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const i = plusProche(xs, x0 + f * etendue);
    placerIndex(i);
    vers3d?.(i);
  };
  const placerIndex = (i) => {
    indexCurseur = i;
    const p = pts[i];
    const gauche = `${(((xs[i] - x0) / etendue) * 100).toFixed(2)}%`;
    courbes.forEach((c, k) => {
      const serie = series[k];
      const curseur = c.querySelector('.curseur');
      curseur.hidden = false;
      curseur.style.left = gauche;
      const v = p[serie.champ];
      c.querySelector('.courbe-valeur').textContent = typeof v === 'number' ? `${nombre(v * (serie.facteur ?? 1), serie.dec)} ${serie.unite}` : '–';
    });
    position.textContent = `${km(p.distanceM)} km · ${chrono(p.tS)}`;
    if (marqueur && typeof p.lat === 'number') {
      marqueur.setLatLng([p.lat, p.lon]);
      marqueur.setStyle({ opacity: 1, fillOpacity: 1 });
    }
  };
  const effacer = () => {
    courbes.forEach((c) => {
      c.querySelector('.curseur').hidden = true;
      const val = c.querySelector('.courbe-valeur');
      val.textContent = val.dataset.defaut;
    });
    position.textContent = 'Touchez une courbe pour lire les valeurs';
    if (marqueur) marqueur.setStyle({ opacity: 0, fillOpacity: 0 });
  };
  for (const c of courbes) {
    const zone = c.querySelector('.courbe-zone');
    zone.addEventListener('pointerdown', (e) => placer(e.clientX, zone));
    zone.addEventListener('pointermove', (e) => placer(e.clientX, zone));
    zone.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { effacer(); vers3d?.(null); } });
  }
  return { placerIndex };
}

// ---- Carte -----------------------------------------------------------------------

function creerCarte(div, pts) {
  const L = globalThis.L;
  const gps = pts.filter((p) => typeof p.lat === 'number');
  if (!L || gps.length < 2) return null;
  const style = getComputedStyle(document.documentElement);
  const trait = style.getPropertyValue('--trace-carte').trim() || '#e4572e';
  const pas = Math.max(1, Math.ceil(gps.length / 3000));
  const ligne = gps.filter((_, i) => i % pas === 0 || i === gps.length - 1).map((p) => [p.lat, p.lon]);
  carte = L.map(div, { scrollWheelZoom: false, attributionControl: true });
  carte.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  // Fond de carte OpenStreetMap : chargé depuis internet, seules les tuiles
  // de la zone affichée sont demandées (les sorties restent sur le téléphone)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(carte);
  const poly = L.polyline(ligne, { color: trait, weight: 4, opacity: 0.95 }).addTo(carte);
  L.circleMarker(ligne[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#2e9e4f', fillOpacity: 1 }).addTo(carte).bindTooltip('Départ');
  L.circleMarker(ligne[ligne.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#15171b', fillOpacity: 1 }).addTo(carte).bindTooltip('Arrivée');
  carte.fitBounds(poly.getBounds(), { padding: [16, 16] });
  return L.circleMarker(ligne[0], { radius: 7, color: '#fff', weight: 2, fillColor: trait, fillOpacity: 0, opacity: 0 }).addTo(carte);
}

// ---- Efforts et zones ---------------------------------------------------------------

function blocEfforts(efforts, intervalleS, poidsKg) {
  const lignes = Object.entries(NOMS_EFFORTS).filter(([d]) => efforts[d]);
  if (!lignes.length) return '';
  const p20 = efforts[1200];
  const note = [
    intervalleS > 2 ? `Enregistrement environ toutes les ${intervalleS} s : les efforts courts (5 s, 1 min) sont approximatifs.` : '',
    p20 ? `Sur cette sortie, 95 % du meilleur 20 min donnent ${nombre(Math.round(p20 * PART_FTP_20_MIN))} W (estimation de FTP valable seulement si ces 20 min étaient à fond).` : '',
  ].filter(Boolean).join(' ');
  return `
  <section class="carte bloc">
    <h2 class="bloc-titre">Meilleurs efforts</h2>
    <div class="efforts">
      ${lignes.map(([d, nomDuree]) => `<div class="effort-case"><span class="effort-duree">${nomDuree}</span><span class="effort-w">${nombre(efforts[d])}<small>W</small></span>${poidsKg ? `<span class="effort-wkg">${wKg(efforts[d], poidsKg)} W/kg</span>` : ''}</div>`).join('')}
    </div>
    ${note ? `<p class="bloc-note">${note}</p>` : ''}
  </section>`;
}

function blocZones(titre, zones, unite, couleur, note) {
  const total = zones.reduce((a, z) => a + z.secondes, 0);
  if (!total) return '';
  const maxPart = Math.max(...zones.map((z) => z.secondes / total));
  const lignes = zones.map((z, i) => {
    const part = z.secondes / total;
    const plage = Number.isFinite(z.maxV) ? (z.minV ? `${z.minV}–${z.maxV} ${unite}` : `≤ ${z.maxV} ${unite}`) : `> ${z.minV - 1} ${unite}`;
    // Une seule teinte, de plus en plus soutenue avec l'intensité
    const teinte = `color-mix(in srgb, ${couleur} ${Math.round(35 + (65 * i) / (zones.length - 1))}%, var(--surface-2))`;
    return `
    <div class="zone">
      <div class="zone-nom"><b>${z.nom}</b> ${z.libelle}<span class="zone-plage">${plage}</span></div>
      <div class="zone-barre"><span style="width:${part ? Math.max(1, (part / maxPart) * 100).toFixed(1) : 0}%;background:${teinte}"></span></div>
      <div class="zone-temps">${duree(z.secondes)}<small>${nombre(part * 100)} %</small></div>
    </div>`;
  }).join('');
  return `
  <section class="carte bloc">
    <h2 class="bloc-titre">${titre}</h2>
    <div class="zones">${lignes}</div>
    ${note ? `<p class="bloc-note">${note}</p>` : ''}
  </section>`;
}

function blocTours(tours) {
  if (tours.length < 2) return '';
  const lignes = tours.map((t, i) => `
    <tr><td>${i + 1}</td><td>${t.distanceM != null ? km(t.distanceM) : '–'}</td><td>${t.dureeChronoS != null ? chrono(t.dureeChronoS) : '–'}</td>
    <td>${t.vitesseMoyMs != null ? nombre(t.vitesseMoyMs * 3.6, 1) : '–'}</td><td>${t.puissanceMoyW ?? '–'}</td><td>${t.fcMoy ?? '–'}</td></tr>`).join('');
  return `
  <section class="carte bloc">
    <h2 class="bloc-titre">Tours</h2>
    <div class="tableau-defile"><table class="tours">
      <thead><tr><th>Tour</th><th>km</th><th>Durée</th><th>km/h</th><th>W</th><th>bpm</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table></div>
  </section>`;
}

// ---- Même parcours ------------------------------------------------------------------

function htmlMemeParcours(s, groupe) {
  const rang = groupe.findIndex((x) => x.id === s.id) + 1;
  const lignes = groupe.map((x, k) => {
    const w = x.puissanceNormW ? `${x.puissanceNormW} W NP` : x.puissanceEstimee?.normW ? `≈ ${x.puissanceEstimee.normW} W NP` : '';
    const mesures = [x.vitesseMoyMs ? `${nombre(x.vitesseMoyMs * 3.6, 1)} km/h` : '', w, x.fcMoy ? `${x.fcMoy} bpm` : ''].filter(Boolean).join(' · ');
    const etiquette = k === 0 ? '<span class="rang or">🏆 Meilleur temps</span>' : `<span class="rang${k > 2 ? ' discret' : ''}">${k + 1}e</span>`;
    return `<a class="passage${x.id === s.id ? ' actuelle' : ''}" href="#sortie=${encodeURIComponent(x.id)}">
      <span class="passage-nom">${fmtDateLongue.format(x.debut)}<small>${x.id === s.id ? 'Cette sortie' : echapper(x.nom || x.nomSport)}</small></span>
      <span class="passage-temps">${chrono(x.dureeChronoS ?? 0)}${etiquette}</span>
      <span class="passage-mesures">${mesures}</span></a>`;
  }).join('');
  return `<h2 class="bloc-titre">Même parcours</h2>
    <p class="parcours-resume">Fait <b>${groupe.length} fois</b> · cette sortie : <b>${rang === 1 ? 'meilleur temps' : `${rang}e sur ${groupe.length}`}</b></p>
    <div class="passages">${lignes}</div>
    <p class="bloc-note">Sorties reconnues automatiquement : même départ, même arrivée, même tracé (à 150 m près), distance à 6 % près. Classement au temps en mouvement.</p>`;
}

// ---- Page ----------------------------------------------------------------------------

/** Remplit `page` avec le détail de la sortie `id`. */
export async function afficherDetail(page, id, toast = () => {}) {
  fermerDetail();
  const s = await lireSortie(id);
  if (!s) {
    page.innerHTML = '<section class="carte"><p>Sortie introuvable.</p></section>';
    return null;
  }
  const profil = await lireProfil();
  const velos = await lireVelos();
  const fichier = await lireFichier(id);
  let pts = [];
  let tours = [];
  let erreur = null;
  if (fichier) {
    try {
      const d = await decoderFichier(fichier);
      pts = pointsDetail(d.records);
      tours = d.tours;
    } catch (e) {
      erreur = e.message;
      console.warn('Fichier illisible', id, e);
    }
  }
  // Pas de capteur de puissance : estimation (vitesse, pente, poids), gardée dans la sortie
  const puissanceReelle = pts.some((p) => p.puissanceW > 0);
  let estimee = false;
  if (!puissanceReelle && estimationPossible(s) && pts.length > 1) {
    const est = resumerEstimation(pts, profil.poidsKg);
    if (est) {
      estimee = true;
      if (!estimationAJour(s, profil.poidsKg) || s.puissanceEstimee.normW !== est.normW) {
        s.puissanceEstimee = est;
        completerSortie(s.id, () => ({ puissanceEstimee: est })).catch(() => {});
      }
    }
  }
  const charge = chargeSortie(s, profil.ftpW);
  const axe = axeX(pts);
  const avecGps = pts.filter((p) => typeof p.lat === 'number').length >= 2;
  const puissance = puissanceReelle ? parSeconde(pts, 'puissanceW') : estimee ? parSeconde(pts, 'puissanceEstimeeW') : [];
  const efforts = puissanceReelle ? meilleursEfforts(puissance) : {};
  const fcSec = parSeconde(pts, 'fc').filter((v) => v > 0);
  const intervalleS = intervalleTypiqueS(pts);
  const courbes = blocCourbes(pts, axe);
  const d = new Date(s.debut);

  const zonesP = puissance.length && profil.ftpW
    ? blocZones(estimee ? 'Zones de puissance (estimée)' : 'Zones de puissance', tempsParZone(puissance, ZONES_PUISSANCE, profil.ftpW), 'W', 'var(--puissance)',
      `Avec ta FTP de ${profil.ftpW} W (à changer dans Réglages). Roue libre comprise dans Z1.${estimee ? ' Puissance estimée : à prendre comme un ordre de grandeur.' : ''}`)
    : '';
  const zonesFc = fcSec.length && profil.fcMaxBpm
    ? blocZones('Zones de fréquence cardiaque', tempsParZone(fcSec, ZONES_FC, profil.fcMaxBpm), 'bpm', 'var(--cardio)',
      `En part de ta FC max de ${profil.fcMaxBpm} bpm${profil.fcMaxReglee ? '' : ' (la plus haute relevée dans tes sorties ; à régler dans Réglages)'}.`)
    : '';

  const notes = [
    charge.source === 'compteur' ? `IF et TSS calculés par le compteur avec une FTP de ${s.ftpCompteurW} W.` : '',
    charge.source === 'appli' ? `IF et TSS calculés par l'appli avec ta FTP de ${profil.ftpW} W.` : '',
    estimee ? `Pas de capteur de puissance : puissance estimée avec la vitesse, la pente et ta masse (${profil.poidsKg} kg + 8 kg de vélo, CdA 0,32, Crr 0,004), sans vent. Écart possible d'environ 20 % ; pas comptée dans les records.` : '',
    s.sansTrace ? 'Sans trace (saisie à la main sur Strava ou fichier inutilisable) : chiffres repris de Strava.' : '',
    s.format === 'gpx' || s.format === 'tcx'
      ? `Fichier ${s.format.toUpperCase()}${s.source === 'strava' ? ' de Strava' : ''} : chiffres calculés depuis les points.` : '',
    s.source === 'strava' && !s.sansTrace && s.format === 'fit' ? "Fichier FIT récupéré dans l'archive Strava." : '',
    s.nbPoints ? `${nombre(s.nbPoints)} points enregistrés${intervalleS ? `, le plus souvent toutes les ${intervalleS} s` : ''}.` : '',
    erreur ? `Fichier d'origine illisible : ${echapper(erreur)}.` : '',
  ].filter(Boolean).join(' ');

  page.innerHTML = `
  <section class="detail-entete">
    <h2 class="detail-nom">${echapper(s.nom || s.nomSport)}</h2>
    <p class="detail-date">${majuscule(fmtJourLong.format(d))} · ${fmtHeure.format(d)}${s.nom ? ` · ${echapper(s.nomSport)}` : ''}</p>
    <div class="chiffres grands">
      ${s.distanceM ? `<span class="chiffre">${km(s.distanceM)}<small>km</small></span>` : ''}
      ${s.dureeChronoS != null ? `<span class="chiffre">${duree(s.dureeChronoS)}</span>` : ''}
      ${s.denivelePosM != null && (s.denivelePosM > 0 || s.distanceM) ? `<span class="chiffre">${nombre(s.denivelePosM)}<small>m D+</small></span>` : ''}
    </div>
    ${familleSortie(s).cle === 'sport-2' || s.veloId ? htmlChoixVelo(velos, s) : ''}
  </section>
  ${avecGps ? `
  <div class="segments vues" role="group" data-segments="vue">
    <button type="button" data-valeur="carte" aria-pressed="${modeVue === 'carte'}">Carte</button>
    <button type="button" data-valeur="3d" aria-pressed="${modeVue === '3d'}">3D</button>
  </div>
  <div class="carte-parcours" id="carte-parcours" role="img" aria-label="Carte du parcours"${modeVue === '3d' ? ' hidden' : ''}></div>
  <div class="vue3d" id="vue3d"${modeVue === '3d' ? '' : ' hidden'}></div>` : ''}
  ${grilleChiffres(s, charge, pts, estimee)}
  ${courbes.html}
  ${avecGps ? '<section class="carte bloc" id="bloc-segments-sortie"></section>' : ''}
  <section class="carte bloc" id="bloc-meme-parcours" hidden></section>
  ${blocEfforts(efforts, intervalleS, profil.poidsKg)}
  ${zonesP}
  ${zonesFc}
  ${blocTours(tours)}
  ${notes ? `<p class="detail-pied">${notes}</p>` : ''}
  ${avecGps ? `<div class="synchro-actions export-sortie">
    <button class="btn secondaire" type="button" data-export="gpx">Exporter en GPX</button>
    <button class="btn secondaire" type="button" data-export="partager">Partager le GPX</button>
  </div>` : ''}`;

  let marqueur = null;
  if (avecGps) {
    try { marqueur = creerCarte(page.querySelector('#carte-parcours'), pts); } catch (e) { console.warn('Carte', e); }
  }
  // Vue 3D, reliée au curseur des courbes dans les deux sens
  let curseur = null;
  if (avecGps) {
    try {
      vue3d = creerVue3d(page.querySelector('#vue3d'), pts, { auCurseur: (i) => curseur?.placerIndex(i) });
    } catch (e) { console.warn('Vue 3D', e); }
    const boutons = page.querySelector('[data-segments="vue"]');
    if (!vue3d) boutons.hidden = true;
    const montrer = (mode) => {
      modeVue = mode;
      page.querySelector('#carte-parcours').hidden = mode !== 'carte';
      page.querySelector('#vue3d').hidden = mode !== '3d';
      for (const b of boutons.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.valeur === mode));
      vue3d?.afficher(mode === '3d');
      if (mode === 'carte') carte?.invalidateSize();
      // fondu de la vue qui apparaît
      const vue = page.querySelector(mode === 'carte' ? '#carte-parcours' : '#vue3d');
      vue.classList.remove('entree-fondu');
      void vue.offsetWidth;
      vue.classList.add('entree-fondu');
    };
    boutons.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) montrer(b.dataset.valeur); });
    montrer(vue3d ? modeVue : 'carte');
  }
  curseur = installerCurseur(page, pts, axe, courbes.series, marqueur, (i) => vue3d?.placerCurseur(i));
  // Segments : passages de cette sortie, montées et sprints détectés, création
  const blocSegments = page.querySelector('#bloc-segments-sortie');
  if (blocSegments) {
    const trace = vue3d?.trace ?? construireTrace(pts);
    afficherSegmentsSortie(blocSegments, s, pts, trace, () => indexCurseur, toast).catch((e) => console.warn('Segments', e));
  }
  // Même parcours : autres sorties identiques, classées au temps en mouvement
  const blocParcours = page.querySelector('#bloc-meme-parcours');
  if (blocParcours) {
    toutesLesSorties().then((toutes) => {
      const groupe = memeParcoursQue(s, toutes);
      if (groupe.length < 2 || !blocParcours.isConnected) return;
      blocParcours.innerHTML = htmlMemeParcours(s, groupe);
      blocParcours.hidden = false;
    }).catch((e) => console.warn('Même parcours', e));
  }
  // Export GPX de la sortie (trace, altitude, heures, puissance, FC, cadence)
  page.querySelector('.export-sortie')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    const nom = s.nom || `${s.nomSport ?? 'Sortie'} du ${fmtDateLongue.format(s.debut)}`;
    const xml = gpxDepuisSortie(nom, pts, new Date(s.debut).getTime(), { velo: familleSortie(s).cle === 'sport-2' });
    const fichier = new File([xml], nomFichierGpx(`${new Date(s.debut).toISOString().slice(0, 10)} ${nom}`), { type: 'application/gpx+xml' });
    if (b.dataset.export === 'partager' && navigator.canShare?.({ files: [fichier] })) {
      try { await navigator.share({ files: [fichier], title: nom }); } catch (err) { if (err.name !== 'AbortError') toast(`Partage impossible : ${err.message}`); }
      return;
    }
    telecharger(fichier, fichier.name);
    toast(`${fichier.name} enregistré dans Téléchargements.`);
  });
  page.querySelector('#choix-velo')?.addEventListener('change', async (e) => {
    await completerSortie(s.id, () => ({ veloId: e.target.value || null }));
  });
  if (puissance.length) await enregistrerEfforts(s, pts).catch(() => {});
  return s;
}
