// Résumé d'une sortie à partir d'un FIT décodé : ce qu'affiche la liste.

// Sports du FIT (numéros du fabricant) -> nom affiché
const SPORTS = {
  0: 'Activité', 1: 'Course à pied', 2: 'Vélo', 4: 'Fitness', 5: 'Natation', 6: 'Basket', 7: 'Football', 8: 'Tennis',
  9: 'Football américain', 10: 'Entraînement', 11: 'Marche', 12: 'Ski de fond', 13: 'Ski alpin', 14: 'Snowboard',
  15: 'Aviron', 16: 'Alpinisme', 17: 'Randonnée', 19: 'Canoë', 21: 'Vélo électrique', 25: 'Golf', 30: 'Roller',
  31: 'Escalade', 32: 'Voile', 33: 'Patinage', 35: 'Raquettes à neige', 37: 'Paddle', 38: 'Surf', 41: 'Kayak',
  43: 'Planche à voile', 44: 'Kitesurf', 64: 'Sport de raquette', 65: 'Fauteuil roulant',
};
const SOUS_SPORTS_FITNESS = { 14: 'Rameur', 15: 'Elliptique', 16: 'Stepper' };
const SOUS_SPORTS_ENTRAINEMENT = { 20: 'Musculation', 43: 'Yoga', 44: 'Pilates' };
const SOUS_SPORTS_VELO = { 6: 'Home trainer', 7: 'Vélo de route', 8: 'VTT', 46: 'Gravel', 58: 'Vélo virtuel' };
const SOUS_SPORTS_COURSE = { 1: 'Tapis de course', 3: 'Trail' };
const SOUS_SPORT_MUSCULATION = 20; // FIT : sub_sport strength_training

export function nomSport(sport, sousSport) {
  if (sport === 2 && SOUS_SPORTS_VELO[sousSport]) return SOUS_SPORTS_VELO[sousSport];
  if (sport === 1 && SOUS_SPORTS_COURSE[sousSport]) return SOUS_SPORTS_COURSE[sousSport];
  if (sport === 10 && SOUS_SPORTS_ENTRAINEMENT[sousSport]) return SOUS_SPORTS_ENTRAINEMENT[sousSport];
  if (sport === 4 && SOUS_SPORTS_FITNESS[sousSport]) return SOUS_SPORTS_FITNESS[sousSport];
  return SPORTS[sport] ?? 'Activité';
}

// Familles d'activités pour le tri de la liste et le menu Activité (une icône par famille).
// Le nom exact du sport (Ski alpin, Kayak, Pilates…) reste affiché sur la sortie ; le vélo
// virtuel a sa propre famille (voir plus bas). Un sport sans famille (type inconnu) a la
// sienne, sous son nom.
const FAMILLES = {
  2: 'Vélo', 21: 'Vélo', 1: 'Course à pied', 11: 'Marche', 17: 'Randonnée', 5: 'Natation', 10: 'Entraînement',
  4: 'Entraînement', // appareils de fitness : elliptique, stepper, rameur
};
// Familles regroupant plusieurs sports FIT : { clé, nom, sports }
const GROUPES = [
  { cle: 'neige', nom: 'Ski et neige', sports: [12, 13, 14, 35] },
  { cle: 'eau', nom: "Sports d'eau", sports: [15, 19, 32, 37, 38, 41, 43, 44] },
  { cle: 'balle', nom: 'Balle et raquette', sports: [6, 7, 8, 9, 25, 64] },
  { cle: 'escalade', nom: 'Escalade', sports: [16, 31] },
  { cle: 'glisse', nom: 'Patins et glisse', sports: [30, 33] },
];
// Sports sans numéro FIT (sport 0) reconnus par leur nom
const PAR_NOM = [[/skateboard/i, 'glisse']];

// Vélo virtuel (home trainer, Zwift…) : sport « vélo » avec le sous-sport home trainer ou virtuel.
// Deux modes, au choix de Cyril pour chaque sortie (`modeVirtuel`) :
//  - 'workout' (par défaut) : séance sur home trainer. Seul le temps compte : ni segments, ni distance,
//    ni dénivelé dans les totaux et les objectifs ;
//  - 'parcours' : parcours réel suivi en virtuel (fichier GPX). Les segments comptent, leur temps
//    est marqué d'une étoile pour dire que c'est une sortie virtuelle.
export const estVirtuel = (s) => s.sport === 2 && (s.sousSport === 6 || s.sousSport === 58);
export const modeVirtuel = (s) => (!estVirtuel(s) ? null : s.modeVirtuel === 'parcours' ? 'parcours' : 'workout');
export const estWorkoutVirtuel = (s) => modeVirtuel(s) === 'workout';
/** Distance et dénivelé qu'une sortie ajoute aux totaux : rien pour un workout virtuel */
export const distanceCompteeM = (s) => (estWorkoutVirtuel(s) ? 0 : s.distanceM ?? 0);
export const denivelePosCompteM = (s) => (estWorkoutVirtuel(s) ? 0 : s.denivelePosM ?? 0);

/** Famille d'une sortie : { cle, nom } */
export function familleSortie(s) {
  if (estVirtuel(s)) return { cle: 'velo-virtuel', nom: 'Vélo virtuel (home trainer)' };
  if (s.sport === 10 && s.sousSport === SOUS_SPORT_MUSCULATION) return { cle: 'musculation', nom: 'Musculation' };
  if (FAMILLES[s.sport]) {
    const cle = s.sport === 4 ? 10 : s.sport === 21 ? 2 : s.sport;
    return { cle: `sport-${cle}`, nom: FAMILLES[s.sport] };
  }
  const groupe = GROUPES.find((g) => g.sports.includes(s.sport)) ?? (s.sport === 0 ? GROUPES.find((g) => PAR_NOM.some(([re, c]) => c === g.cle && re.test(s.nomSport ?? ''))) : null);
  if (groupe) return { cle: groupe.cle, nom: groupe.nom };
  // Types Strava inconnus (Kitesurf, Yoga…) : chacun sa famille, sous son nom
  const nom = s.nomSport && s.nomSport !== 'Activité' ? s.nomSport : 'Autre';
  return { cle: `autre-${nom}`, nom };
}

// Identifiant stable : numéro de série du compteur + heure de création du
// fichier. Le même fichier trouvé deux fois (deux zips successifs) garde
// le même identifiant : pas de doublon.
export function identifiantSortie(fit) {
  const f = fit.fileId ?? {};
  const t = f.creation?.getTime() ?? fit.session?.debut?.getTime() ?? fit.records[0]?.horodatage?.getTime();
  if (t === undefined) return null;
  return `${f.numeroSerie ?? 0}-${t}`;
}

// Trace simplifiée (au plus `max` points) pour la vignette de la liste.
export function traceSimplifiee(records, max = 160) {
  const pts = records.filter((r) => typeof r.lat === 'number' && typeof r.lon === 'number');
  if (pts.length < 2) return [];
  const pas = Math.max(1, Math.ceil(pts.length / (max - 1)));
  const res = [];
  for (let i = 0; i < pts.length; i += pas) res.push(pts[i]);
  if (res[res.length - 1] !== pts[pts.length - 1]) res.push(pts[pts.length - 1]);
  return res.map((r) => [Math.round(r.lat * 1e5) / 1e5, Math.round(r.lon * 1e5) / 1e5]);
}

/**
 * @param {ReturnType<import('./fit.js').lireFit>} fit
 * @param {string} nomFichier
 */
export function resumerSortie(fit, nomFichier) {
  const s = fit.session ?? {};
  const recs = fit.records;
  const premier = recs[0];
  const dernier = recs[recs.length - 1];
  const debut = s.debut ?? premier?.horodatage ?? fit.fileId?.creation;
  const dureeTotaleS = s.dureeTotaleS ??
    (premier && dernier ? (dernier.horodatage - premier.horodatage) / 1000 : null);
  const sport = s.sport ?? fit.sport?.sport ?? 0;
  const sousSport = s.sousSport ?? fit.sport?.sousSport ?? 0;
  const aPuissance = recs.some((r) => r.puissanceW > 0);
  const aFc = recs.some((r) => r.fc > 0);

  return {
    id: identifiantSortie(fit),
    nomFichier,
    debut: debut ? debut.getTime() : null,
    sport,
    sousSport,
    nomSport: nomSport(sport, sousSport),
    dureeChronoS: s.dureeChronoS ?? s.dureeMouvementS ?? dureeTotaleS,
    dureeTotaleS,
    distanceM: s.distanceM ?? dernier?.distanceM ?? null,
    denivelePosM: s.denivelePosM ?? null,
    vitesseMoyMs: s.vitesseMoyMs ?? null,
    puissanceMoyW: aPuissance ? (s.puissanceMoyW ?? null) : null,
    puissanceNormW: aPuissance ? (s.puissanceNormW ?? null) : null,
    puissanceMaxW: aPuissance ? (s.puissanceMaxW ?? null) : null,
    tss: s.tss ?? null,
    facteurIntensite: s.facteurIntensite ?? null,
    fcMoy: aFc ? (s.fcMoy ?? null) : null,
    fcMax: aFc ? (s.fcMax ?? null) : null,
    cadenceMoy: s.cadenceMoy ?? null,
    calories: s.calories ?? null,
    temperatureMoy: s.temperatureMoy ?? null,
    ftpCompteurW: fit.zones?.ftpW ?? null,
    nbPoints: recs.length,
    nbTours: fit.laps.length,
    trace: traceSimplifiee(recs),
  };
}
