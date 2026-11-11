// Page Progrès : objectifs (semaine / mois / année), bilans, forme et fatigue,
// records de puissance (avec courbe de puissance).
import { toutesLesSorties, lireReglage, ecrireReglage } from './db.js';
import { familleSortie } from './sortie.js';
import { UNITES_OBJECTIF, OBJECTIFS_MUSCU, sortiesObjectif, valeurObjectif, anneau, etatAvancement } from './objectifs.js';
import { lireProfil, calculerEffortsManquants, wKg } from './profil.js';
import {
  bilanPeriodes, formeFatigue, etatFraicheur, records, CONSTANTE_FORME_J, CONSTANTE_FATIGUE_J,
  avancementObjectif, TYPES_OBJECTIF, PERIODES_OBJECTIF,
} from './stats.js';
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
export const RECORDS_AFFICHES = { 5: '5 s', 60: '1 min', 300: '5 min', 1200: '20 min', 3600: '1 h' };

const fmtSemaine = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtMoisCourt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const fmtMoisLong = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

const etat = { type: 'semaine', metrique: 'distance', choix: null, plage: 'j90' };
let calculEnCours = null;
let edition = null; // objectif en cours de saisie : null, 'nouveau' ou son id

// ---- Objectifs ---------------------------------------------------------------------

const fmtJourMois = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

function libelleObjectif(o, a) {
  if (o.periode === 'annee') return `${TYPES_OBJECTIF[o.type]} · ${new Date(a.debutMs).getFullYear()}`;
  if (o.periode === 'mois') return `${TYPES_OBJECTIF[o.type]} · ${fmtMoisLong.format(a.debutMs)}`;
  return `${TYPES_OBJECTIF[o.type]} · semaine du ${fmtJourMois.format(a.debutMs)} au ${fmtJourMois.format(a.finMs - 86400000)}`;
}

function formulaireObjectif(o) {
  const type = o?.type ?? 'distance';
  return `<form class="objectif-form" data-id="${o?.id ?? ''}">
    <label class="champ-ligne"><span>Objectif</span>
      <select name="type">${Object.entries(TYPES_OBJECTIF).map(([k, t]) => `<option value="${k}"${k === type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="champ-ligne"><span>Période</span>
      <select name="periode">${Object.entries(PERIODES_OBJECTIF).map(([k, t]) => `<option value="${k}"${k === (o?.periode ?? 'annee') ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="champ-ligne"><span>Valeur à atteindre (<span class="unite-objectif">${UNITES_OBJECTIF[type]}</span>)</span>
      <input name="cible" type="number" inputmode="numeric" min="1" step="any" required value="${o?.cible ?? ''}"></label>
    <div class="synchro-actions">
      <button class="btn principal" type="submit">Enregistrer</button>
      <button class="btn secondaire" type="button" data-obj="annuler">Annuler</button>
    </div>
  </form>`;
}

function blocObjectifs(objectifs, toutes, profil, maintenantMs) {
  const ordre = (o) => Object.keys(TYPES_OBJECTIF).indexOf(o.type) * 3 + Object.keys(PERIODES_OBJECTIF).indexOf(o.periode);
  const lignes = [...objectifs].sort((a, b) => ordre(a) - ordre(b)).map((o) => {
    if (edition === o.id) return formulaireObjectif(o);
    const a = avancementObjectif(o, sortiesObjectif(o.type, toutes), maintenantMs, { ftpW: profil.ftpW });
    const pct = Math.round(a.part * 100);
    const atteint = a.fait >= a.cible;
    let detail;
    if (o.type === 'ftp') {
      detail = [
        a.fait ? `FTP estimée après ta dernière sortie : 95 % du meilleur 20 min des 6 dernières semaines (le ${fmtDate.format(a.sortieFtp.debut)})` : 'Pas d\'effort de 20 min avec capteur ces 6 dernières semaines',
        a.departFtpW != null && !atteint ? `départ de la période : ${nombre(a.departFtpW)} W` : '',
        `FTP réglée : ${nombre(profil.ftpW)} W`,
      ].filter(Boolean).join(' · ');
    } else if (!atteint) {
      const semaines = a.joursRestants / 7;
      // musculation : pas « par jour » (0,3 séance…) mais « d'ici la fin de la période »
      const rythme = OBJECTIFS_MUSCU.includes(o.type) && (o.periode === 'semaine' || semaines < 1)
        ? `à faire d'ici le ${fmtJourMois.format(a.finMs - 86400000)}`
        : o.periode === 'semaine' || semaines < 1
          ? `${valeurObjectif(o.type, a.reste / Math.max(1, Math.ceil(a.joursRestants)))} par jour`
          : `${valeurObjectif(o.type, a.reste / semaines)} par semaine`;
      const ecart = Math.abs(a.ecart) < a.cible * 0.005 ? 'Pile dans le rythme'
        : `${a.ecart > 0 ? 'En avance' : 'En retard'} de ${valeurObjectif(o.type, Math.abs(a.ecart))}`;
      detail = `${ecart} · reste ${valeurObjectif(o.type, a.reste)}, soit ${rythme}`;
    } else detail = '';
    const fait = a.fait || o.type !== 'ftp' ? valeurObjectif(o.type, a.fait) : '–';
    return `<div class="objectif${atteint ? ' atteint' : ''}" data-id="${o.id}">
      <div class="objectif-tete">
        <span class="objectif-nom">${libelleObjectif(o, a)}</span>
        <span class="objectif-actions">
          <button class="btn secondaire petit" type="button" data-obj="modifier" aria-label="Modifier">✎</button>
          <button class="btn secondaire petit danger" type="button" data-obj="supprimer" aria-label="Supprimer">✕</button>
        </span>
      </div>
      <div class="objectif-cercle" role="img" aria-label="${fait} sur ${valeurObjectif(o.type, a.cible)}${a.attendu != null ? `, ${valeurObjectif(o.type, a.attendu)} prévus à ce jour` : ''}">
        ${anneau(a.part, a.attendu != null ? a.attendu / a.cible : null, etatAvancement(a))}
        <span class="objectif-centre"><b>${pct} %</b><small>${atteint ? 'atteint !' : 'de l\'objectif'}</small></span>
      </div>
      <ul class="objectif-legende">
        <li><span class="puce fait ${etatAvancement(a)}"></span>${o.type === 'ftp' ? 'FTP estimée' : 'Fait'} : <b>${fait}</b></li>
        ${a.attendu != null ? `<li><span class="puce attendu"></span>Prévu à ce jour : <b>${valeurObjectif(o.type, a.attendu)}</b></li>` : ''}
        <li><span class="puce cible"></span>Objectif : <b>${valeurObjectif(o.type, a.cible)}</b></li>
      </ul>
      ${detail ? `<p class="objectif-detail">${detail}</p>` : ''}
    </div>`;
  }).join('');
  return `<section class="carte bloc" id="bloc-objectifs">
    <h2 class="bloc-titre">Mes objectifs</h2>
    ${lignes ? `<div class="objectifs">${lignes}</div>` : (edition ? '' : '<p class="aide">Aucun objectif pour l\'instant : distance ou dénivelé, séances ou temps de musculation sur la semaine, le mois ou l\'année, ou une FTP à atteindre.</p>')}
    ${edition === 'nouveau' ? formulaireObjectif(null) : '<button class="btn secondaire" type="button" data-obj="ajouter">+ Ajouter un objectif</button>'}
    ${objectifs.length ? '<p class="bloc-note">Sorties vélo (ou séances de musculation) de la semaine (du lundi), du mois ou de l\'année en cours. Arc extérieur : où tu en es (vert en avance, rouge en retard) ; arc bleu : l\'objectif, où tu devrais en être en avançant régulièrement (pour la FTP : de ta FTP du début de la période jusqu\'à l\'objectif).</p>' : ''}
  </section>`;
}

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
    choix: boutons,
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
      <span class="barre-zone"><span class="bilan-barre" style="height:${h.toFixed(1)}%;--i:${i}"></span></span>
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
    <p class="bloc-note">Charge de chaque jour = TSS des sorties, calculé avec ta FTP actuelle (${profil.ftpW} W) ; sorties vélo sans capteur : puissance estimée (vitesse, pente, poids), les autres comptent pour 0.
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
  const enW = (rec) => Object.fromEntries(Object.entries(rec).filter(([, r]) => r).map(([d, r]) => [d, r.w]));
  const courbe = htmlCourbePuissance(enW(tousTemps), enW(recents), `${JOURS_ESTIMATION_FTP / 7} dernières semaines`);
  return `
  <section class="carte bloc" id="bloc-records">
    <h2 class="bloc-titre">Records de puissance</h2>
    ${enCours ? `<p class="progression" id="records-progression">${enCours}</p>` : ''}
    ${lignes ? `<table class="records"><thead><tr><th></th><th>Record</th><th>${JOURS_ESTIMATION_FTP / 7} sem.</th></tr></thead><tbody>${lignes}</tbody></table>` : ''}
    ${courbe}
    <p class="bloc-note">Ton BiNavi enregistre environ un point toutes les 8 s : les records courts (5 s, 1 min) sont approximatifs.</p>
  </section>`;
}

/**
 * Courbe de puissance (durée en échelle logarithmique) : records en trait plein,
 * l'autre série (6 dernières semaines, ou une sortie) en couleur.
 * @param {Object<number, number>} record  durée (s) -> W
 * @param {Object<number, number>} autre   durée (s) -> W
 */
export function htmlCourbePuissance(record, autre, legendeAutre) {
  const durees = DUREES_EFFORTS_S.filter((d) => record[d] || autre[d]);
  if (durees.length < 3) return '';
  const lx = (d) => ((Math.log(d) - Math.log(durees[0])) / (Math.log(durees[durees.length - 1]) - Math.log(durees[0]))) * 300;
  const haut = Math.max(...durees.map((d) => Math.max(record[d] ?? 0, autre[d] ?? 0))) * 1.08;
  const ly = (w) => 100 - (w / haut) * 100;
  const ligne = (rec) => durees.filter((d) => rec[d]).map((d, i) => `${i ? 'L' : 'M'}${lx(d).toFixed(2)} ${ly(rec[d]).toFixed(2)}`).join('');
  const etiquettes = { 5: '5 s', 60: '1 min', 300: '5 min', 1200: '20 min', 3600: '1 h' };
  return `
    <h3 class="sous-titre">Courbe de puissance</h3>
    <div class="legende"><span><span class="puce record"></span>Record</span><span><span class="puce recent"></span>${legendeAutre}</span></div>
    <div class="courbe-puissance">
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
        <path class="ligne-record" d="${ligne(record)}"/>
        <path class="ligne-recent" d="${ligne(autre)}"/>
      </svg>
      <span class="courbe-axe haut">${nombre(haut / 1.08)} W</span>
    </div>
    <div class="axe-log">${durees.filter((d) => etiquettes[d]).map((d) => `<span style="left:${((lx(d) / 300) * 100).toFixed(1)}%">${etiquettes[d]}</span>`).join('')}</div>`;
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
  let objectifs = (await lireReglage('objectifs')) ?? [];
  edition = null;
  const rendre = () => {
    page.innerHTML = `
    ${familles.size > 1 ? `<nav class="filtres" aria-label="Type d'activité">${filtresHtml}</nav>` : ''}
    ${blocObjectifs(objectifs, toutes, profil, maintenantMs)}
    ${blocBilans(sorties, maintenantMs)}
    ${blocForme(toutes, profil, maintenantMs)}
    ${blocRecords(sorties, maintenantMs, calcul, profil.poidsKg)}`;
    installerCurseurForme(page, toutes, profil, maintenantMs);
  };
  rendre();

  // Objectifs : ajout, modification, suppression (réglage « objectifs »)
  const garderObjectifs = async (liste) => { objectifs = liste; await ecrireReglage('objectifs', liste); };
  const rendreObjectifs = () => {
    page.querySelector('#bloc-objectifs').outerHTML = blocObjectifs(objectifs, toutes, profil, maintenantMs);
    page.querySelector('.objectif-form input[name="cible"]')?.focus();
  };
  page.onsubmit = async (e) => {
    const f = e.target.closest('.objectif-form');
    if (!f) return;
    e.preventDefault();
    const cible = Number(f.cible.value);
    if (!(cible > 0)) { f.cible.focus(); return; }
    const o = { id: f.dataset.id || `o${Date.now().toString(36)}`, type: f.type.value, periode: f.periode.value, cible };
    // un seul objectif par grandeur et par période : le nouveau remplace l'ancien
    await garderObjectifs([...objectifs.filter((x) => x.id !== o.id && !(x.type === o.type && x.periode === o.periode)), o]);
    edition = null;
    rendreObjectifs();
  };
  page.onchange = (e) => {
    if (e.target.name === 'type' && e.target.closest('.objectif-form')) {
      e.target.closest('.objectif-form').querySelector('.unite-objectif').textContent = UNITES_OBJECTIF[e.target.value];
    }
  };

  page.onclick = async (e) => {
    const obj = e.target.closest('[data-obj]');
    if (obj) {
      const a = obj.dataset.obj;
      const id = obj.closest('[data-id]')?.dataset.id;
      if (a === 'ajouter') edition = 'nouveau';
      else if (a === 'annuler') edition = null;
      else if (a === 'modifier') edition = id;
      else if (a === 'supprimer') {
        const o = objectifs.find((x) => x.id === id);
        if (!confirm(`Supprimer l'objectif « ${TYPES_OBJECTIF[o.type]} · ${PERIODES_OBJECTIF[o.periode].toLowerCase()} » ?`)) return;
        await garderObjectifs(objectifs.filter((x) => x.id !== id));
      }
      rendreObjectifs();
      return;
    }
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
  // calcul en arrière-plan : la page est déjà affichée (transition de page immédiate)
  calculEnCours.finally(() => { calculEnCours = null; }).then((n) => {
    if (n && !page.hidden) { calcul = ''; rendre(); }
  });
}
