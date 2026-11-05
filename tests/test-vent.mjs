// Tests du vent (repris de l'appli vent) : caps, vent dans l'axe, interpolation,
// temps avec le vent, sens conseillé, meilleure heure. Lancer : node tests/test-vent.mjs
import {
  cap, pointCardinal, ventDansLeDos, echantillonner, inverser, urlOpenMeteo, lireOpenMeteo, meteoA,
  puissanceSelonPente, vitesseAvecVent, simuler, comparerSens, planifier, couleurVent, chargerMeteo,
} from '../js/vent.js';

let echecs = 0;
const egal = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
  if (!ok) echecs++;
};
const proche = (nom, obtenu, attendu, tol) => {
  const ok = Math.abs(obtenu - attendu) <= tol;
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${obtenu}, attendu ${attendu} ± ${tol}`}`);
  if (!ok) echecs++;
};

// Caps et vent dans l'axe
proche('cap plein nord', cap({ lat: 45, lon: 6 }, { lat: 46, lon: 6 }), 0, 0.01);
proche('cap plein est', cap({ lat: 45, lon: 6 }, { lat: 45, lon: 7 }), 90, 1);
egal('points cardinaux', [pointCardinal(0), pointCardinal(225), pointCardinal(350)], ['nord', 'sud-ouest', 'nord']);
egal('vent du nord, cap nord : de face (-20)', Math.round(ventDansLeDos(20, 0, 0)), -20);
egal('vent du nord, cap sud : dans le dos (+20)', Math.round(ventDansLeDos(20, 0, 180)), 20);
egal('vent du nord, cap est : travers (0)', Math.round(ventDansLeDos(20, 0, 90)), 0);

// Boucle carrée de 10 km de côté (nord, est, sud, ouest), plate
const DLAT = 10 / 111.2;
const DLON = 10 / (111.2 * Math.cos((45 * Math.PI) / 180));
const coins = [[45, 6], [45 + DLAT, 6], [45 + DLAT, 6 + DLON], [45, 6 + DLON], [45, 6]];
const coords = [];
for (let c = 0; c < 4; c++) for (let k = 0; k < 50; k++) coords.push([coins[c][0] + ((coins[c + 1][0] - coins[c][0]) * k) / 50, coins[c][1] + ((coins[c + 1][1] - coins[c][1]) * k) / 50, 200]);
coords.push([45, 6, 200]);
const ech = echantillonner(coords, 100);
proche('boucle de 40 km', ech[ech.length - 1].distanceM / 1000, 40, 0.3);
proche('cap au km 5 : nord', ech[50].cap, 0, 1);
proche('cap au km 25 : sud', ech[250].cap, 180, 1);
const inv = inverser(ech);
proche('sens inverse au km 5 : est', inv[50].cap, 90, 1);

// Prévision fictive : vent constant, 72 h
const t0 = Date.UTC(2026, 10, 6);
const serieFictive = ({ de = 0, vent = 20, pluie = () => 0 } = {}) => [{
  lat: 45.04, lon: 6.06, heures: Array.from({ length: 72 }, (_, h) => t0 + h * 3600e3),
  temp: Array(72).fill(12), vent: Array(72).fill(vent), de: Array(72).fill(de), rafales: Array(72).fill(vent * 1.5),
  pluie: Array.from({ length: 72 }, (_, h) => pluie(h)),
}];

// Interpolation vectorielle : du 350° au 10° -> 0° au milieu (pas 180°)
const tourne = { heures: [0, 3600e3], temp: [10, 12], vent: [20, 20], de: [350, 10], rafales: [], pluie: [] };
const mi = meteoA(tourne, 1800e3);
egal('interpolation du vent en vecteur', [Math.round(mi.de) % 360, Math.round(mi.vent), mi.temp], [0, 20, 11]);
egal('hors des prévisions : rien', meteoA(tourne, 5 * 3600e3), null);

// Vitesse avec le vent (106 kg, 150 W) : sans vent ≈ 30 km/h, vent de face plus lent
proche('sans vent : 150,3 W ≈ 30 km/h', vitesseAvecVent(150.3, { masseKg: 106 }) * 3.6, 30, 0.05);
egal('vent de face : plus lent, dans le dos : plus vite', vitesseAvecVent(150, { masseKg: 106, ventDeFaceMs: 3.9 }) < vitesseAvecVent(150, { masseKg: 106 })
  && vitesseAvecVent(150, { masseKg: 106, ventDeFaceMs: -3.9 }) > vitesseAvecVent(150, { masseKg: 106 }), true);
egal('puissance selon la pente (appli vent)', [0.06, 0.03, -0.01, -0.04, -0.08].map((p) => Math.round(puissanceSelonPente(200, p))), [260, 230, 200, 100, 0]);

// Vent du nord : sens du tracé (N, E, S, O) = dernier tiers en partie sud (dos) puis ouest (travers) ;
// sens inverse (E, N, O, S) = dernier tiers vers le sud, vent dans le dos -> conseillé
const series = serieFictive({ de: 0, vent: 20 });
const aller = simuler(ech, series, t0 + 9 * 3600e3, 150, 106);
const retour = simuler(inv, series, t0 + 9 * 3600e3, 150, 106);
proche('sens du tracé : vent dans le dos en fin ≈ +5 km/h', aller.dosFin, 5, 1.5);
proche('sens inverse : vent dans le dos en fin ≈ +15 km/h', retour.dosFin, 15, 1.5);
proche('sur l\'ensemble : autant de face que de dos', aller.dosTout, 0, 0.5);
egal('sens conseillé : inverse', comparerSens(aller, retour), { meilleur: 'inverse', net: true });
// à 15 s près sur 1 h 23 : les coins du carré ne sont pas pris pareil dans les deux sens
proche('les deux sens durent pareil (même vent de face et de dos)', aller.dureeS, retour.dureeS, 15);
const sansVent = simuler(ech, serieFictive({ vent: 0 }), t0 + 9 * 3600e3, 150, 106);
proche('sans vent : 40 km à 150 W ≈ 1 h 20', sansVent.dureeS, 40000 / (vitesseAvecVent(150, { masseKg: 106 })), 30);
egal('avec 20 km/h de vent : plus long que sans vent (le vent de face coûte plus que le dos ne rapporte)', aller.dureeS > sansVent.dureeS, true);

// Meilleure heure : la pluie (≥ 50 %) écarte 9 h ; le vent faiblit l'après-midi
const ventDuJour = serieFictive({ de: 0, vent: 20, pluie: (h) => (h === 9 || h === 10 ? 80 : 0) });
ventDuJour[0].vent = ventDuJour[0].heures.map((_, h) => (h < 12 ? 25 : 8));
const plan = planifier(coords, ventDuJour, [8, 9, 14].map((h) => t0 + h * 3600e3), 150, 98 + 8);
egal('plan : 3 heures, sens conseillé pour chacune', plan.heures.map((h) => h.sens), ['inverse', 'inverse', 'inverse']);
egal('meilleure heure : 14 h (vent faible, pas de pluie)', new Date(plan.meilleure.debutMs).getUTCHours(), 14);

// Open-Meteo : adresse et lecture
const url = urlOpenMeteo([{ lat: 45.1885, lon: 5.7245, ele: 212 }, { lat: 45.2, lon: 5.75, ele: 300 }], t0 + 9 * 3600e3, t0 + 12 * 3600e3);
egal('adresse Open-Meteo', url.startsWith('https://api.open-meteo.com/v1/forecast?latitude=45.1885,45.2000&longitude=5.7245,5.7500&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability&wind_speed_unit=kmh&timezone=GMT&timeformat=unixtime&start_date=2026-11-06&end_date=2026-11-06') && url.endsWith('&elevation=212,300'), true);
const lu = lireOpenMeteo([{ latitude: 45.19, longitude: 5.72, hourly: { time: [1762412400, 1762416000], temperature_2m: [8, 9], wind_speed_10m: [12, 14], wind_direction_10m: [200, 210], wind_gusts_10m: [20, 22], precipitation_probability: [10, 30] } }], [{ lat: 45.1885, lon: 5.7245 }]);
egal('lecture Open-Meteo', [lu[0].heures[0], lu[0].vent[1], lu[0].de[0], lu[0].lat], [1762412400000, 14, 200, 45.1885]);
let msg = '';
try { await chargerMeteo([{ lat: 45, lon: 6 }], t0, t0, async () => { throw new TypeError('Failed to fetch'); }); } catch (e) { msg = e.message; }
egal('sans réseau : message clair', msg, 'pas de réseau ou service météo injoignable');
egal('couleurs du vent', [couleurVent(-20), couleurVent(-5), couleurVent(0), couleurVent(5), couleurVent(20)], ['#b2182b', '#ef8a62', '#bababa', '#67a9cf', '#2166ac']);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
