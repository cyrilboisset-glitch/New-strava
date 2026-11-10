// Résumé d'une sortie à partir d'un FIT décodé : ce qu'affiche la liste.
import { valeursTrace } from './couleurs-trace.js';

const SPORTS = {
  0: 'Activité', 1: 'Course à pied', 2: 'Vélo', 5: 'Natation', 10: 'Entraînement',
  11: 'Marche', 17: 'Randonnée', 21: 'Vélo électrique',
};
const SOUS_SPORTS_VELO = { 6: 'Home trainer', 7: 'Vélo de route', 8: 'VTT', 46: 'Gravel', 58: 'Vélo virtuel' };
const SOUS_SPORTS_COURSE = { 1: 'Tapis de course', 3: 'Trail' };
const SOUS_SPORT_MUSCULATION = 20; // FIT : sub_sport strength_training

export function nomSport(sport, sousSport) {
  if (sport === 2 && SOUS_SPORTS_VELO[sousSport]) return SOUS_SPORTS_VELO[sousSport];
  if (sport === 1 && SOUS_SPORTS_COURSE[sousSport]) return SOUS_SPORTS_COURSE[sousSport];
  if (sport === 10 && sousSport === SOUS_SPORT_MUSCULATION) return 'Musculation';
  return SPORTS[sport] ?? 'Activité';
}

// Familles d'activités pour le tri de la liste. Tous les vélos (route,
// gravel, VTT, home trainer, virtuel, électrique) vont dans « Vélo ».
const FAMILLES = {
  2: 'Vélo', 21: 'Vélo', 1: 'Course à pied', 11: 'Marche', 17: 'Randonnée', 5: 'Natation', 10: 'Entraînement',
};

/** Famille d'une sortie : { cle, nom } */
export function familleSortie(s) {
  if (s.sport === 10 && s.sousSport === SOUS_SPORT_MUSCULATION) return { cle: 'musculation', nom: 'Musculation' };
  if (FAMILLES[s.sport]) return { cle: `sport-${s.sport === 21 ? 2 : s.sport}`, nom: FAMILLES[s.sport] };
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
    traceValeurs: valeursTrace(recs),
  };
}
