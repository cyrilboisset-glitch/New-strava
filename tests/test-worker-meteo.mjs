// Relais météo : filtre des paramètres, clé ajoutée, origines autorisées. Lancer : node tests/test-worker-meteo.mjs
import travailleur, { origineAutorisee, adresseAmont } from '../serveur/worker-meteo.js';
let echecs = 0;
const verif = (nom, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — ${detail}`}`); if (!ok) echecs++; };

const u = new URL(adresseAmont('https://relais.example/v1/forecast?latitude=45&longitude=5&hourly=temperature_2m&apikey=VOLEE&evil=1', 'SECRETE'));
verif('adresse en amont : serveur commercial, paramètres connus gardés, clé du relais ajoutée', u.host === 'customer-api.open-meteo.com' && u.searchParams.get('latitude') === '45' && u.searchParams.get('apikey') === 'SECRETE', u.toString());
verif('paramètre inconnu retiré', !u.searchParams.has('evil'));
verif('origines : autorisée / refusée / absente', origineAutorisee('https://a.fr', 'https://a.fr, https://b.fr') && !origineAutorisee('https://c.fr', 'https://a.fr') && !origineAutorisee(null, 'https://a.fr'));

const env = { OPEN_METEO_KEY: 'SECRETE', ORIGINES_AUTORISEES: 'https://a.fr' };
let appelee = null;
globalThis.fetch = async (url) => { appelee = String(url); return new Response('{"ok":true}', { status: 200 }); };
const req = (url, origine, methode = 'GET') => new Request(url, { method: methode, headers: origine ? { Origin: origine } : {} });
let r = await travailleur.fetch(req('https://relais.example/v1/forecast?latitude=45&longitude=5', 'https://a.fr'), env);
verif('origine autorisée : réponse 200 avec en-tête CORS, clé transmise en amont', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === 'https://a.fr' && appelee.includes('apikey=SECRETE'));
r = await travailleur.fetch(req('https://relais.example/v1/forecast?latitude=45', 'https://pirate.fr'), env);
verif('autre origine : 403, rien envoyé en amont', r.status === 403);
r = await travailleur.fetch(req('https://relais.example/autre', 'https://a.fr'), env);
verif('autre chemin : 404', r.status === 404);
r = await travailleur.fetch(req('https://relais.example/v1/forecast', 'https://a.fr', 'OPTIONS'), env);
verif('pré-vérification CORS (OPTIONS) : 204', r.status === 204);
r = await travailleur.fetch(req('https://relais.example/v1/forecast?latitude=45', 'https://a.fr'), { ORIGINES_AUTORISEES: 'https://a.fr' });
verif('clé absente : erreur 500 claire', r.status === 500);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
