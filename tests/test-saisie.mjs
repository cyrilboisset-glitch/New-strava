// Tests de la saisie à la main : résumé et validation (valeurs connues).
// Lancer : node tests/test-saisie.mjs
import { resumerSaisie, validerSaisie, idSaisie } from '../js/saisie.js';
import { familleSortie } from '../js/sortie.js';
import { typesProposes } from '../js/strava.js';
import { chargeSortie } from '../js/analyse.js';

let echecs = 0;
const egal = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
  if (!ok) echecs++;
};
const maintenant = new Date(2026, 10, 22, 12).getTime();
const debutMs = new Date(2026, 10, 20, 9, 30).getTime();

// Une sortie kayak de 1 h 30, 12 km
const r = resumerSaisie({ id: 'manuel-x', nom: '  Lac   du   Bourget ', type: { sport: 41, sousSport: 0, nomSport: 'Kayak' }, debutMs, dureeS: 5400, distanceKm: 12, fcMoy: 130 });
egal('source, sans trace, id', [r.source, r.sansTrace, r.id, r.nomFichier], ['manuel', true, 'manuel-x', null]);
egal('nom nettoyé', r.nom, 'Lac du Bourget');
egal('durée et distance', [r.dureeChronoS, r.distanceM], [5400, 12000]);
egal('vitesse moyenne 12 km en 1 h 30 = 8 km/h', Math.round(r.vitesseMoyMs * 3.6 * 10) / 10, 8);
egal('famille : sports d\'eau', familleSortie(r).nom, "Sports d'eau");
egal('FC moyenne gardée, rien d\'autre', [r.fcMoy, r.puissanceMoyW, r.calories, r.denivelePosM], [130, null, null, null]);
egal('sans titre : pas de nom', resumerSaisie({ id: 'a', type: { sport: 2, sousSport: 0, nomSport: 'Vélo' }, debutMs, dureeS: 3600 }).nom, undefined);
egal('vélo choisi gardé', resumerSaisie({ id: 'a', type: { sport: 2, sousSport: 0, nomSport: 'Vélo' }, debutMs, dureeS: 3600, veloId: 'v1' }).veloId, 'v1');
// Puissance : la charge d'entraînement est calculée (NP = moyenne), FTP 200 W : IF 1, TSS = 60 min × 1² / 36 × 60 = 100
const v = resumerSaisie({ id: 'b', type: { sport: 2, sousSport: 0, nomSport: 'Vélo' }, debutMs, dureeS: 3600, puissanceMoyW: 200 });
egal('puissance moyenne = normalisée', [v.puissanceMoyW, v.puissanceNormW], [200, 200]);
egal('TSS 100 pour 1 h à la FTP', Math.round(chargeSortie(v, 200).tss), 100);
// Un type libre (sport 0) a sa propre famille
egal('autre activité : sa propre famille', familleSortie(resumerSaisie({ id: 'c', type: { sport: 0, sousSport: 0, nomSport: 'Escrime' }, debutMs, dureeS: 1800 })).nom, 'Escrime');
// Validation
egal('saisie correcte : aucune erreur', validerSaisie({ debutMs, dureeS: 5400, distanceKm: 12 }, maintenant), []);
egal('durée absente', validerSaisie({ debutMs, dureeS: 0 }, maintenant).length, 1);
egal('date dans le futur', validerSaisie({ debutMs: maintenant + 5 * 86400000, dureeS: 3600 }, maintenant).length, 1);
egal('date invalide', validerSaisie({ debutMs: NaN, dureeS: 3600 }, maintenant).length, 1);
egal('FC absurde et distance négative : 2 erreurs', validerSaisie({ debutMs, dureeS: 3600, fcMoy: 400, distanceKm: -3 }, maintenant).length, 2);
// Les types proposés couvrent tous les sports, avec le home trainer
const noms = typesProposes().map((t) => t.nom);
egal('types proposés : vélo, home trainer, kayak, escalade, yoga', ['Vélo', 'Home trainer', 'Kayak', 'Escalade', 'Yoga'].every((n) => noms.includes(n)), true);
egal('types proposés : sans doublon de nom', new Set(noms).size, noms.length);
egal('identifiants différents', idSaisie() !== idSaisie(), true);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
