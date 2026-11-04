// Page Progrès : bilans (semaines / mois / années), forme et fatigue,
// records de puissance (avec courbe de puissance).
import { toutesLesSorties } from './db.js';
import { familleSortie } from './sortie.js';
import { lireProfil, calculerEffortsManquants, wKg } from './profil.js';
import { htmlListeSegments, suivreRecherche } from './segments.js';
import { bilanPeriodes, formeFatigue, etatFraicheur, records, CONSTANTE_FORME_J, CONSTANTE_FATIGUE_J } from './stats.js';
import { DUREES_EFFORTS_S, JOURS_ESTIMATION_FTP } from './analyse.js';
import { nombre, km, duree, echapper, majuscule, fmtDate } from './format.js';

const NB_PERIODES = { semaine: 12, mois: 12, annee: 0 };
const NOMS_TYPES = { semaine: 'Semaines', mois: 'Mois', annee: 'Années' };
const METRIQUES = {
  distance: { nom: 'Distance', valeur: (p) => p.distanceM / 1000, texte: (p) => `${km(p.distanceM)} km` },
  temps: { nom: 'Temps', valeur: (p) => p.dureeS / 3600, texte: (p) => duree(p.dureeS) },
  denivele: { nom: 'Dénivelé', valeur: (p) => p.denivelePosM, texte: (p) => `${nombre(p.denivelePosM)} m` },
};
// Plages de la courbe de forme : 'j90', 'j365', 'a2025' (année civile), 'tout'
function plagesForme(tout) {
  const annees = [...new Set(tout.map((j) => new Date(j.jour).getFullYear()))].sort((a, b) => b - a);
  return [['j90', '3 mois'], ['j365', '1 an'], ...annees.map((a) => [`a${a}`, String(a)]), ['tout', 'Tout']];
}

function joursPlage(tout) {
  const p = etat.plage;
  if (p.startsWith('a')) {
    const an = Number(p.slice(1));
    const jours = tout.filter((j) => new Date(j.jour).getFullYear() === an);
    return jours.length ? jours : tout.slice(-90);
  }
  return p === 'tout' ? tout : tout.slice(-Number(p.slice(1)));
}
const RECORDS_AFFICHES = { 5: '5 s', 60: '1 min', 300: '5 min', 1200: '20 min', 3600: '1 h' };

const fmtSemaine = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtMoisCourt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const fmtMoisLong = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

const etat = { type: 'semaine', metrique: 'distance', choix: null, plage: 'j90' };
let calculEnCours = null;
let desabonnerSegments = null;

/** Rangée des boutons de tri par activité (partagée avec la liste) */
export function htmlFiltres(toutes, filtre) {
  const familles = new Map();
  for (const s of toutes) {
    const f = familleSortie(s);
    if (!familles.has(f.cle)) familles.set(f.cle, { ...f, n: 0 });
    familles.get(f.cle).n++;
  }
  const boutons = [{ cle: 'tout', nom: 'Tout', n: toutes.length },
    ...[...familles.values()].sort((a, b) => b.n - a.n || a.nom.localeCompare(b.nom, 'fr'))];
  return {
    familles,
    html: boutons.map((f) => `
    <button type="button" class="filtre" data-cle="${echapper(f.cle)}" aria-pressed="${f.cle === filtre}">
      ${echapper(f.nom)} <span class="filtre-n">${nombre(f.n)}</span>
    </button>`).join(''),
  };
}

function segments(nom, options, actif, classe = '') {
  const liste = Array.isArray(options) ? options : Object.entries(options);
  return `<div class="segments ${classe}" role="group" data-segments="${nom}">${liste.map(([cle, texte]) =>
    `<button type="button" data-valeur="${cle}" aria-pressed="${String(cle) === String(actif)}">${texte}</button>`).join('')}</div>`;
}

// ---- Bilans ----------------------------------------------------------------------

function libellePeriode(p, type, maintenantMs, long) {
  const actuelle = maintenantMs >= p.debut && maintenantMs < p.fin;
  if (type === 'semaine') {
    if (long) return actuelle ? 'Cette semaine' : `Semaine du ${fmtSemaine.format(p.debut)}`;
    return fmtSemaine.format(p.debut).replace('.', '');
  }
  if (type === 'mois') {
    if (long) return actuelle ? 'Ce mois-ci' : majuscule(fmtMoisLong.format(p.debut));
    return fmtMoisCourt.format(p.debut).replace('.', '');
  }
  const an = new Date(p.debut).getFullYear();
  return long && actuelle ? `Cette année (${an})` : String(an);
}

function blocBilans(sorties, maintenantMs) {
  const periodes = bilanPeriodes(sorties, etat.type, NB_PERIODES[etat.type], maintenantMs);
  if (etat.choix === null || etat.choix >= periodes.length) etat.choix = periodes.length - 1;
  const p = periodes[etat.choix];
  const m = METRIQUES[etat.metrique];
  const valeurs = periodes.map(m.valeur);
  const max = Math.max(...valeurs, 1e-9);
  const pas = periodes.length > 8 ? 3 : 1; // une étiquette sur trois
  const barres = periodes.map((x, i) => {
    const h = valeurs[i] > 0 ? Math.max(2, (valeurs[i] / max) * 100) : 0;
    const etiquette = (periodes.length - 1 - i) % pas === 0 ? libellePeriode(x, etat.type, maintenantMs, false) : '';
    return `<button type="button" class="barre-col" data-i="${i}" aria-pressed="${i === etat.choix}"
      aria-label="${libellePeriode(x, etat.type, maintenantMs, true)} : ${m.texte(x)}">
      <span class="barre-zone"><span class="bilan-barre" style="height:${h.toFixed(1)}%"></span></span>
      <span class="barre-etiquette">${etiquette}</span></button>`;
  }).join('');
  const moyenne = periodes.length ? periodes.reduce((a, x) => a + m.valeur(x), 0) / periodes.length : 0;
  return `
  <section class="carte bloc" id="bloc-bilans">
    ${segments('type', NOMS_TYPES, etat.type)}
    <h2 class="periode-titre">${libellePeriode(p, etat.type, maintenantMs, true)}</h2>
    <div class="stats stats-4">
      <div><span class="stat-label">Distance</span><span class="stat-val">${km(p.distanceM)}<small>km</small></span></div>
      <div><span class="stat-label">Temps</span><span class="stat-val">${duree(p.dureeS)}</span></div>
      <div><span class="stat-label">Dénivelé</span><span class="stat-val">${nombre(p.denivelePosM)}<small>m</small></span></div>
      <div><span class="stat-label">Sorties</span><span class="stat-val">${p.n}</span></div>
    </div>
    ${segments('metrique', Object.fromEntries(Object.entries(METRIQUES).map(([k, v]) => [k, v.nom])), etat.metrique)}
    <div class="barres" role="group" aria-label="${m.nom} par période">${barres}</div>
    <p class="bloc-note">Touchez une barre pour voir sa période. Moyenne sur ${periodes.length} ${NOMS_TYPES[etat.type].toLowerCase()} : ${
      etat.metrique === 'temps' ? duree(moyenne * 3600) : etat.metrique === 'distance' ? `${nombre(moyenne, 1)} km` : `${nombre(moyenne)} m`}.</p>
  </section>`;
}

// « +5 », « −13 » (vrai signe moins), « 0 »
function signe(v) {
  const n = Math.round(v);
  return n > 0 ? `+${nombre(n)}` : n < 0 ? `−${nombre(-n)}` : '0';
}

// ---- Forme et fatigue ---------------------------------------------------------------

function blocForme(sorties, profil, maintenantMs) {
  const tout = formeFatigue(sorties, profil.ftpW, maintenantMs);
  if (!tout.length || !tout.some((j) => j.tss > 0)) {
    return `<section class="carte bloc"><h2 class="bloc-titre">Forme et fatigue</h2>
      <p class="bloc-note">Il faut des sorties avec capteur de puissance pour calculer la charge d'entraînement.</p></section>`;
  }
  const jours = joursPlage(tout);
  const auj = tout[tout.length - 1];
  // Pic de forme et creux de fraîcheur sur la plage affichée
  const pic = jours.reduce((m, j) => (j.ctl > m.ctl ? j : m), jours[0]);
  const creux = jours.reduce((m, j) => (j.tsb < m.tsb ? j : m), jours[0]);
  const tsbMatin = auj.tsb;
  // Courbes forme (CTL) et fatigue (ATL) : même unité, même axe
  const haut = Math.max(...jours.map((j) => Math.max(j.ctl, j.atl)), 1) * 1.1;
  const x = (i) => (jours.length > 1 ? (i / (jours.length - 1)) * 300 : 150);
  const y = (v) => 100 - (v / haut) * 100;
  const trace = (c) => jours.map((j, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(j[c]).toFixed(2)}`).join('');
  // Fraîcheur (TSB) : barres de part et d'autre de zéro
  const ampl = Math.max(...jours.map((j) => Math.abs(j.tsb)), 1);
  const largeur = 300 / jours.length;
  const barresTsb = jours.map((j, i) => {
    const h = (Math.abs(j.tsb) / ampl) * 50;
    const y0 = j.tsb >= 0 ? 50 - h : 50;
    return `<rect x="${(i * largeur).toFixed(2)}" y="${y0.toFixed(2)}" width="${Math.max(largeur - 0.3, 0.3).toFixed(2)}" height="${h.toFixed(2)}" class="${j.tsb >= 0 ? 'tsb-plus' : 'tsb-moins'}"/>`;
  }).join('');
  const dernier = jours[jours.length - 1];
  // Étiquettes au bout des courbes, écartées si elles se chevauchent
  let hautForme = y(dernier.ctl);
  let hautFatigue = y(dernier.atl);
  const ECART_MIN = 14; // % de la hauteur du graphique
  if (Math.abs(hautForme - hautFatigue) < ECART_MIN) {
    const milieu = (hautForme + hautFatigue) / 2;
    const formeEnHaut = dernier.ctl >= dernier.atl;
    hautForme = Math.min(100, Math.max(0, milieu + (formeEnHaut ? -1 : 1) * ECART_MIN / 2));
    hautFatigue = Math.min(100, Math.max(0, milieu + (formeEnHaut ? 1 : -1) * ECART_MIN / 2));
  }
  const debutTxt = fmtDate.format(jours[0].jour);
  const finTxt = dernier.jour === auj.jour ? "aujourd'hui" : fmtDate.format(dernier.jour);
  return `
  <section class="carte bloc" id="bloc-forme">
    <h2 class="bloc-titre">Forme et fatigue</h2>
    <div class="stats stats-3">
      <div><span class="stat-label"><span class="puce forme"></span>Forme</span><span class="stat-val">${nombre(auj.ctl)}</span></div>
      <div><span class="stat-label"><span class="puce fatigue"></span>Fatigue</span><span class="stat-val">${nombre(auj.atl)}</span></div>
      <div><span class="stat-label">Fraîcheur</span><span class="stat-val">${signe(tsbMatin)}</span></div>
    </div>
    <p class="etat-forme">${etatFraicheur(tsbMatin)}</p>
    ${segments('plage', plagesForme(tout), etat.plage, 'defile')}
    <p class="bloc-note pic-forme">Sur cette période : forme maxi <b>${nombre(pic.ctl)}</b> le ${fmtDate.format(pic.jour)}, fraîcheur la plus basse <b>${signe(creux.tsb)}</b> le ${fmtDate.format(creux.jour)}.</p>
    <p class="courbes-position" id="forme-position">Touchez la courbe pour lire un jour</p>
    <div class="forme-graph" id="forme-graph" data-n="${jours.length}">
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
        <path class="ligne-forme" d="${trace('ctl')}"/>
        <path class="ligne-fatigue" d="${trace('atl')}"/>
      </svg>
      <span class="etiquette-fin forme" style="top:${hautForme.toFixed(1)}%">Forme</span>
      <span class="etiquette-fin fatigue" style="top:${hautFatigue.toFixed(1)}%">Fatigue</span>
      <span class="curseur" hidden></span>
    </div>
    <div class="tsb-graph">
      <span class="tsb-titre">Fraîcheur</span>
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="300" y1="50" y2="50" class="tsb-zero"/>${barresTsb}</svg>
      <span class="curseur" hidden></span>
    </div>
    <div class="courbes-x"><span>${debutTxt}</span><span>${finTxt}</span></div>
    <p class="bloc-note">Charge de chaque jour = TSS des sorties avec puissance, calculé avec ta FTP actuelle (${profil.ftpW} W) ; les sorties sans capteur comptent pour 0.
    Forme = moyenne sur ${CONSTANTE_FORME_J} jours, fatigue = moyenne sur ${CONSTANTE_FATIGUE_J} jours, fraîcheur = forme − fatigue de la veille.</p>
  </section>`;
}

function installerCurseurForme(page, sorties, profil, maintenantMs) {
  const graph = page.querySelector('#forme-graph');
  if (!graph) return;
  const tout = formeFatigue(sorties, profil.ftpW, maintenantMs);
  const jours = joursPlage(tout);
  const position = page.querySelector('#forme-position');
  const curseurs = [...page.querySelectorAll('#bloc-forme .curseur')];
  const zones = [graph, page.querySelector('.tsb-graph')];
  const placer = (clientX, zone) => {
    const r = zone.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const i = Math.round(f * (jours.length - 1));
    const j = jours[i];
    for (const c of curseurs) { c.hidden = false; c.style.left = `${((i / Math.max(1, jours.length - 1)) * 100).toFixed(2)}%`; }
    position.textContent = `${fmtDate.format(j.jour)} · forme ${nombre(j.ctl)} · fatigue ${nombre(j.atl)} · fraîcheur ${signe(j.tsb)}${j.tss ? ` · TSS du jour ${nombre(j.tss)}` : ''}`;
  };
  for (const z of zones) {
    z.addEventListener('pointerdown', (e) => placer(e.clientX, z));
    z.addEventListener('pointermove', (e) => placer(e.clientX, z));
  }
}

// ---- Records -------------------------------------------------------------------------

function blocRecords(sorties, maintenantMs, enCours, poidsKg) {
  const avecPuissance = sorties.filter((s) => s.puissanceMoyW);
  if (!avecPuissance.length) return '';
  const depuis = maintenantMs - JOURS_ESTIMATION_FTP * 86400000;
  const tousTemps = records(sorties, DUREES_EFFORTS_S);
  const recents = records(sorties, DUREES_EFFORTS_S, depuis);
  const lignes = Object.entries(RECORDS_AFFICHES).filter(([d]) => tousTemps[d]).map(([d, nom]) => {
    const r = tousTemps[d];
    const rec = recents[d];
    return `<tr><th scope="row">${nom}</th>
      <td><a href="#sortie=${encodeURIComponent(r.sortie.id)}"><b>${nombre(r.w)} W</b><small>${wKg(r.w, poidsKg) ? `${wKg(r.w, poidsKg)} W/kg · ` : ''}${fmtDate.format(r.sortie.debut)}</small></a></td>
      <td>${rec ? `${nombre(rec.w)} W` : '–'}</td></tr>`;
  }).join('');
  // Courbe de puissance : durée en échelle logarithmique
  const durees = DUREES_EFFORTS_S.filter((d) => tousTemps[d]);
  let courbe = '';
  if (durees.length >= 3) {
    const lx = (d) => ((Math.log(d) - Math.log(durees[0])) / (Math.log(durees[durees.length - 1]) - Math.log(durees[0]))) * 300;
    const haut = Math.max(...durees.map((d) => tousTemps[d].w)) * 1.08;
    const ly = (w) => 100 - (w / haut) * 100;
    const ligne = (rec) => durees.filter((d) => rec[d]).map((d, i) => `${i ? 'L' : 'M'}${lx(d).toFixed(2)} ${ly(rec[d].w).toFixed(2)}`).join('');
    const etiquettes = { 5: '5 s', 60: '1 min', 300: '5 min', 1200: '20 min', 3600: '1 h' };
    courbe = `
    <h3 class="sous-titre">Courbe de puissance</h3>
    <div class="legende"><span><span class="puce record"></span>Record</span><span><span class="puce recent"></span>${JOURS_ESTIMATION_FTP / 7} dernières semaines</span></div>
    <div class="courbe-puissance">
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
        <path class="ligne-record" d="${ligne(tousTemps)}"/>
        <path class="ligne-recent" d="${ligne(recents)}"/>
      </svg>
      <span class="courbe-axe haut">${nombre(haut / 1.08)} W</span>
    </div>
    <div class="axe-log">${durees.filter((d) => etiquettes[d]).map((d) => `<span style="left:${((lx(d) / 300) * 100).toFixed(1)}%">${etiquettes[d]}</span>`).join('')}</div>`;
  }
  return `
  <section class="carte bloc" id="bloc-records">
    <h2 class="bloc-titre">Records de puissance</h2>
    ${enCours ? `<p class="progression" id="records-progression">${enCours}</p>` : ''}
    ${lignes ? `<table class="records"><thead><tr><th></th><th>Record</th><th>${JOURS_ESTIMATION_FTP / 7} sem.</th></tr></thead><tbody>${lignes}</tbody></table>` : ''}
    ${courbe}
    <p class="bloc-note">Ton BiNavi enregistre environ un point toutes les 8 s : les records courts (5 s, 1 min) sont approximatifs.</p>
  </section>`;
}

// ---- Page ----------------------------------------------------------------------------

/**
 * @param {HTMLElement} page
 * @param {{filtre: string, changerFiltre: (cle: string) => Promise<void>}} options
 */
export async function afficherProgres(page, options, maintenantMs = Date.now()) {
  const toutes = await toutesLesSorties();
  const profil = await lireProfil(toutes);
  if (!toutes.length) {
    page.innerHTML = '<section class="carte"><p>Aucune sortie pour l\'instant : importez-en depuis l\'onglet Sorties.</p></section>';
    return;
  }
  let filtre = options.filtre;
  const { familles, html: filtresHtml } = htmlFiltres(toutes, filtre);
  if (filtre !== 'tout' && !familles.has(filtre)) filtre = 'tout';
  const sorties = toutes.filter((s) => filtre === 'tout' || familleSortie(s).cle === filtre);

  let calcul = '';
  const segmentsHtml = await htmlListeSegments();
  const rendre = () => {
    page.innerHTML = `
    ${familles.size > 1 ? `<nav class="filtres" aria-label="Type d'activité">${filtresHtml}</nav>` : ''}
    ${blocBilans(sorties, maintenantMs)}
    ${blocForme(toutes, profil, maintenantMs)}
    ${blocRecords(sorties, maintenantMs, calcul, profil.poidsKg)}
    ${segmentsHtml}`;
    installerCurseurForme(page, toutes, profil, maintenantMs);
  };
  rendre();

  // Recherche des passages sur les segments en cours : avancement, puis liste à jour
  desabonnerSegments?.();
  desabonnerSegments = suivreRecherche(async (t) => {
    const p = page.querySelector('#segments-recherche');
    if (p) { p.hidden = !t; p.textContent = t; }
    if (!t && page.querySelector('#bloc-segments')) page.querySelector('#bloc-segments').outerHTML = await htmlListeSegments();
  });

  page.onclick = async (e) => {
    const f = e.target.closest('.filtre');
    if (f) { await options.changerFiltre(f.dataset.cle); return; }
    const seg = e.target.closest('[data-segments] button');
    if (seg) {
      const nom = seg.parentElement.dataset.segments;
      const v = seg.dataset.valeur;
      if (nom === 'type') { etat.type = v; etat.choix = null; }
      else if (nom === 'metrique') etat.metrique = v;
      else if (nom === 'plage') etat.plage = v;
      rendre();
      return;
    }
    const barre = e.target.closest('.barre-col');
    if (barre) { etat.choix = Number(barre.dataset.i); rendre(); }
  };

  // Records : efforts à calculer pour les sorties qui ne les ont pas encore
  // (un seul calcul à la fois, même si la page est rouverte entre-temps)
  if (calculEnCours) return;
  calculEnCours = calculerEffortsManquants(toutes, (fait, total) => {
    if (!total) return;
    calcul = `Analyse des sorties pour les records : ${fait} / ${total}…`;
    const p = page.querySelector('#records-progression');
    if (p) p.textContent = calcul;
    else if (fait === 0) rendre();
  });
  const n = await calculEnCours.finally(() => { calculEnCours = null; });
  if (n && !page.hidden) { calcul = ''; rendre(); }
}
