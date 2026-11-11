// Licence signée hors ligne, essai, fonds de carte. Lancer : node tests/test-licence.mjs
import { creerPaireDeCles, creerLicence, verifierLicence, situationLicence } from '../js/licence.js';
import { FONDS, choisirFond, fondActuel, cleFondActuel, urlTuile } from '../js/fonds-carte.js';

let echecs = 0;
const verif = (nom, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — ${detail}`}`); if (!ok) echecs++; };

const { publique, privee } = await creerPaireDeCles();
const autre = await creerPaireDeCles();
const code = await creerLicence({ id: 'L-0001', nom: 'Cyril', emis: Date.UTC(2026, 10, 11) }, privee);
verif('code : préfixe GOAT- et deux parties séparées par un point', /^GOAT-[\w-]+\.[\w-]+$/.test(code), code);
const v = await verifierLicence(code, publique);
verif('licence valide : charge utile lue (id, nom, date)', v.ok && v.charge.id === 'L-0001' && v.charge.nom === 'Cyril' && v.charge.emis === Date.UTC(2026, 10, 11), JSON.stringify(v));
verif('code avec espaces et sauts de ligne (collé depuis un e-mail) : accepté', (await verifierLicence(`  ${code.slice(0, 20)}\n${code.slice(20)} `, publique)).ok);
verif('mauvaise clé publique : refusée', (await verifierLicence(code, autre.publique)).raison === 'signature');
const [debut, sig] = code.split('.');
const falsifie = `${debut.slice(0, -2)}${debut.endsWith('AA') ? 'BB' : 'AA'}.${sig}`;
verif('charge utile modifiée : refusée', !(await verifierLicence(falsifie, publique)).ok);
verif('texte quelconque, vide, null : refusés sans erreur', !(await verifierLicence('bonjour', publique)).ok && !(await verifierLicence('', publique)).ok && !(await verifierLicence(null, publique)).ok);
verif('sans clé publique configurée : refusée', (await verifierLicence(code, null)).raison === 'pas de clé publique');

// Situation : licence exigée ou pas, essai, expiration
const J = 86400000; const t0 = Date.UTC(2026, 10, 11);
const cfg = { licenceObligatoire: true, cleLicencePublique: publique, essaiJours: 14 };
verif('licence pas exigée : « libre » (comportement actuel)', (await situationLicence({ config: { ...cfg, licenceObligatoire: false } })).mode === 'libre');
verif('1er lancement : essai de 14 jours', (await situationLicence({ config: cfg, maintenantMs: t0 })).joursRestants === 14);
verif('après 10 jours : essai, 4 jours restants', (await situationLicence({ config: cfg, essaiDebutMs: t0, maintenantMs: t0 + 10 * J })).joursRestants === 4);
verif('après 14 jours : expirée', (await situationLicence({ config: cfg, essaiDebutMs: t0, maintenantMs: t0 + 14 * J })).mode === 'expiree');
verif('expirée mais licence valide : « licence »', (await situationLicence({ config: cfg, code, essaiDebutMs: t0, maintenantMs: t0 + 400 * J })).mode === 'licence');
verif('expirée avec un faux code : toujours expirée', (await situationLicence({ config: cfg, code: 'GOAT-x.y', essaiDebutMs: t0, maintenantMs: t0 + 400 * J })).mode === 'expiree');

// Fonds de carte
verif('fond par défaut : OpenStreetMap', cleFondActuel() === 'osm' && fondActuel().credit === '© OpenStreetMap');
verif('adresse d\'une tuile OpenStreetMap', urlTuile({ z: 12, x: 2113, y: 1493 }) === 'https://tile.openstreetmap.org/12/2113/1493.png');
choisirFond('ign');
verif('fond IGN : adresse WMTS avec ligne et colonne, mention © IGN', urlTuile({ z: 12, x: 2113, y: 1493 }).includes('TILEMATRIX=12&TILEROW=1493&TILECOL=2113') && fondActuel().credit === '© IGN' && FONDS.ign.maxZoom === 18);
choisirFond('inconnu');
verif('fond inconnu : retour au fond par défaut', cleFondActuel() === 'osm');

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
