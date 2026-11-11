// Licence d'achat unique, vérifiée HORS LIGNE : pas de serveur à interroger, pas de compte.
// Le code de licence est un jeton signé (ECDSA P-256 / SHA-256) avec la clé privée du vendeur ;
// l'appli ne connaît que la clé publique (config.js). Format : « GOAT-<charge utile>.<signature> »
// (base64url). Charge utile : { v: 1, id, nom, emis }. Sans navigateur : testé dans Node
// (tests/test-licence.mjs). Les licences se fabriquent avec outils/licences.html.
// Principe : rien n'est jamais bloqué pour qui n'a pas besoin de licence (licenceObligatoire false),
// et les données de l'utilisateur restent toujours exportables, licence ou non.
import { CONFIG } from './config.js';

const PREFIXE = 'GOAT-';
const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' };
const JOUR_MS = 86400000;

const enBase64Url = (octets) => btoa(String.fromCharCode(...new Uint8Array(octets))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deBase64Url = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Nouvelle paire de clés : { publique: JWK, privee: JWK } */
export async function creerPaireDeCles() {
  const paire = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']);
  return { publique: await crypto.subtle.exportKey('jwk', paire.publicKey), privee: await crypto.subtle.exportKey('jwk', paire.privateKey) };
}

/** Fabrique un code de licence (vendeur seulement : demande la clé privée) */
export async function creerLicence({ id, nom, emis = Date.now() }, cleePrivee) {
  const cle = await crypto.subtle.importKey('jwk', cleePrivee, ALGO, false, ['sign']);
  const charge = enBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, id, nom, emis })));
  const sig = await crypto.subtle.sign(SIGNATURE, cle, new TextEncoder().encode(charge));
  return `${PREFIXE}${charge}.${enBase64Url(sig)}`;
}

/** @returns {Promise<{ok: boolean, charge?: object, raison?: string}>} */
export async function verifierLicence(code, clePublique = CONFIG.cleLicencePublique) {
  try {
    const texte = String(code ?? '').replace(/\s+/g, '');
    if (!texte.startsWith(PREFIXE)) return { ok: false, raison: 'format' };
    const [charge, sig] = texte.slice(PREFIXE.length).split('.');
    if (!charge || !sig) return { ok: false, raison: 'format' };
    if (!clePublique) return { ok: false, raison: 'pas de clé publique' };
    const cle = await crypto.subtle.importKey('jwk', clePublique, ALGO, false, ['verify']);
    const bon = await crypto.subtle.verify(SIGNATURE, cle, deBase64Url(sig), new TextEncoder().encode(charge));
    if (!bon) return { ok: false, raison: 'signature' };
    const donnees = JSON.parse(new TextDecoder().decode(deBase64Url(charge)));
    return donnees?.v === 1 ? { ok: true, charge: donnees } : { ok: false, raison: 'version' };
  } catch {
    return { ok: false, raison: 'illisible' };
  }
}

/**
 * Situation de l'utilisateur :
 *  - 'libre'   : licence pas exigée (config) ;
 *  - 'licence' : code valide ;
 *  - 'essai'   : essai en cours (joursRestants) ;
 *  - 'expiree' : essai fini, pas de licence : il faut en entrer une.
 * @param {{ code?: string|null, essaiDebutMs?: number|null, maintenantMs?: number, config?: typeof CONFIG }} o
 */
export async function situationLicence({ code = null, essaiDebutMs = null, maintenantMs = Date.now(), config = CONFIG } = {}) {
  if (!config.licenceObligatoire) return { mode: 'libre' };
  if (code) {
    const v = await verifierLicence(code, config.cleLicencePublique);
    if (v.ok) return { mode: 'licence', charge: v.charge };
  }
  const debut = essaiDebutMs ?? maintenantMs;
  const restant = Math.ceil(config.essaiJours - (maintenantMs - debut) / JOUR_MS);
  return restant > 0 ? { mode: 'essai', joursRestants: restant, debut } : { mode: 'expiree', joursRestants: 0, debut };
}
