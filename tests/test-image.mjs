// Image de la sortie à partager : chiffres, formats, EXIF des photos, place des photos.
// Lancer : TZ=Europe/Paris node tests/test-image.mjs
import { chiffresImage, lireExif, placerPhoto, FORMATS_IMAGE } from '../js/image-sortie.js';

let echecs = 0;
const egal = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
  if (!ok) echecs++;
};

// Formats conseillés par les réseaux
egal('formats : portrait 1080×1350, story 1080×1920, carré 1080×1080, paysage 1200×630',
  Object.values(FORMATS_IMAGE).map((f) => `${f.l}×${f.h}`), ['1080×1350', '1080×1920', '1080×1080', '1200×630']);

// Chiffres : ordre, unités, 6 au plus ; puissance estimée seulement si demandée
const s = { distanceM: 42350, dureeChronoS: 5520, denivelePosM: 652, vitesseMoyMs: 42350 / 5520, puissanceNormW: 212, fcMoy: 141, calories: 980 };
egal('chiffres : distance, temps, D+, vitesse, NP, FC (6 au plus)', chiffresImage(s).map((c) => `${c.label} ${c.valeur} ${c.unite}`.trim()),
  ['Distance 42,4 km', 'Temps 1 h 32', 'Dénivelé 652 m', 'Vitesse moy. 27,6 km/h', 'Puissance NP 212 W', 'FC moyenne 141 bpm']);
egal('chiffres : sans capteur, puissance estimée « ≈ »', chiffresImage({ distanceM: 20000, puissanceEstimee: { normW: 150 } }, { estimee: true }).map((c) => c.valeur), ['20,0', '≈ 150']);
egal('chiffres : home trainer sans distance', chiffresImage({ dureeChronoS: 3600, puissanceMoyW: 180, fcMoy: 130 }).map((c) => c.label), ['Temps', 'Puissance moy.', 'FC moyenne']);

// Fabrique une photo JPEG avec EXIF (petit-boutiste) : date, décalage horaire, GPS
function jpegExif({ date, decalage = null, lat = null, lon = null }) {
  const octets = [];
  const u16 = (v) => { octets.push(v & 255, (v >> 8) & 255); };
  const u32 = (v) => { octets.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255); };
  // TIFF : en-tête, IFD0 à 8 (2 entrées : Exif, GPS), IFD Exif à 38, GPS à 100, données ensuite
  const exifIfd = 38; const gpsIfd = 100; const donnees = 200;
  octets.push(0x49, 0x49); u16(42); u32(8);
  u16(2);
  u16(0x8769); u16(4); u32(1); u32(exifIfd);
  u16(0x8825); u16(4); u32(1); u32(gpsIfd);
  u32(0);
  while (octets.length < exifIfd) octets.push(0);
  const entreesExif = [[0x9003, 2, 20, donnees]];
  if (decalage) entreesExif.push([0x9011, 2, 7, donnees + 20]);
  u16(entreesExif.length);
  for (const [tag, type, n, v] of entreesExif) { u16(tag); u16(type); u32(n); u32(v); }
  u32(0);
  while (octets.length < gpsIfd) octets.push(0);
  const ent = lat == null ? [] : [[1, 2, 2, lat >= 0 ? 0x4e : 0x53], [2, 5, 3, donnees + 40], [3, 2, 2, lon >= 0 ? 0x45 : 0x57], [4, 5, 3, donnees + 64]];
  u16(ent.length);
  for (const [tag, type, n, v] of ent) { u16(tag); u16(type); u32(n); u32(v); }
  u32(0);
  while (octets.length < donnees) octets.push(0);
  for (const c of `${date}\0`) octets.push(c.charCodeAt(0));
  while (octets.length < donnees + 20) octets.push(0);
  if (decalage) for (const c of `${decalage}\0`) octets.push(c.charCodeAt(0));
  while (octets.length < donnees + 40) octets.push(0);
  const dms = (x) => { const a = Math.abs(x); const d = Math.floor(a); const m = Math.floor((a - d) * 60); const sec = Math.round(((a - d) * 60 - m) * 60 * 1000); return [[d, 1], [m, 1], [sec, 1000]]; };
  if (lat != null) { for (const [n, d] of dms(lat)) { u32(n); u32(d); } for (const [n, d] of dms(lon)) { u32(n); u32(d); } }
  const tiff = octets;
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const longueur = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, longueur >> 8, longueur & 255, ...app1, 0xff, 0xd9]).buffer;
}

const avecTout = lireExif(jpegExif({ date: '2026:11:01 10:30:00', decalage: '+01:00', lat: 45.2, lon: 5.75 }));
egal('EXIF : date avec décalage (10 h 30 à +01:00 = 9 h 30 UTC), position', [new Date(avecTout.dateMs).toISOString(), Math.round(avecTout.lat * 1e4) / 1e4, Math.round(avecTout.lon * 1e4) / 1e4],
  ['2026-11-01T09:30:00.000Z', 45.2, 5.75]);
const sansGps = lireExif(jpegExif({ date: '2026:07:14 16:05:30' }));
egal('EXIF : date sans fuseau = heure du téléphone (Paris, été), pas de GPS', [new Date(sansGps.dateMs).toISOString(), sansGps.lat], ['2026-07-14T14:05:30.000Z', null]);
egal('pas un JPEG : rien', lireExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), { dateMs: null, lat: null, lon: null });

// Placer une photo : sortie de 1 h vers le nord (1 point / min, 500 m / min), départ le 1er nov. à 9 h UTC
const debut = Date.UTC(2026, 10, 1, 9);
const pts = Array.from({ length: 61 }, (_, k) => ({ tS: k * 60, lat: 45 + (k * 500) / 111195, lon: 5.75, distanceM: k * 500 }));
egal('photo : par la position (près du km 10)', placerPhoto({ lat: 45 + 10000 / 111195, lon: 5.7505, dateMs: null }, pts, debut), { i: 20, dansSortie: true, distanceM: 10000 });
egal('photo : par l\'heure (9 h 30 -> km 15)', placerPhoto({ lat: null, lon: null, dateMs: debut + 30 * 60000 }, pts, debut), { i: 30, dansSortie: true, distanceM: 15000 });
egal('photo : prise la veille -> hors de la sortie', placerPhoto({ lat: null, lon: null, dateMs: debut - 86400000 }, pts, debut), { i: null, dansSortie: false, distanceM: null });
egal('photo : position loin du tracé, heure dans la sortie -> par l\'heure', placerPhoto({ lat: 46, lon: 6, dateMs: debut + 10 * 60000 }, pts, debut).i, 10);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
