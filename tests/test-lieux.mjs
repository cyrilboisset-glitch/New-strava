// Noms proposés (tracés, segments) : grammaire, réponses OpenStreetMap, cache.
// Lancer : node tests/test-lieux.mjs
import {
  de, le, nomTrace, nomSegment, sansDoublons, urlNominatim, lireNominatim, urlOverpass, lireOverpass,
  brancherCache, proposerNomTrace, proposerNomSegment, communePres,
} from '../js/lieux.js';

let echecs = 0;
const egal = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
  if (!ok) echecs++;
};

egal('de', ['Voreppe', 'Uriage-les-Bains', 'Le Sappey-en-Chartreuse', 'La Buisse', 'Les Abrets', "L'Albenc", 'Col de Porte', 'Échirolles'].map(de),
  ['de Voreppe', "d'Uriage-les-Bains", 'du Sappey-en-Chartreuse', 'de la Buisse', 'des Abrets', "de l'Albenc", 'du col de Porte', "d'Échirolles"]);
egal('le', ['Voreppe', 'Le Sappey-en-Chartreuse', 'Col de la Placette', 'Mont Rachais', "L'Albenc"].map(le),
  ['Voreppe', 'le Sappey-en-Chartreuse', 'le col de la Placette', 'le mont Rachais', "l'Albenc"]);

egal('boucle avec col', nomTrace({ boucle: true, depart: 'Voreppe', col: 'Col de la Placette', distanceM: 42000 }), 'Boucle de Voreppe par le col de la Placette');
egal('boucle sans col : par le lieu le plus loin', nomTrace({ boucle: true, depart: 'Voreppe', loin: 'Saint-Laurent-du-Pont', distanceM: 42000 }), 'Boucle de Voreppe par Saint-Laurent-du-Pont');
egal('aller simple', nomTrace({ boucle: false, depart: 'Grenoble', arrivee: 'Chambéry', distanceM: 60000 }), 'Grenoble → Chambéry');
egal('sans réseau : chiffres', nomTrace({ boucle: true, distanceM: 42350, deniveleM: 652 }), 'Boucle de 42,4 km · 652 m D+');

egal('montée vers un col', nomSegment({ type: 'Montée', debut: 'Voreppe', fin: 'Pommiers-la-Placette', col: 'Col de la Placette', distanceM: 6000, penteMoyPct: 6.1 }), 'Montée du col de la Placette');
egal('montée vers une commune', nomSegment({ type: 'Montée', debut: 'Grenoble', fin: 'Le Sappey-en-Chartreuse', distanceM: 6000 }), 'Montée vers le Sappey-en-Chartreuse');
egal('montée dans une commune', nomSegment({ type: 'Montée', debut: 'Voreppe', fin: 'Voreppe', distanceM: 900 }), 'Montée de Voreppe');
egal('montée sans réseau', nomSegment({ type: 'Montée', distanceM: 2950, penteMoyPct: 5.94 }), 'Montée de 3,0 km à 5,9 %');
egal('sprint', [nomSegment({ type: 'Sprint', debut: 'Uriage', distanceM: 250 }), nomSegment({ type: 'Sprint', distanceM: 250 })], ["Sprint d'Uriage", 'Sprint de 250 m']);
egal('plat entre deux communes', nomSegment({ type: 'Plat', debut: 'Voiron', fin: 'Moirans', distanceM: 5000 }), 'Voiron → Moirans');
egal('doublons', sansDoublons(['Montée de Voreppe', 'Montée vers X', 'Montée de Voreppe'], ['km 1,0', 'km 3,0', 'km 9,5']),
  ['Montée de Voreppe (km 1,0)', 'Montée vers X', 'Montée de Voreppe (km 9,5)']);

egal('adresse Nominatim', urlNominatim(45.29123, 5.6355), 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=45.29123&lon=5.63550&zoom=13&addressdetails=1&accept-language=fr');
egal('lecture Nominatim', [lireNominatim({ address: { town: 'Voreppe', county: 'Isère' } }), lireNominatim({ address: { hamlet: 'Le Chevalon' } }), lireNominatim({ error: 'Unable to geocode' })], ['Voreppe', 'Le Chevalon', null]);
egal('adresse Overpass', decodeURIComponent(urlOverpass(45.3, 5.7).split('data=')[1]).includes('node(around:300,45.30000,5.70000)["mountain_pass"="yes"]["name"]'), true);
egal('lecture Overpass : le col avant le sommet', lireOverpass({ elements: [
  { lat: 45.3001, lon: 5.7, tags: { natural: 'peak', name: 'Bec' } },
  { lat: 45.302, lon: 5.7, tags: { mountain_pass: 'yes', name: 'Col de la Placette' } },
] }, 45.3, 5.7), 'Col de la Placette');
egal('lecture Overpass : rien', lireOverpass({ elements: [] }, 45, 5), null);

// Faux réseau : communes selon la latitude, un col à 45.33
let demandes = 0;
const faux = async (url) => {
  demandes++;
  const u = new URL(url);
  if (u.host.includes('nominatim')) {
    const lat = Number(u.searchParams.get('lat'));
    return { ok: true, json: async () => ({ address: { town: lat < 45.31 ? 'Voreppe' : 'Pommiers-la-Placette' } }) };
  }
  const q = decodeURIComponent(u.search);
  return { ok: true, json: async () => ({ elements: q.includes('45.33') ? [{ lat: 45.33, lon: 5.6, tags: { mountain_pass: 'yes', name: 'Col de la Placette' } }] : [] }) };
};
let stock = {};
brancherCache(async () => stock, async (c) => { stock = { ...c }; }, 0);
const montee = { type: 'Montée', points: [[45.3, 5.6], [45.315, 5.6], [45.33, 5.6]], distanceM: 3300, penteMoyPct: 6 };
egal('segment : montée du col', await proposerNomSegment(montee, faux), 'Montée du col de la Placette');
const n = demandes;
egal('deuxième fois : depuis le cache, sans demande', [await proposerNomSegment(montee, faux), demandes - n], ['Montée du col de la Placette', 0]);
const coords = [[45.3, 5.6, 300], [45.33, 5.6, 900], [45.3, 5.61, 300], [45.3001, 5.6, 300]];
egal('tracé : boucle par le col', await proposerNomTrace(coords, 12000, 600, faux), 'Boucle de Voreppe par le col de la Placette');
egal('sans réseau : null, pas gardé', [await communePres(44, 4, async () => { throw new TypeError('Failed to fetch'); }), 'c:44.000,4.000' in stock], [null, false]);
egal('sans réseau : nom avec les chiffres', await proposerNomSegment({ type: 'Montée', points: [[44, 4], [44.01, 4]], distanceM: 1100, penteMoyPct: 7.2 }, async () => { throw new TypeError('x'); }), 'Montée de 1,1 km à 7,2 %');

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
