// Création de parcours : calcul de route vélo (BRouter, en ligne), fichier
// GPX, dénivelé et temps estimé. Seuls les points placés sur la carte sont
// envoyés au service de calcul de route ; rien des sorties.
// Les fonctions de calcul n'utilisent pas le navigateur : testées dans Node
// (tests/test-routage.mjs).
import { MODELE } from './puissance-estimee.js';

export const ADRESSE_BROUTER = 'https://brouter.de/brouter';
// Profils de BRouter proposés (noms des profils standard du serveur)
export const PROFILS = {
  fastbike: 'Route (rapide)',
  trekking: 'Vélo (petites routes)',
  safety: 'Le plus tranquille',
  droit: 'Ligne droite (sans calcul)',
};
const M_PAR_DEG = 111195;
export const VITESSE_MAXI_DESCENTE_MS = 60 / 3.6; // comme Parcours 3D

export function distanceM([la1, lo1], [la2, lo2]) {
  const kx = Math.cos((((la1 + la2) / 2) * Math.PI) / 180);
  return Math.hypot((la2 - la1) * M_PAR_DEG, (lo2 - lo1) * M_PAR_DEG * kx);
}

/** Adresse de la demande à BRouter (lonlats : « lon,lat|lon,lat|… ») */
export function urlBRouter(points, profil) {
  const lonlats = points.map(([la, lo]) => `${lo.toFixed(6)},${la.toFixed(6)}`).join('|');
  return `${ADRESSE_BROUTER}?lonlats=${lonlats}&profile=${encodeURIComponent(profil)}&alternativeidx=0&format=geojson`;
}

/** Réponse GeoJSON de BRouter -> { coords: [lat, lon, ele][], distanceM, denivelePosM } */
export function lireReponseBRouter(geojson) {
  const f = geojson?.features?.[0];
  const c = f?.geometry?.coordinates;
  if (!Array.isArray(c) || c.length < 2) throw new Error('réponse du calcul de route illisible');
  const coords = c.map(([lo, la, ele]) => [la, lo, typeof ele === 'number' ? ele : null]);
  const p = f.properties ?? {};
  const longueur = Number(p['track-length']);
  const montee = Number(p['filtered ascend']);
  return {
    coords,
    distanceM: Number.isFinite(longueur) && longueur > 0 ? longueur : longueurTrace(coords),
    denivelePosM: Number.isFinite(montee) ? montee : denivele(coords).plus,
  };
}

/** Sans calcul de route : segments droits entre les points (pas d'altitude) */
export function traceDroite(points) {
  return { coords: points.map(([la, lo]) => [la, lo, null]), distanceM: longueurTrace(points), denivelePosM: null };
}

export function longueurTrace(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += distanceM(coords[i - 1], coords[i]);
  return d;
}

/** Dénivelés avec un seuil de 2 m (comme les sorties) */
export function denivele(coords) {
  const alts = coords.map((c) => c[2]).filter((a) => typeof a === 'number');
  let plus = 0; let moins = 0;
  if (alts.length > 1) {
    let ref = alts[0];
    for (const a of alts) {
      if (a - ref >= 2) { plus += a - ref; ref = a; } else if (ref - a >= 2) { moins += ref - a; ref = a; }
    }
  }
  return { plus: Math.round(plus), moins: Math.round(moins), avecAltitude: alts.length > 1 };
}

// Vitesse (m/s) tenue à puissance constante sur une pente (dichotomie sur
// l'équation des forces : même modèle que la puissance estimée)
export function vitessePourPuissance(puissanceW, pente, masseKg, modele = MODELE) {
  const theta = Math.atan(pente);
  const besoin = (v) => (masseKg * modele.g * (modele.crr * Math.cos(theta) + Math.sin(theta)) * v + 0.5 * modele.rhoKgM3 * modele.cda * v ** 3) / modele.rendement;
  let bas = 0.3; let haut = 30;
  if (besoin(haut) < puissanceW) return Math.min(haut, VITESSE_MAXI_DESCENTE_MS);
  for (let k = 0; k < 60; k++) {
    const v = (bas + haut) / 2;
    if (besoin(v) > puissanceW) haut = v; else bas = v;
  }
  return Math.min((bas + haut) / 2, VITESSE_MAXI_DESCENTE_MS);
}

/**
 * Temps estimé à puissance constante (s), sans vent ni arrêts (ordre de grandeur).
 * Pente lissée sur ±50 m pour ne pas suivre le bruit de l'altitude.
 */
export function tempsEstimeS(coords, puissanceW, poidsKg, modele = MODELE) {
  const masse = poidsKg + modele.masseVeloKg;
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distanceM(coords[i - 1], coords[i]));
  const avecAlt = coords.every((c) => typeof c[2] === 'number');
  let t = 0; let a = 0; let b = 0;
  for (let i = 1; i < coords.length; i++) {
    const ds = cum[i] - cum[i - 1];
    if (ds <= 0) continue;
    let pente = 0;
    if (avecAlt) {
      const milieu = (cum[i] + cum[i - 1]) / 2;
      while (cum[a] < milieu - 50) a++;
      while (b < coords.length - 1 && cum[b + 1] <= milieu + 50) b++;
      const dd = cum[b] - cum[a];
      if (dd > 20) pente = Math.max(-0.25, Math.min(0.25, (coords[b][2] - coords[a][2]) / dd));
    }
    t += ds / vitessePourPuissance(puissanceW, pente, masse, modele);
  }
  return t;
}

const echapperXml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** Fichier GPX 1.1 (une trace) lisible par les compteurs et les applis ; departMs : départ prévu */
export function gpxDepuisTrace(nom, coords, { departMs = null } = {}) {
  const pts = coords.map(([la, lo, ele]) =>
    `      <trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}">${typeof ele === 'number' ? `<ele>${ele.toFixed(1)}</ele>` : ''}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GOATout" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${echapperXml(nom)}</name>${departMs ? `<desc>Départ prévu</desc><time>${new Date(departMs).toISOString().replace('.000', '')}</time>` : ''}</metadata>
  <trk>
    <name>${echapperXml(nom)}</name>
    <type>cycling</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

/**
 * GPX 1.1 d'une sortie enregistrée (points de pointsDetail) : position, altitude, heure,
 * puissance, FC et cadence (extensions Garmin, lues par Strava et les autres applis).
 */
export function gpxDepuisSortie(nom, pts, debutMs, { velo = true } = {}) {
  const heure = (tS) => new Date(debutMs + tS * 1000).toISOString().replace('.000', '');
  const lignes = pts.filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number').map((p) => {
    const ext = [
      typeof p.puissanceW === 'number' ? `<power>${Math.round(p.puissanceW)}</power>` : '',
      typeof p.fc === 'number' || typeof p.cadence === 'number'
        ? `<gpxtpx:TrackPointExtension>${typeof p.fc === 'number' ? `<gpxtpx:hr>${Math.round(p.fc)}</gpxtpx:hr>` : ''}${typeof p.cadence === 'number' ? `<gpxtpx:cad>${Math.round(p.cadence)}</gpxtpx:cad>` : ''}</gpxtpx:TrackPointExtension>`
        : '',
    ].join('');
    return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${typeof p.altitudeM === 'number' ? `<ele>${p.altitudeM.toFixed(1)}</ele>` : ''}<time>${heure(p.tS)}</time>${ext ? `<extensions>${ext}</extensions>` : ''}</trkpt>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GOATout" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>${echapperXml(nom)}</name><time>${heure(0)}</time></metadata>
  <trk>
    <name>${echapperXml(nom)}</name>${velo ? '\n    <type>cycling</type>' : ''}
    <trkseg>
${lignes}
    </trkseg>
  </trk>
</gpx>
`;
}

/**
 * Lecture d'un GPX de parcours (trace <trkpt> ou itinéraire <rtept>, heures facultatives)
 * pour la bibliothèque de tracés.
 * @returns {{nom: string|null, coords: [lat, lon, ele|null][], distanceM, denivelePosM}}
 */
export function lireGpxParcours(texte) {
  const attr = (a, n) => { const m = a.match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']+)["']`)); return m ? Number(m[1]) : NaN; };
  const points = (balise) => {
    const res = [];
    const re = new RegExp(`<${balise}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${balise}>)`, 'gi');
    let m;
    while ((m = re.exec(texte))) {
      const la = attr(m[1], 'lat'); const lo = attr(m[1], 'lon');
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      const e = m[2]?.match(/<ele>\s*([-\d.]+)\s*<\/ele>/i);
      res.push([la, lo, e ? Number(e[1]) : null]);
    }
    return res;
  };
  let coords = points('trkpt');
  if (coords.length < 2) coords = points('rtept');
  if (coords.length < 2) throw new Error('pas de trace ni d\'itinéraire dans ce fichier');
  // nom : celui de la trace (ou de l'itinéraire), sinon celui des métadonnées
  const bloc = texte.match(/<(trk|rte)\b[\s\S]*?<(trkseg|trkpt|rtept)\b/i)?.[0] ?? '';
  const nomBrut = (bloc.match(/<name>([\s\S]*?)<\/name>/i) ?? texte.match(/<metadata>[\s\S]*?<name>([\s\S]*?)<\/name>/i))?.[1];
  const nom = nomBrut ? nomBrut.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim() || null : null;
  const dn = denivele(coords);
  return { nom, coords, distanceM: longueurTrace(coords), denivelePosM: dn.avecAltitude ? dn.plus : null };
}

/** Nom de fichier sûr : « Boucle du Vercors » -> « boucle-du-vercors.gpx » */
export function nomFichierGpx(nom) {
  const base = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base || 'parcours'}.gpx`;
}

/** Calcul de route en ligne ; lève une erreur lisible si le réseau ou le service manque */
export async function calculerRoute(points, profil, attente = fetch) {
  if (profil === 'droit' || points.length < 2) return traceDroite(points);
  let r;
  try {
    r = await attente(urlBRouter(points, profil));
  } catch {
    throw new Error('pas de réseau ou service de calcul de route injoignable');
  }
  if (!r.ok) throw new Error(`le calcul de route a échoué (${r.status})`);
  return lireReponseBRouter(await r.json());
}
