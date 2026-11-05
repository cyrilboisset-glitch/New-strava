// Noms proposés pour les tracés et les segments, avec les lieux d'OpenStreetMap
// (accord de Cyril le 5 nov. 2026) :
// - Nominatim (nominatim.openstreetmap.org) : commune la plus proche d'un point ;
// - Overpass (overpass-api.de) : col, sommet ou passage nommé à moins de 300 m.
// Seuls quelques points sont envoyés (départ, sommet, arrivée…), jamais une sortie.
// Réponses gardées dans le réglage « lieux » (pas de nouvelle demande pour le même
// endroit) ; une demande par seconde au plus (règle d'usage de Nominatim).
// Sans réseau : noms faits avec les chiffres (« Montée de 3,0 km à 5,9 % »).
import { nombre, km } from './format.js';

export const ADRESSE_NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
export const ADRESSE_OVERPASS = 'https://overpass-api.de/api/interpreter';
export const RAYON_COL_M = 300;
const BOUCLE_M = 300; // départ et arrivée à moins de 300 m : boucle

// ---- Adresses et lecture des réponses (sans navigateur, testées) ----------------------

export function urlNominatim(lat, lon) {
  return `${ADRESSE_NOMINATIM}?format=jsonv2&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=13&addressdetails=1&accept-language=fr`;
}

/** Commune (ou village, hameau…) d'une réponse Nominatim */
export function lireNominatim(json) {
  const a = json?.address ?? {};
  return a.village || a.town || a.city || a.municipality || a.hamlet || a.suburb || null;
}

export function urlOverpass(lat, lon, rayonM = RAYON_COL_M) {
  const autour = `(around:${rayonM},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const q = `[out:json][timeout:10];(node${autour}["mountain_pass"="yes"]["name"];node${autour}["natural"="saddle"]["name"];node${autour}["natural"="peak"]["name"];);out;`;
  return `${ADRESSE_OVERPASS}?data=${encodeURIComponent(q)}`;
}

/** Col (ou sommet) nommé le plus proche ; les cols passent avant les sommets */
export function lireOverpass(json, lat, lon) {
  const noeuds = (json?.elements ?? []).filter((e) => e.tags?.name && typeof e.lat === 'number');
  if (!noeuds.length) return null;
  const d = (e) => Math.hypot(e.lat - lat, (e.lon - lon) * Math.cos((lat * Math.PI) / 180));
  const col = (e) => e.tags.mountain_pass === 'yes' || e.tags.natural === 'saddle';
  noeuds.sort((a, b) => (col(b) - col(a)) || d(a) - d(b));
  return noeuds[0].tags.name;
}

// ---- Petite grammaire : « de Voreppe », « d'Uriage », « du Sappey », « du col de Porte » ----

const VOYELLE = /^[aeiouyàâäéèêëîïôöûüœ]/i;
const MASCULIN = /^(col|pas|pic|puy|mont|signal|sommet|plateau|lac|pont)\b/i;
const ARTICLE = /^(?:(les|le|la)\s+|(l['’]))/i;

// « Col de Porte » -> « col de Porte » (nom commun en tête, en minuscule)
const nomCommun = (nom) => nom.replace(MASCULIN, (m) => m.toLowerCase());

/** « de » + nom : de Voreppe, d'Uriage, du Sappey, de la Buisse, des Abrets, du col de Porte */
export function de(nom) {
  const m = nom.match(ARTICLE);
  if (m) {
    const reste = nom.slice(m[0].length);
    const art = (m[1] ?? "l'").toLowerCase();
    return art === 'le' ? `du ${reste}` : art === 'les' ? `des ${reste}` : art === 'la' ? `de la ${reste}` : `de l'${reste}`;
  }
  if (MASCULIN.test(nom)) return `du ${nomCommun(nom)}`;
  return VOYELLE.test(nom) ? `d'${nom}` : `de ${nom}`;
}

/** Nom avec son article : le col de Porte, le Sappey, Voreppe */
export function le(nom) {
  const m = nom.match(ARTICLE);
  if (m) return m[1] ? `${m[1].toLowerCase()} ${nom.slice(m[0].length)}` : `l'${nom.slice(m[0].length)}`;
  return MASCULIN.test(nom) ? `le ${nomCommun(nom)}` : nom;
}

// ---- Noms ------------------------------------------------------------------------------

/**
 * Nom d'un tracé.
 * @param {{boucle: boolean, depart?, arrivee?, col?, loin?, distanceM, deniveleM?}} l
 */
export function nomTrace(l) {
  const par = l.col ? ` par ${le(l.col)}` : '';
  if (l.boucle && l.depart) {
    const via = par || (l.loin && l.loin !== l.depart ? ` par ${le(l.loin)}` : '');
    return `Boucle ${de(l.depart)}${via}`;
  }
  if (!l.boucle && l.depart && l.arrivee && l.depart !== l.arrivee) return `${l.depart} → ${l.arrivee}${par}`;
  const chiffres = `${km(l.distanceM)} km${l.deniveleM >= 50 ? ` · ${nombre(l.deniveleM)} m D+` : ''}`;
  return `${l.boucle ? 'Boucle' : 'Parcours'} de ${chiffres}`;
}

/**
 * Nom d'un segment.
 * @param {{type: 'Montée'|'Descente'|'Plat'|'Sprint', debut?, fin?, col?, distanceM, penteMoyPct?}} l
 *   debut / fin : communes au début et à la fin ; col : col ou sommet nommé en haut
 */
export function nomSegment(l) {
  const lieu = l.debut || l.fin;
  const pente = l.penteMoyPct != null ? ` à ${nombre(Math.abs(l.penteMoyPct), 1)} %` : '';
  if (l.type === 'Montée') {
    if (l.col) return `Montée ${de(l.col)}`;
    if (l.debut && l.fin && l.debut !== l.fin) return `Montée vers ${le(l.fin)}`;
    return lieu ? `Montée ${de(lieu)}` : `Montée de ${km(l.distanceM)} km${pente}`;
  }
  if (l.type === 'Descente') {
    if (l.col) return `Descente ${de(l.col)}`;
    if (l.debut && l.fin && l.debut !== l.fin) return `Descente vers ${le(l.fin)}`;
    return lieu ? `Descente ${de(lieu)}` : `Descente de ${km(l.distanceM)} km${pente}`;
  }
  if (l.type === 'Sprint') return lieu ? `Sprint ${de(lieu)}` : `Sprint de ${nombre(l.distanceM)} m`;
  if (l.debut && l.fin && l.debut !== l.fin) return `${l.debut} → ${l.fin}`;
  return lieu ? `Segment ${de(lieu)}` : `Segment de ${km(l.distanceM)} km`;
}

/** Évite deux fois le même nom dans une liste : « Montée de Voreppe (km 7,5) » */
export function sansDoublons(noms, precisions) {
  return noms.map((n, k) => (noms.indexOf(n) !== noms.lastIndexOf(n) ? `${n} (${precisions[k]})` : n));
}

// ---- Demandes en ligne (navigateur) ------------------------------------------------------

let cache = null;
let derniere = Promise.resolve();
let delaiMs = 1100;
let lireCache = async () => ({});
let ecrireCache = async () => {};

/** Branche le stockage du cache (réglage « lieux ») ; appelé par l'appli. delai : pour les tests */
export function brancherCache(lire, ecrire, delai = 1100) { lireCache = lire; ecrireCache = ecrire; cache = null; delaiMs = delai; }

// une demande à la fois, une par seconde au plus
function enFile(f) {
  const p = derniere.then(f);
  derniere = p.catch(() => {}).then(() => new Promise((ok) => setTimeout(ok, delaiMs)));
  return p;
}

async function demander(cle, url, lire, attente) {
  cache ??= (await lireCache()) ?? {};
  if (cle in cache) return cache[cle];
  const valeur = await enFile(async () => {
    const r = await attente(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`service des lieux : ${r.status}`);
    return lire(await r.json());
  });
  cache[cle] = valeur;
  await ecrireCache(cache);
  return valeur;
}

const cleDe = (type, lat, lon) => `${type}:${lat.toFixed(3)},${lon.toFixed(3)}`;

/** Commune la plus proche, ou null (sans réseau : null, pas gardé) */
export async function communePres(lat, lon, attente = fetch) {
  try { return await demander(cleDe('c', lat, lon), urlNominatim(lat, lon), lireNominatim, attente); } catch { return null; }
}

/** Col ou sommet nommé à moins de 300 m, ou null */
export async function colPres(lat, lon, attente = fetch) {
  try { return await demander(cleDe('o', lat, lon), urlOverpass(lat, lon), (j) => lireOverpass(j, lat, lon), attente); } catch { return null; }
}

const ecart = ([a, b], [c, d]) => Math.hypot((c - a) * 111195, (d - b) * 111195 * Math.cos((a * Math.PI) / 180));

/**
 * Nom proposé pour un tracé.
 * @param {number[][]} coords  [lat, lon, ele?]
 */
export async function proposerNomTrace(coords, distanceM, deniveleM, attente = fetch) {
  const dep = coords[0];
  const arr = coords[coords.length - 1];
  const boucle = ecart(dep, arr) < BOUCLE_M;
  // point le plus haut (s'il domine le départ d'au moins 100 m) et point le plus loin du départ
  let haut = null;
  for (const c of coords) if (typeof c[2] === 'number' && (!haut || c[2] > haut[2])) haut = c;
  if (haut && typeof dep[2] === 'number' && haut[2] - dep[2] < 100) haut = null;
  let loin = dep;
  for (const c of coords) if (ecart(dep, c) > ecart(dep, loin)) loin = c;
  const depart = await communePres(dep[0], dep[1], attente);
  const arrivee = boucle ? depart : await communePres(arr[0], arr[1], attente);
  const col = haut ? await colPres(haut[0], haut[1], attente) : null;
  const lieuLoin = boucle && !col ? await communePres(loin[0], loin[1], attente) : null;
  return nomTrace({ boucle, depart, arrivee, col, loin: lieuLoin, distanceM, deniveleM });
}

/**
 * Nom proposé pour un segment.
 * @param {{points: [lat, lon][], type, distanceM, penteMoyPct?}} seg
 */
export async function proposerNomSegment(seg, attente = fetch) {
  const p0 = seg.points[0];
  const p1 = seg.points[seg.points.length - 1];
  if (seg.type === 'Sprint') {
    const m = seg.points[Math.floor(seg.points.length / 2)];
    return nomSegment({ ...seg, debut: await communePres(m[0], m[1], attente) });
  }
  const debut = await communePres(p0[0], p0[1], attente);
  const fin = await communePres(p1[0], p1[1], attente);
  const haut = seg.type === 'Montée' ? p1 : seg.type === 'Descente' ? p0 : null;
  const col = haut ? await colPres(haut[0], haut[1], attente) : null;
  return nomSegment({ ...seg, debut, fin, col });
}
