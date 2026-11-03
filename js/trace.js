// Lecture des traces GPX et TCX (archive Strava) et calcul du résumé
// d'une sortie à partir des points, quand il n'y a pas de FIT.
import { traceSimplifiee } from './sortie.js';

const RAYON_TERRE_M = 6371000;
const SEUIL_MOUVEMENT_MS = 0.8; // en dessous : à l'arrêt (≈ 2,9 km/h)
const TROU_MAX_S = 10; // au-delà : pause, les secondes du trou ne comptent pas
const HYSTERESIS_DPLUS_M = 2; // montée comptée par paliers d'au moins 2 m

export function distanceM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---- Petit lecteur XML par expressions régulières ------------------------
// Suffisant pour GPX/TCX (structure simple) et marche aussi dans Node.

function balise(xml, nom) {
  // nom sans préfixe : accepte <hr>, <gpxtpx:hr>, <ns3:Watts>…
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${nom}(?:\\s[^>]*)?>([^<]*)<`, 'i'));
  return m ? m[1].trim() : null;
}

function nombre(xml, nom) {
  const t = balise(xml, nom);
  if (t === null || t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function blocs(xml, nom) {
  return xml.match(new RegExp(`<(?:[\\w-]+:)?${nom}[\\s>][\\s\\S]*?</(?:[\\w-]+:)?${nom}>`, 'gi')) ?? [];
}

function attribut(debutBalise, nom) {
  const m = debutBalise.match(new RegExp(`\\s${nom}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? Number(m[1]) : null;
}

function point(horodatage, lat, lon, x) {
  const p = { horodatage };
  if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) { p.lat = lat; p.lon = lon; }
  const alt = nombre(x, 'ele') ?? nombre(x, 'AltitudeMeters');
  if (alt !== null) p.altitudeM = alt;
  const fc = nombre(x, 'hr') ?? nombre(x, 'heartrate') ?? nombre(x.match(/<HeartRateBpm\b[\s\S]*?<\/HeartRateBpm>/i)?.[0] ?? '', 'Value');
  if (fc !== null) p.fc = fc;
  const cad = nombre(x, 'cad') ?? nombre(x, 'cadence') ?? nombre(x, 'RunCadence');
  if (cad !== null) p.cadence = cad;
  const pw = nombre(x, 'power') ?? nombre(x, 'Watts');
  if (pw !== null) p.puissanceW = pw;
  const temp = nombre(x, 'atemp') ?? nombre(x, 'temp');
  if (temp !== null) p.temperature = temp;
  return p;
}

function dateValide(t) {
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

const SPORTS_TEXTE = [
  [/bik|cycl|ride|velo|vélo/i, 2], [/run|course/i, 1], [/walk|marche/i, 11], [/hik|rando/i, 17], [/swim|natation/i, 5],
];
function sportDepuisTexte(t) {
  if (!t) return null;
  for (const [re, sport] of SPORTS_TEXTE) if (re.test(t)) return sport;
  return null; // codes numériques de Strava, etc. : le CSV décide
}

/** GPX -> { records, nom, sport } */
export function lireGpx(texte) {
  const records = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
  let m;
  while ((m = re.exec(texte))) {
    const d = dateValide(balise(m[2], 'time'));
    if (!d) continue;
    records.push(point(d, attribut(m[1], 'lat'), attribut(m[1], 'lon'), m[2]));
  }
  const trk = blocs(texte, 'trk')[0] ?? '';
  const entete = trk.split(/<trkseg/i)[0];
  return { records, nom: balise(entete, 'name'), sport: sportDepuisTexte(balise(entete, 'type')) };
}

/** TCX -> { records, nom, sport } */
export function lireTcx(texte) {
  const records = [];
  for (const tp of blocs(texte, 'Trackpoint')) {
    const d = dateValide(balise(tp, 'Time'));
    if (!d) continue;
    const p = point(d, nombre(tp, 'LatitudeDegrees'), nombre(tp, 'LongitudeDegrees'), tp);
    const dist = nombre(tp, 'DistanceMeters');
    if (dist !== null) p.distanceM = dist;
    records.push(p);
  }
  const act = texte.match(/<Activity\b[^>]*Sport\s*=\s*["']([^"']*)["']/i);
  return { records, nom: null, sport: sportDepuisTexte(act?.[1]) };
}

// ---- Calculs ------------------------------------------------------------

// Remplit seconde par seconde (valeur tenue jusqu'au point suivant) en
// sautant les trous de plus de TROU_MAX_S. Renvoie le tableau des valeurs.
function parSeconde(records, champ) {
  const res = [];
  for (let i = 0; i < records.length - 1; i++) {
    const v = records[i][champ];
    const dt = Math.round((records[i + 1].horodatage - records[i].horodatage) / 1000);
    if (dt <= 0 || dt > TROU_MAX_S) continue;
    for (let k = 0; k < dt; k++) res.push(typeof v === 'number' ? v : 0);
  }
  return res;
}

// Puissance normalisée : moyenne glissante sur 30 s, puissance 4, moyenne, racine 4.
export function puissanceNormalisee(secondes) {
  if (secondes.length < 30) return null;
  let somme = 0;
  let total4 = 0;
  for (let i = 0; i < secondes.length; i++) {
    somme += secondes[i];
    if (i >= 30) somme -= secondes[i - 30];
    if (i >= 29) total4 += (somme / 30) ** 4;
  }
  return (total4 / (secondes.length - 29)) ** 0.25;
}

const moyenne = (t) => (t.length ? t.reduce((a, v) => a + v, 0) / t.length : null);
const arrondi = (v) => (v === null ? null : Math.round(v));

/**
 * Résumé d'une sortie à partir de points (GPX/TCX), même forme que resumerSortie().
 * @param {{horodatage: Date, lat?, lon?, altitudeM?, fc?, cadence?, puissanceW?, distanceM?}[]} records
 */
export function resumerTrace(records, { id, nomFichier, sport = 0, sousSport = 0, nomSport = 'Activité' }) {
  const recs = records.slice().sort((a, b) => a.horodatage - b.horodatage);
  const premier = recs[0];
  const dernier = recs[recs.length - 1];

  // Distance cumulée : celle du fichier (TCX) si présente, sinon calculée
  const avecDistance = recs.some((r) => typeof r.distanceM === 'number');
  let cumul = 0;
  let precedentGps = null;
  for (const r of recs) {
    if (avecDistance) { if (typeof r.distanceM === 'number') cumul = Math.max(cumul, r.distanceM); }
    else if (typeof r.lat === 'number') {
      if (precedentGps) cumul += distanceM(precedentGps, r);
      precedentGps = r;
    }
    r.distanceM = cumul;
  }

  // Temps en mouvement : segments où la vitesse dépasse le seuil
  let mouvementS = 0;
  for (let i = 1; i < recs.length; i++) {
    const dt = (recs[i].horodatage - recs[i - 1].horodatage) / 1000;
    if (dt <= 0) continue;
    if ((recs[i].distanceM - recs[i - 1].distanceM) / dt >= SEUIL_MOUVEMENT_MS) mouvementS += dt;
  }

  // Dénivelé positif avec hystérésis (évite de compter le bruit d'altitude)
  let dplus = null;
  const alts = recs.map((r) => r.altitudeM).filter((a) => typeof a === 'number');
  if (alts.length > 1) {
    dplus = 0;
    let ref = alts[0];
    for (const a of alts) {
      if (a - ref >= HYSTERESIS_DPLUS_M) { dplus += a - ref; ref = a; }
      else if (a < ref) ref = a;
    }
  }

  const puissance = recs.some((r) => r.puissanceW > 0) ? parSeconde(recs, 'puissanceW') : [];
  const fcs = parSeconde(recs, 'fc').filter((v) => v > 0);
  const cadences = parSeconde(recs, 'cadence').filter((v) => v > 0);
  const temps = recs.map((r) => r.temperature).filter((v) => typeof v === 'number');
  const max = (champ) => {
    const v = recs.map((r) => r[champ]).filter((x) => typeof x === 'number' && x > 0);
    return v.length ? Math.max(...v) : null;
  };

  const dureeTotaleS = (dernier.horodatage - premier.horodatage) / 1000;
  const distanceTotaleM = dernier.distanceM || null;
  return {
    id,
    nomFichier,
    debut: premier.horodatage.getTime(),
    sport,
    sousSport,
    nomSport,
    dureeChronoS: mouvementS || dureeTotaleS,
    dureeTotaleS,
    distanceM: distanceTotaleM,
    denivelePosM: dplus === null ? null : Math.round(dplus),
    vitesseMoyMs: distanceTotaleM && mouvementS ? distanceTotaleM / mouvementS : null,
    puissanceMoyW: puissance.length ? arrondi(moyenne(puissance)) : null,
    puissanceNormW: puissance.length ? arrondi(puissanceNormalisee(puissance)) : null,
    puissanceMaxW: puissance.length ? max('puissanceW') : null,
    tss: null,
    facteurIntensite: null,
    fcMoy: fcs.length ? arrondi(moyenne(fcs)) : null,
    fcMax: max('fc'),
    cadenceMoy: cadences.length ? arrondi(moyenne(cadences)) : null,
    calories: null,
    temperatureMoy: temps.length ? arrondi(moyenne(temps)) : null,
    ftpCompteurW: null,
    nbPoints: recs.length,
    nbTours: 0,
    trace: traceSimplifiee(recs),
  };
}
