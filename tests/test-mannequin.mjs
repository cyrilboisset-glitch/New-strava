// Mannequin des muscles : états, nettoyage, résumé, dessin (SVG).
// Lancer : node tests/test-mannequin.mjs
import { MUSCLES, etatSuivant, nettoyer, resumeMuscles, htmlMannequin, avecMuscles } from '../js/mannequin.js';

let echecs = 0;
const egal = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
  if (!ok) echecs++;
};

egal('toucher : aucun -> principal -> secondaire -> aucun', [etatSuivant(undefined), etatSuivant('p'), etatSuivant('s')], ['p', 's', undefined]);
egal('nettoyage : zones inconnues et états faux retirés', nettoyer({ pecs: 'p', biceps: 'x', licorne: 'p', triceps: 's' }), { pecs: 'p', triceps: 's' });
egal('nettoyage : rien / null', [nettoyer(undefined), nettoyer(null)], [{}, {}]);
egal('résumé', resumeMuscles({ triceps: 's', pecs: 'p', epaules: 's' }), 'Principaux : Pectoraux · Secondaires : Épaules, Triceps');
egal('résumé vide', resumeMuscles({}), '');

const h = htmlMannequin({ pecs: 'p', cuisses: 's' }, { interactif: true, legende: true });
egal('2 vues : face et dos', (h.match(/<svg class="mq"/g) || []).length, 2);
const zonesVues = (h.match(/data-m="([a-z]+)"/g) || []).map((x) => x.slice(8, -1));
egal('tous les muscles sont dessinés au moins une fois', Object.keys(MUSCLES).filter((m) => !zonesVues.includes(m)), []);
egal('muscles partagés (épaules, avant-bras, mollets) dans les deux vues', ['epaules', 'avantbras', 'mollets'].map((m) => zonesVues.filter((x) => x === m).length), [2, 2, 2]);
egal('états : pecs principal (2 vues ? face seulement), cuisses secondaire', [/data-m="pecs" data-etat="p"/.test(h), /data-m="cuisses" data-etat="s"/.test(h), /data-m="dos" data-etat/.test(h)], [true, true, false]);
egal('interactif : zones accessibles (role bouton, étiquette)', [/role="button" tabindex="0" aria-label="Pectoraux : principal"/.test(h), /aria-label="Dos"/.test(h)], [true, true]);
egal('légende : primaire, secondaire, non ciblé', ['Muscle primaire', 'Muscle secondaire', 'Non ciblé'].map((t) => h.includes(t)), [true, true, true]);
const lecture = htmlMannequin({ pecs: 'p' });
egal('lecture seule : pas de role bouton ni de légende', [lecture.includes('role="button"'), lecture.includes('mq-legende')], [false, false]);
egal('pas de HTML injecté par un état inconnu', htmlMannequin({ pecs: '"><script>' }).includes('script'), false);
egal('muscles pour musculation / entraînement, pas pour le vélo ni la course', [{ cle: 'musculation' }, { cle: 'sport-10' }, { cle: 'sport-2' }, { cle: 'sport-1' }, { cle: 'autre-Yoga' }].map(avecMuscles), [true, true, false, false, true]);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
