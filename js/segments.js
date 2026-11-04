// Segments (comme sur Strava) : stockage, recherche des passages dans toutes
// les sorties, et écrans (bloc du détail d'une sortie, page d'un segment,
// liste dans Progrès). Calculs dans segments-calc.js.
import { lireReglage, ecrireReglage, toutesLesSorties, lireFichier, mettreAJourSorties } from './db.js';
import { decoderFichier } from './fichier.js';
import { pointsDetail } from './analyse.js';
import { decouperSegment, trouverPassages, bboxCompatible, detecterMontees, detecterSprints, classer } from './segments-calc.js';
import { lireProfil, wKg } from './profil.js';
import { nombre, km, chrono, echapper, fmtDate } from './format.js';
import { htmlCarteStatique } from './carte-statique.js';

export const PART_FTP_SPRINT = 1.5; // sprint : au-dessus de 150 % de la FTP

// ---- Stockage (réglages « segments » et « passages ») ---------------------------

export const lireSegments = async () => (await lireReglage('segments')) ?? [];
export const lirePassages = async () => (await lireReglage('passages')) ?? [];
const ecrireSegments = (l) => ecrireReglage('segments', l);
const ecrirePassages = (l) => ecrireReglage('passages', l);

const nouvelId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function typeSegment(seg) {
  if (seg.penteMoyPct >= 3) return 'Montée';
  if (seg.penteMoyPct <= -3) return 'Descente';
  return 'Plat';
}

/** Crée un segment depuis les points [i0, i1] d'une sortie, puis cherche ses passages. */
export async function creerSegment(sortie, pts, i0, i1, nom, { sprint = false } = {}, progression = () => {}) {
  const d = decouperSegment(pts, i0, i1);
  const seg = {
    id: nouvelId(), nom: nom.trim() || 'Segment', ...d, creeLe: Date.now(),
    sortieOrigine: sortie.id, iOrigine: i0, analyseFaite: false,
  };
  seg.type = sprint ? 'Sprint' : typeSegment(seg);
  await ecrireSegments([...(await lireSegments()), seg]);
  await mettreAJourPassages(progression);
  return seg;
}

export async function renommerSegment(id, nom) {
  await ecrireSegments((await lireSegments()).map((s) => (s.id === id ? { ...s, nom } : s)));
}

export async function supprimerSegment(id) {
  await ecrireSegments((await lireSegments()).filter((s) => s.id !== id));
  await ecrirePassages((await lirePassages()).filter((p) => p.segmentId !== id));
}

// ---- Recherche des passages ----------------------------------------------------------

let enCours = null;
const abonnes = new Set(); // fonctions prévenues de l'avancement (texte)
export const suivreRecherche = (f) => { abonnes.add(f); return () => abonnes.delete(f); };
const annoncer = (t) => { for (const f of abonnes) f(t); };

async function pointsDeLaSortie(s, cache) {
  if (cache.has(s.id)) return cache.get(s.id);
  const f = await lireFichier(s.id);
  let pts = [];
  if (f) {
    try { pts = pointsDetail((await decoderFichier(f)).records); } catch (e) { console.warn('Segments : fichier illisible', s.id, e); }
  }
  if (cache.size > 20) cache.clear();
  cache.set(s.id, pts);
  return pts;
}

function enregistrerPassages(liste, seg, s, trouves) {
  for (const p of trouves) {
    const id = `${seg.id}|${s.id}|${Math.round(p.debutS)}`;
    if (liste.some((x) => x.id === id)) continue;
    liste.push({ id, segmentId: seg.id, sortieId: s.id, debut: s.debut + p.debutS * 1000, ...p });
  }
}

/**
 * Met les passages à jour : segments pas encore cherchés (dans toutes les
 * sorties), puis sorties pas encore vérifiées (contre tous les segments).
 * Reprend là où il s'était arrêté si l'appli a été fermée.
 */
export function mettreAJourPassages(progression = () => {}) {
  if (!enCours) {
    enCours = (async () => {
      const dire = (t) => { progression(t); annoncer(t); };
      const segments = await lireSegments();
      let sorties = await toutesLesSorties();
      const nonVerifiees = () => sorties.filter((s) => !s.segmentsVerifies && s.trace?.length > 1);
      if (!segments.length) {
        await mettreAJourSorties(nonVerifiees().map((s) => s.id), { segmentsVerifies: true });
        return 0;
      }
      const passages = await lirePassages();
      const cache = new Map();
      let trouvesTotal = 0;
      // a) segments nouveaux : toutes les sorties qui peuvent y passer
      for (const seg of segments.filter((x) => !x.analyseFaite)) {
        const candidates = sorties.filter((s) => bboxCompatible(seg, s.trace));
        let k = 0;
        for (const s of candidates) {
          dire(`Recherche des passages sur « ${seg.nom} » : ${++k} / ${candidates.length}`);
          const trouves = trouverPassages(seg, await pointsDeLaSortie(s, cache));
          trouvesTotal += trouves.length;
          enregistrerPassages(passages, seg, s, trouves);
        }
        seg.analyseFaite = true;
        await ecrirePassages(passages);
        await ecrireSegments(segments);
      }
      // b) sorties nouvelles : tous les segments
      sorties = await toutesLesSorties();
      const aVerifier = nonVerifiees();
      let k = 0;
      for (const s of aVerifier) {
        const compatibles = segments.filter((seg) => bboxCompatible(seg, s.trace));
        if (compatibles.length) {
          dire(`Recherche des segments dans tes sorties : ${++k} / ${aVerifier.length}`);
          const pts = await pointsDeLaSortie(s, cache);
          for (const seg of compatibles) {
            const trouves = trouverPassages(seg, pts);
            trouvesTotal += trouves.length;
            enregistrerPassages(passages, seg, s, trouves);
          }
        }
      }
      await ecrirePassages(passages);
      await mettreAJourSorties(aVerifier.map((s) => s.id), { segmentsVerifies: true });
      dire('');
      return trouvesTotal;
    })().finally(() => { enCours = null; });
  }
  return enCours;
}

// ---- Affichage commun ------------------------------------------------------------------

function rangTexte(rang, total) {
  if (rang === 1) return '<span class="rang or">🏆 Record perso</span>';
  if (rang === 2) return '<span class="rang">2e temps</span>';
  if (rang === 3) return '<span class="rang">3e temps</span>';
  return `<span class="rang discret">${rang}e sur ${total}</span>`;
}

function chiffresSegment(seg) {
  return `${km(seg.distanceM)} km${seg.penteMoyPct != null ? ` · ${nombre(seg.penteMoyPct, 1)} %` : ''}${seg.denivelePosM ? ` · ${nombre(seg.denivelePosM)} m D+` : ''}`;
}

function mesuresPassage(p, poidsKg) {
  return [
    p.vitesseMoyMs ? `${nombre(p.vitesseMoyMs * 3.6, 1)} km/h` : '',
    p.puissanceMoyW ? `${p.puissanceMoyW} W${wKg(p.puissanceMoyW, poidsKg) ? ` (${wKg(p.puissanceMoyW, poidsKg)} W/kg)` : ''}` : '',
    p.fcMoy ? `${p.fcMoy} bpm` : '',
    p.vamMh ? `VAM ${nombre(p.vamMh)} m/h` : '',
  ].filter(Boolean).join(' · ');
}

// Petite carte du segment (fond OpenStreetMap)
function apercuSegment(seg) {
  return htmlCarteStatique(seg.points, { hauteur: 140, classe: 'segment-apercu' });
}

// ---- Bloc « Segments » du détail d'une sortie -------------------------------------------

/**
 * @param {HTMLElement} bloc
 * @param {object} s  la sortie
 * @param {object[]} pts  ses points
 * @param {object|null} trace3d  trace de construireTrace() (pour les montées)
 * @param {() => number|null} indexCurseur  point actuellement sous le curseur des courbes
 * @param {(texte: string) => void} toast
 */
export async function afficherSegmentsSortie(bloc, s, pts, trace3d, indexCurseur, toast) {
  const avecGps = pts.filter((p) => typeof p.lat === 'number').length >= 2;
  if (!avecGps) { bloc.hidden = true; return; }
  const profil = await lireProfil();
  const segments = await lireSegments();
  const passages = await lirePassages();
  const parSegment = new Map(segments.map((g) => [g.id, passages.filter((p) => p.segmentId === g.id)]));
  const ici = passages.filter((p) => p.sortieId === s.id).sort((a, b) => a.debutS - b.debutS);
  const choix = { debut: null, fin: null };

  const deja = (i0) => segments.some((g) => g.sortieOrigine === s.id && Math.abs((g.iOrigine ?? -9) - i0) <= 1);
  const montees = trace3d ? detecterMontees(trace3d, pts.length) : [];
  const sprints = profil.ftpW ? detecterSprints(pts, profil.ftpW * PART_FTP_SPRINT) : [];
  const propositions = [
    ...montees.map((m) => ({ ...m, sprint: false, nom: `Montée du km ${nombre(pts[m.i0].distanceM / 1000, 1)}`, texte: `${km(m.distanceM)} km à ${nombre(m.penteMoyPct, 1)} % (+${nombre(m.gainM)} m)` })),
    ...sprints.map((m) => ({ ...m, sprint: true, nom: `Sprint du km ${nombre(pts[m.i0].distanceM / 1000, 1)}`, texte: `${nombre(m.distanceM)} m, pic ${nombre(m.picW)} W en ${Math.round(m.dureeS)} s` })),
  ].filter((m) => !deja(m.i0)).sort((a, b) => a.i0 - b.i0);

  const rendre = (etat = '') => {
    const lignes = ici.map((p) => {
      const g = segments.find((x) => x.id === p.segmentId);
      if (!g) return '';
      const tous = parSegment.get(g.id) ?? [];
      const rang = classer(tous).get(tous.find((x) => x.id === p.id));
      return `<a class="passage" href="#segment=${encodeURIComponent(g.id)}">
        <span class="passage-nom">${echapper(g.nom)}<small>${g.type} · ${chiffresSegment(g)}</small></span>
        <span class="passage-temps">${chrono(p.dureeS)}${rangTexte(rang, tous.length)}</span>
        <span class="passage-mesures">${mesuresPassage(p, profil.poidsKg)}</span></a>`;
    }).join('');
    const km1 = (i) => (i == null ? '–' : `km ${nombre(pts[i].distanceM / 1000, 2)}`);
    let resume = '';
    if (choix.debut != null && choix.fin != null && choix.fin > choix.debut) {
      try {
        const d = decouperSegment(pts, choix.debut, choix.fin);
        resume = `${km(d.distanceM)} km${d.penteMoyPct != null ? `, ${nombre(d.penteMoyPct, 1)} % de moyenne, +${nombre(d.denivelePosM)} m` : ''}`;
      } catch { resume = 'Pas de GPS sur ce passage.'; }
    }
    bloc.innerHTML = `
      <h2 class="bloc-titre">Segments</h2>
      ${etat ? `<p class="progression">${echapper(etat)}</p>` : ''}
      ${lignes ? `<div class="passages">${lignes}</div>` : '<p class="aide">Aucun segment sur cette sortie pour l\'instant.</p>'}
      ${propositions.length ? `
      <h3 class="sous-titre">Détectés sur cette sortie</h3>
      <div class="propositions">${propositions.map((m, k) => `
        <div class="proposition"><span>${m.sprint ? '⚡' : '⛰'} <b>${echapper(m.nom)}</b><small>${m.texte}</small></span>
        <button class="btn secondaire petit" type="button" data-suivre="${k}">Suivre</button></div>`).join('')}</div>` : ''}
      <details class="creation"${choix.debut != null ? ' open' : ''}>
        <summary>Créer un segment à la main</summary>
        <p class="aide">Touche une courbe (ou le ruban 3D) à l'endroit du départ, puis « Départ ici » ; fais de même pour l'arrivée.</p>
        <div class="synchro-actions">
          <button class="btn secondaire petit" type="button" data-choix="debut">Départ ici</button>
          <button class="btn secondaire petit" type="button" data-choix="fin">Arrivée ici</button>
        </div>
        <p class="aide">Départ : <b>${km1(choix.debut)}</b> · Arrivée : <b>${km1(choix.fin)}</b>${resume ? ` · ${resume}` : ''}</p>
        <label class="champ-ligne"><span>Nom</span><input id="nom-segment" type="text" maxlength="50" placeholder="Ex. : montée de Saint-Nizier"></label>
        <button class="btn principal" type="button" data-creer${resume && !resume.startsWith('Pas') ? '' : ' disabled'}>Créer le segment</button>
      </details>`;
  };
  rendre();

  const creer = async (i0, i1, nom, sprint) => {
    rendre('Création du segment…');
    try {
      const g = await creerSegment(s, pts, i0, i1, nom, { sprint }, (t) => rendre(t || 'Création du segment…'));
      const n = (await lirePassages()).filter((p) => p.segmentId === g.id).length;
      toast(`Segment « ${g.nom} » créé : ${n} passage${n > 1 ? 's' : ''} trouvé${n > 1 ? 's' : ''} dans tes sorties.`);
      await afficherSegmentsSortie(bloc, s, pts, trace3d, indexCurseur, toast);
    } catch (e) {
      console.error(e);
      toast(`Segment impossible : ${e.message}`);
      rendre();
    }
  };

  bloc.onclick = async (e) => {
    const suivre = e.target.closest('[data-suivre]');
    if (suivre) {
      const m = propositions[Number(suivre.dataset.suivre)];
      await creer(m.i0, m.i1, m.nom, m.sprint);
      return;
    }
    const c = e.target.closest('[data-choix]');
    if (c) {
      const i = indexCurseur();
      if (i == null) { toast('Touche d\'abord une courbe à l\'endroit voulu.'); return; }
      const nom = bloc.querySelector('#nom-segment')?.value ?? '';
      choix[c.dataset.choix] = i;
      rendre();
      bloc.querySelector('#nom-segment').value = nom;
      return;
    }
    if (e.target.closest('[data-creer]')) {
      const nom = bloc.querySelector('#nom-segment').value.trim();
      if (!nom) { toast('Donne un nom au segment.'); bloc.querySelector('#nom-segment').focus(); return; }
      await creer(choix.debut, choix.fin, nom, false);
    }
  };
}

// ---- Page d'un segment ---------------------------------------------------------------------

const etatPage = { tri: 'date' };

export async function afficherSegment(page, id, toast) {
  const segments = await lireSegments();
  const g = segments.find((x) => x.id === id);
  if (!g) { page.innerHTML = '<section class="carte"><p>Segment introuvable.</p></section>'; return null; }
  const profil = await lireProfil();
  const sorties = new Map((await toutesLesSorties()).map((s) => [s.id, s]));
  const passages = (await lirePassages()).filter((p) => p.segmentId === id && sorties.has(p.sortieId));
  const rangs = classer(passages);
  const record = passages.length ? [...passages].sort((a, b) => a.dureeS - b.dureeS)[0] : null;

  const rendre = () => {
    const tries = [...passages].sort(etatPage.tri === 'temps' ? (a, b) => a.dureeS - b.dureeS : (a, b) => b.debut - a.debut);
    page.innerHTML = `
    <section class="detail-entete">
      <h2 class="detail-nom">${echapper(g.nom)}</h2>
      <p class="detail-date">${g.type} · ${chiffresSegment(g)}${g.altDepartM != null ? ` · ${Math.round(g.altDepartM)} → ${Math.round(g.altArriveeM)} m` : ''}</p>
    </section>
    ${apercuSegment(g)}
    <section class="carte bloc">
      <div class="stats stats-3">
        <div><span class="stat-label">Passages</span><span class="stat-val">${passages.length}</span></div>
        <div><span class="stat-label">Record</span><span class="stat-val">${record ? chrono(record.dureeS) : '–'}</span></div>
        <div><span class="stat-label">Vitesse</span><span class="stat-val">${record?.vitesseMoyMs ? nombre(record.vitesseMoyMs * 3.6, 1) : '–'}<small>km/h</small></span></div>
      </div>
      ${record ? `<p class="bloc-note">Record le ${fmtDate.format(record.debut)}${record.puissanceMoyW ? `, ${record.puissanceMoyW} W` : ''}.</p>` : ''}
    </section>
    <section class="carte bloc">
      <h2 class="bloc-titre">Historique des passages</h2>
      <div class="segments" role="group" data-segments="tri">
        <button type="button" data-valeur="date" aria-pressed="${etatPage.tri === 'date'}">Par date</button>
        <button type="button" data-valeur="temps" aria-pressed="${etatPage.tri === 'temps'}">Par temps</button>
      </div>
      ${tries.length ? `<div class="passages">${tries.map((p) => `
        <a class="passage" href="#sortie=${encodeURIComponent(p.sortieId)}">
          <span class="passage-nom">${fmtDate.format(p.debut)}<small>${echapper(sorties.get(p.sortieId).nom || sorties.get(p.sortieId).nomSport)}</small></span>
          <span class="passage-temps">${chrono(p.dureeS)}${rangTexte(rangs.get(p), passages.length)}</span>
          <span class="passage-mesures">${mesuresPassage(p, profil.poidsKg)}</span></a>`).join('')}</div>`
        : '<p class="aide">Aucun passage trouvé.</p>'}
      <p class="bloc-note">Temps écoulé entre le départ et l'arrivée du segment, pauses comprises (comme Strava). Avec un point toutes les 8 s, l'heure de passage est calculée entre deux points.</p>
    </section>
    <div class="synchro-actions">
      <button class="btn secondaire" type="button" data-action="renommer">Renommer</button>
      <button class="btn secondaire danger" type="button" data-action="supprimer">Supprimer le segment</button>
    </div>`;
  };
  rendre();
  page.onclick = async (e) => {
    const t = e.target.closest('[data-segments="tri"] button');
    if (t) { etatPage.tri = t.dataset.valeur; rendre(); return; }
    const a = e.target.closest('[data-action]')?.dataset.action;
    if (a === 'renommer') {
      const nom = prompt('Nouveau nom du segment', g.nom)?.trim();
      if (nom) { await renommerSegment(g.id, nom); g.nom = nom; rendre(); toast('Segment renommé.'); }
    } else if (a === 'supprimer') {
      if (!confirm(`Supprimer le segment « ${g.nom} » et ses ${passages.length} passages ?`)) return;
      await supprimerSegment(g.id);
      toast('Segment supprimé.');
      history.back();
    }
  };
  return g;
}

// ---- Liste des segments (onglet Progrès) ---------------------------------------------------

export async function htmlListeSegments() {
  const segments = await lireSegments();
  if (!segments.length) {
    return `<section class="carte bloc" id="bloc-segments"><h2 class="bloc-titre">Mes segments</h2>
      <p class="aide">Pas encore de segment. Dans le détail d'une sortie, touche « Suivre » sur une montée ou un sprint détecté, ou crée un segment à la main : l'appli retrouve alors tous tes passages.</p></section>`;
  }
  const passages = await lirePassages();
  const lignes = segments.map((g) => {
    const ps = passages.filter((p) => p.segmentId === g.id);
    const rec = ps.length ? Math.min(...ps.map((p) => p.dureeS)) : null;
    return { g, n: ps.length, rec, dernier: ps.length ? Math.max(...ps.map((p) => p.debut)) : 0 };
  }).sort((a, b) => b.dernier - a.dernier);
  return `<section class="carte bloc" id="bloc-segments">
    <h2 class="bloc-titre">Mes segments</h2>
    <p class="progression" id="segments-recherche" hidden></p>
    <div class="passages">${lignes.map(({ g, n, rec }) => `
      <a class="passage" href="#segment=${encodeURIComponent(g.id)}">
        <span class="passage-nom">${echapper(g.nom)}<small>${g.type} · ${chiffresSegment(g)}</small></span>
        <span class="passage-temps">${rec != null ? chrono(rec) : '–'}<span class="rang discret">${n} passage${n > 1 ? 's' : ''}</span></span></a>`).join('')}</div>
  </section>`;
}
