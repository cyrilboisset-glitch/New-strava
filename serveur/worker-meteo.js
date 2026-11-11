// Relais Open-Meteo pour Cloudflare Workers (gratuit jusqu'à 100 000 appels par jour).
// Il ajoute la clé de l'abonnement commercial Open-Meteo, qui ne doit JAMAIS être dans l'appli
// (le code de l'appli est lisible par tous). Mode d'emploi : COMMERCIALISATION.md.
//
// Configuration dans Cloudflare : variable secrète OPEN_METEO_KEY (la clé), et variable
// ORIGINES_AUTORISEES (adresses de l'appli séparées par des virgules, ex. https://goatout.fr).
// Ensuite, dans js/config.js : urlMeteo = 'https://<ton-worker>.workers.dev/v1/forecast'.

const AMONT = 'https://customer-api.open-meteo.com/v1/forecast';
const PARAMETRES_OK = new Set(['latitude', 'longitude', 'hourly', 'wind_speed_unit', 'timezone', 'forecast_days', 'forecast_hours', 'elevation', 'models', 'start_date', 'end_date']);

export function origineAutorisee(origine, liste) {
  return !!origine && liste.split(',').map((s) => s.trim()).filter(Boolean).includes(origine);
}

export function adresseAmont(adresse, cle) {
  const entree = new URL(adresse);
  const sortie = new URL(AMONT);
  for (const [k, v] of entree.searchParams) if (PARAMETRES_OK.has(k)) sortie.searchParams.set(k, v);
  sortie.searchParams.set('apikey', cle);
  return sortie.toString();
}

export default {
  async fetch(requete, env) {
    const origine = requete.headers.get('Origin');
    const cors = { 'Access-Control-Allow-Origin': origine ?? '', Vary: 'Origin' };
    if (requete.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (requete.method !== 'GET' || new URL(requete.url).pathname !== '/v1/forecast') return new Response('Not found', { status: 404 });
    if (!origineAutorisee(origine, env.ORIGINES_AUTORISEES ?? '')) return new Response('Origine non autorisée', { status: 403 });
    if (!env.OPEN_METEO_KEY) return new Response('Clé manquante', { status: 500 });
    const reponse = await fetch(adresseAmont(requete.url, env.OPEN_METEO_KEY), { cf: { cacheTtl: 900, cacheEverything: true } });
    return new Response(reponse.body, { status: reponse.status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' } });
  },
};
