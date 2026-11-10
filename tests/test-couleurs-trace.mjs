// Tracé coloré : indices, valeurs, couleurs, morceaux, légende.
// Lancer : node tests/test-couleurs-trace.mjs
import { indicesEchantillon, valeursPoints, valeursTrace, couleursPoints, morceaux, morceauxMode, modeDisponible, legende, htmlLegende, COULEUR_UNIE } from '../js/couleurs-trace.js';
import { traceSimplifiee } from '../js/sortie.js';

let echecs = 0;
const verif = (nom, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — ${detail}`}`); if (!ok) echecs++; };

// 1 000 points sur 5 km vers l'est, 1 point par seconde (5 m/s = 18 km/h), côte de 6 % de 2 000 à 3 000 m
const recs = Array.from({ length: 1000 }, (_, i) => ({
  horodatage: new Date(Date.UTC(2026, 0, 1, 8, 0, i)), lat: 45, lon: 5 + (i * 5) / (111195 * Math.cos(Math.PI / 4)),
  altitudeM: 200 + (i > 400 && i < 600 ? (i - 400) * 0.3 : i >= 600 ? 60 : 0), vitesseMs: 5, puissanceW: i < 500 ? 100 : 300, fc: i < 500 ? 110 : 160,
}));

const indices = indicesEchantillon(1000, 160);
verif('mêmes points que traceSimplifiee', indices.length === traceSimplifiee(recs).length && indices[indices.length - 1] === 999, `${indices.length} / ${traceSimplifiee(recs).length}`);
verif('au plus 160 points, pas de trace sous 2 points', indices.length <= 160 && indicesEchantillon(1).length === 0);

const v = valeursTrace(recs);
verif('une valeur par point de la trace', ['vitesse', 'puissance', 'fc', 'pente', 'altitude'].every((c) => v[c].length === indices.length));
verif('vitesse 5 m/s = 18 km/h', v.vitesse.every((x) => x === 18), JSON.stringify(v.vitesse.slice(0, 3)));
verif('puissance 100 W au début, 300 W à la fin', v.puissance[2] === 100 && v.puissance[v.puissance.length - 3] === 300);
const k = indices.findIndex((i) => i >= 500);
verif('pente : 0 % à plat, 0,3 m / 5 m = 6 % dans la côte', Math.abs(v.pente[2]) < 0.5 && Math.abs(v.pente[k] - 6) < 0.8, `${v.pente[2]} ${v.pente[k]}`);
verif('altitude du dernier point : 260 m', v.altitude[v.altitude.length - 1] === 260);

// Sans vitesse dans le fichier (GPX) : distance / temps
const gpx = recs.map(({ vitesseMs, puissanceW, fc, ...r }) => r);
const vg = valeursTrace(gpx);
verif('GPX : vitesse recalculée (≈ 18 km/h), pas de puissance ni de FC', Math.abs(vg.vitesse[5] - 18) < 0.5 && !vg.puissance && !vg.fc, JSON.stringify(vg.vitesse.slice(4, 7)));
verif('sans position : rien', valeursTrace([{ horodatage: new Date() }]) === null);

// Couleurs : zones de puissance avec FTP 200 (Z2 = 111–150 W, Z6 = 241–300 W)
const ctx = { ftpW: 200, fcMaxBpm: 190 };
const cp = couleursPoints({ puissance: [100, 130, 200, 290, 400, null] }, 'puissance', ctx);
verif('puissance : zones Coggan (Z1 gris, Z2 bleu, Z4 jaune, Z6 rouge, Z7 violet)', cp.slice(0, 5).join() === ['#9aa3b2', '#4d8ef7', '#f2dc3a', '#e5484d', '#a855f7'].join() && cp[5] === null, cp.join());
const cf = couleursPoints({ fc: [100, 140, 165, 185] }, 'fc', ctx);
verif('FC : zones en % de la FC max 190', cf.join() === ['#9aa3b2', '#37c27b', '#ff9a2f', '#e5484d'].join(), cf.join());
const cv = couleursPoints({ vitesse: [10, 20, 30, 40, 50] }, 'vitesse', ctx);
verif('vitesse : lent bleu, rapide rouge', cv[0].startsWith('rgb(59,76,') && cv[4].startsWith('rgb(229,36,'), `${cv[0]} ${cv[4]}`);

// Morceaux : suites de même couleur regroupées
const m = morceaux(['a', 'a', 'a', 'b', 'b', null, 'c']);
verif('morceaux regroupés (a, b, puis b pour le point sans valeur, c)', JSON.stringify(m) === JSON.stringify([{ i0: 0, i1: 2, couleur: 'a' }, { i0: 2, i1: 5, couleur: 'b' }, { i0: 5, i1: 6, couleur: 'c' }]), JSON.stringify(m));
verif('un seul morceau si tout est pareil', morceaux(['a', 'a', 'a', 'a']).length === 1 && morceaux(['a', 'a', 'a', 'a'])[0].i1 === 3);
verif('couleur unie par défaut pour un point isolé', morceaux([null, null])[0].couleur === COULEUR_UNIE);

// Modes disponibles
verif('mode puissance indisponible sans puissance ni FTP', !modeDisponible(vg, 'puissance', ctx) && !modeDisponible(v, 'puissance', {}));
verif('mode FC indisponible sans FC max', !modeDisponible(v, 'fc', {}) && modeDisponible(v, 'fc', ctx));
verif('altitude constante : indisponible', !modeDisponible({ altitude: [100, 100, 100, 100] }, 'altitude', ctx));
verif('uni toujours disponible, pas de morceaux', modeDisponible(null, 'uni') && morceauxMode(v, 'uni', ctx) === null);
verif('morceaux de puissance : 2 morceaux (100 W puis 300 W)', morceauxMode(v, 'puissance', ctx).filter((x) => x.couleur === '#9aa3b2' || x.couleur === '#e5484d').length >= 2);

// Légende
const lp = legende(v, 'puissance', ctx);
verif('légende puissance : 7 zones, Z2 = 111–150 W', lp.items.length === 7 && lp.items[1].texte === '111–150' && lp.items[6].texte === '> 300', JSON.stringify(lp.items.map((z) => z.texte)));
verif('légende FC : 5 zones', legende(v, 'fc', ctx).items.length === 5);
const lv = legende({ vitesse: [10, 20, 30, 40, 50] }, 'vitesse', ctx);
verif('légende vitesse : de 10 à 40 km/h (5e et 95e centiles)', lv.unite === 'km/h' && lv.min === '10' && lv.max === '40', `${lv.min} ${lv.max}`);
verif('HTML de la légende', htmlLegende(lp).includes('Z7') && htmlLegende(lv).includes('linear-gradient') && htmlLegende(null) === '');

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
