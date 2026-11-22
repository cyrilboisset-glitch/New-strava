// Archive Strava (export du compte) : lecture de activities.csv.
// Le CSV donne le nom de chaque sortie, son type, et le fichier associé
// (activities/123.fit.gz, .gpx, .tcx.gz…). Les sorties saisies à la main
// sur Strava n'ont pas de fichier : on les reprend depuis le CSV.

/** CSV (RFC 4180 : guillemets, retours à la ligne dans les champs) -> lignes */
export function lireCsv(texte) {
  const lignes = [];
  let ligne = [];
  let champ = '';
  let guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') { champ += '"'; i++; } else guillemets = false;
      } else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.some((v) => v !== '')) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some((v) => v !== '')) lignes.push(ligne);
  return lignes;
}

const MOIS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  janv: 0, fevr: 1, fev: 1, mars: 2, avr: 3, mai: 4, juin: 5, juil: 6, aout: 7, sept: 8,
};
const sansAccents = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Date du CSV Strava (en UTC), en anglais « Oct 12, 2026, 8:36:11 AM »
 * ou en français « 12 oct. 2026, 08:36:11 ». Renvoie des ms ou null.
 */
export function dateStrava(t) {
  if (!t) return null;
  t = t.trim();
  let m = t.match(/^([A-Za-z]+)\.? (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?$/i);
  let jour, mois, an, h, min, s;
  if (m) {
    [, mois, jour, an, h, min, s] = m;
    const ampm = m[7]?.toUpperCase();
    h = Number(h);
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
  } else {
    m = t.match(/^(\d{1,2}) ([^\s.\d]+)\.? (\d{4}),?(?: à)? (\d{1,2}):(\d{2}):(\d{2})$/i);
    if (m) [, jour, mois, an, h, min, s] = m;
  }
  if (m) {
    const cle = sansAccents(mois);
    const n = MOIS[cle] ?? MOIS[cle.slice(0, 4)] ?? MOIS[cle.slice(0, 3)];
    if (n === undefined) return null;
    return Date.UTC(Number(an), n, Number(jour), Number(h), Number(min), Number(s));
  }
  const iso = Date.parse(t);
  return Number.isNaN(iso) ? null : iso;
}

// Types Strava (anglais et français) -> [sport FIT, sous-sport, nom affiché]. L'ordre compte :
// les types précis passent avant les types généraux (« Virtual Run » avant « Run »).
const TYPES = [
  [/virtual ?ride|v[ée]lo virtuel|sortie [àa] v[ée]lo virtuelle/i, 2, 58, 'Vélo virtuel'],
  [/virtual ?run|course virtuelle/i, 1, 1, 'Course virtuelle'],
  [/virtual ?row|aviron virtuel/i, 15, 0, 'Aviron virtuel'],
  [/e-?mountain|vtt [ée]lectrique/i, 21, 0, 'VTT électrique'],
  [/e-?bike|[ée]lectrique/i, 21, 0, 'Vélo électrique'],
  [/mountain|vtt/i, 2, 8, 'VTT'],
  [/gravel/i, 2, 46, 'Gravel'],
  [/hand ?cycle|handbike/i, 2, 0, 'Handbike'],
  [/velomobile|v[ée]lomobile/i, 2, 0, 'Vélomobile'],
  [/^ride$|^v[ée]lo$|sortie [àa] v[ée]lo/i, 2, 0, 'Vélo'],
  [/trail/i, 1, 3, 'Trail'],
  [/run|course/i, 1, 0, 'Course à pied'],
  [/walk|marche/i, 11, 0, 'Marche'],
  [/hike|randonn/i, 17, 0, 'Randonnée'],
  [/wheelchair|fauteuil/i, 65, 0, 'Fauteuil roulant'],
  [/swim|natation/i, 5, 0, 'Natation'],
  [/weight|musculation|renforcement/i, 10, 20, 'Musculation'],
  [/high ?intensity|hiit/i, 10, 0, 'HIIT'],
  [/crossfit/i, 10, 0, 'Crossfit'],
  [/yoga/i, 10, 43, 'Yoga'],
  [/pilates/i, 10, 44, 'Pilates'],
  [/elliptical|elliptique/i, 4, 15, 'Elliptique'],
  [/stair|stepper/i, 4, 16, 'Stepper'],
  [/workout|training|entra[iî]nement/i, 10, 0, 'Entraînement'],
  [/alpine ?ski|ski alpin/i, 13, 0, 'Ski alpin'],
  [/backcountry|ski de randonn/i, 13, 0, 'Ski de randonnée'],
  [/roller ?ski|ski [àa] roulettes/i, 12, 0, 'Ski à roulettes'],
  [/nordic|ski de fond|cross.?country ski/i, 12, 0, 'Ski de fond'],
  [/snowboard|planche [àa] neige/i, 14, 0, 'Snowboard'],
  [/snowshoe|raquettes? [àa] neige|^raquettes?$/i, 35, 0, 'Raquettes à neige'],
  [/kayak/i, 41, 0, 'Kayak'],
  [/cano[eë]/i, 19, 0, 'Canoë'],
  [/stand.?up|paddle/i, 37, 0, 'Paddle'],
  [/kite/i, 44, 0, 'Kitesurf'],
  [/windsurf|planche [àa] voile/i, 43, 0, 'Planche à voile'],
  [/^surf(ing)?$/i, 38, 0, 'Surf'],
  [/sail|voile/i, 32, 0, 'Voile'],
  [/^row(ing)?$|aviron/i, 15, 0, 'Aviron'],
  [/climb|escalade/i, 31, 0, 'Escalade'],
  [/ice ?skat|patin(age)? [àa] glace/i, 33, 0, 'Patinage'],
  [/inline|roller/i, 30, 0, 'Roller'],
  [/skateboard/i, 0, 0, 'Skateboard'],
  [/golf/i, 25, 0, 'Golf'],
  [/table ?tennis|tennis de table|ping/i, 64, 0, 'Tennis de table'],
  [/tennis/i, 8, 0, 'Tennis'],
  [/badminton/i, 64, 0, 'Badminton'],
  [/squash/i, 64, 0, 'Squash'],
  [/racquetball/i, 64, 0, 'Racquetball'],
  [/pickleball/i, 64, 0, 'Pickleball'],
  [/soccer|football/i, 7, 0, 'Football'],
];

/** Les types d'activité proposés pour une saisie à la main : [{nom, sport, sousSport}] (sport FIT) */
export function typesProposes() {
  const liste = TYPES.map(([, sport, sousSport, nom]) => ({ nom, sport, sousSport }));
  liste.splice(1, 0, { nom: 'Home trainer', sport: 2, sousSport: 6 });
  return liste;
}

export function typeStrava(texte) {
  const t = (texte ?? '').trim();
  for (const [re, sport, sousSport, nomSport] of TYPES) if (re.test(t)) return { sport, sousSport, nomSport };
  return { sport: 0, sousSport: 0, nomSport: t || 'Activité' };
}

function nombre(t) {
  if (t === undefined || t === null) return null;
  t = String(t).trim();
  if (!t) return null;
  if (!t.includes('.')) t = t.replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * activities.csv -> { parFichier: Map(chemin -> infos), sansFichier: infos[] }
 * infos = { idStrava, nom, type, debut, tempsEcouleS, tempsMouvementS, distanceM, denivelePosM }
 */
export function lireActivitesCsv(texte) {
  const [entete = [], ...lignes] = lireCsv(texte.replace(/^﻿/, ''));
  const noms = entete.map((h) => sansAccents(h.trim()));
  const indices = (...cles) => noms.flatMap((h, i) => (cles.includes(h) ? [i] : []));
  const premier = (cles, defaut) => indices(...cles)[0] ?? defaut;

  // Colonnes : par nom (anglais ou français), sinon position habituelle
  const iId = premier(['activity id', "id de l'activite"], 0);
  const iDate = premier(['activity date', "date de l'activite"], 1);
  const iNom = premier(['activity name', "nom de l'activite"], 2);
  const iType = premier(['activity type', "type d'activite"], 3);
  const iEcoule = premier(['elapsed time', 'temps ecoule', 'duree ecoulee'], 5);
  const iMouvement = premier(['moving time', 'temps de deplacement', 'temps en mouvement']);
  // Deux colonnes « Distance » : la première en km, la seconde en mètres
  const iDistances = indices('distance');
  const iDistanceM = iDistances.length >= 2 ? iDistances[iDistances.length - 1] : null;
  const iDplus = premier(['elevation gain', 'denivele positif', 'gain d\'altitude']);
  // Vélo / chaussures choisis sur Strava (colonne 12 dans l'export anglais)
  const iMateriel = premier(['activity gear', "materiel de l'activite", "equipement de l'activite", 'materiel'],
    noms[11] === undefined ? undefined : 11);

  const parFichier = new Map();
  const sansFichier = [];
  for (const l of lignes) {
    const fichier = l.find((v) => /^activities\/\S/i.test(v.trim()))?.trim() ?? null;
    const infos = {
      idStrava: l[iId]?.trim() || null,
      nom: l[iNom]?.trim() || null,
      type: l[iType]?.trim() || null,
      debut: dateStrava(l[iDate]),
      tempsEcouleS: nombre(l[iEcoule]),
      tempsMouvementS: iMouvement !== undefined ? nombre(l[iMouvement]) : null,
      distanceM: iDistanceM !== null ? nombre(l[iDistanceM]) : null,
      denivelePosM: iDplus !== undefined ? nombre(l[iDplus]) : null,
      materiel: (iMateriel !== undefined && l[iMateriel]?.trim()) || null,
      fichier,
    };
    if (fichier) parFichier.set(fichier.toLowerCase(), infos);
    else sansFichier.push(infos);
  }
  return { parFichier, sansFichier };
}

/** Résumé d'une sortie saisie à la main sur Strava (pas de trace). */
export function resumerSansTrace(infos) {
  const { sport, sousSport, nomSport } = typeStrava(infos.type);
  const dureeChronoS = infos.tempsMouvementS ?? infos.tempsEcouleS;
  return {
    id: `strava-${infos.idStrava}`,
    nomFichier: null,
    nom: infos.nom,
    source: 'strava',
    sansTrace: true,
    debut: infos.debut,
    sport, sousSport, nomSport,
    dureeChronoS,
    dureeTotaleS: infos.tempsEcouleS,
    distanceM: infos.distanceM || null,
    denivelePosM: infos.denivelePosM != null ? Math.round(infos.denivelePosM) : null,
    vitesseMoyMs: infos.distanceM && dureeChronoS ? infos.distanceM / dureeChronoS : null,
    puissanceMoyW: null, puissanceNormW: null, puissanceMaxW: null, tss: null, facteurIntensite: null,
    fcMoy: null, fcMax: null, cadenceMoy: null, calories: null, temperatureMoy: null, ftpCompteurW: null,
    nbPoints: 0, nbTours: 0, trace: [],
  };
}
