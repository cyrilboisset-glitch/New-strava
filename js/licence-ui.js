// Écran de licence (essai terminé) et carte « Licence » du Profil. Les données restent toujours
// exportables : le blocage ne retient que l'usage de l'appli, jamais les sorties de l'utilisateur.
import { CONFIG } from './config.js';
import { situationLicence, verifierLicence } from './licence.js';
import { lireReglage, ecrireReglage } from './db.js';
import { creerSauvegarde, telecharger } from './sauvegarde.js';
import { echapper } from './format.js';

/** Situation actuelle ; la date de début d'essai est notée au premier lancement */
export async function lireSituation() {
  if (!CONFIG.licenceObligatoire) return { mode: 'libre' };
  let debut = null; let code = null;
  try { debut = (await lireReglage('essaiDebut')) ?? null; code = (await lireReglage('licence')) ?? null; } catch { /* essai neuf */ }
  if (debut == null) { debut = Date.now(); try { await ecrireReglage('essaiDebut', debut); } catch { /* sans importance */ } }
  return situationLicence({ code, essaiDebutMs: debut });
}

/** Vérifie et garde un code entré par l'utilisateur */
export async function activerLicence(code) {
  const v = await verifierLicence(code);
  if (v.ok) await ecrireReglage('licence', String(code).replace(/\s+/g, ''));
  return v;
}

const MESSAGES = {
  format: 'Ce code n\'a pas la bonne forme. Il commence par « GOAT- ».',
  signature: 'Ce code n\'est pas valide.',
  illisible: 'Ce code est illisible. Colle-le en entier.',
  'pas de clé publique': 'Licences pas encore configurées dans cette version.',
  version: 'Ce code vient d\'une autre version de l\'appli.',
};

/** Affiche ou cache l'écran de licence selon la situation ; renvoie la situation */
export async function controlerLicence(toast = () => {}) {
  const ecran = document.getElementById('ecran-licence');
  const sit = await lireSituation();
  if (!ecran) return sit;
  if (sit.mode !== 'expiree') { ecran.hidden = true; document.body.classList.remove('licence-bloquee'); return sit; }
  document.body.classList.add('licence-bloquee');
  ecran.hidden = false;
  ecran.innerHTML = `
    <div class="licence-boite">
      <img class="marque-icone" src="icons/icone-192.png" alt="" width="72" height="72">
      <p class="logo-mot licence-nom">GOAT<span class="out">out</span></p>
      <h2>Ton essai de ${CONFIG.essaiJours} jours est terminé</h2>
      <p>Pour continuer, entre ton code de licence${CONFIG.urlAchat ? ' ou achète GOATout (paiement unique)' : ''}.</p>
      ${CONFIG.urlAchat ? `<a class="btn principal large" href="${echapper(CONFIG.urlAchat)}" target="_blank" rel="noopener">Acheter GOATout</a>` : ''}
      <label class="licence-champ"><span>Code de licence</span><textarea id="code-licence" rows="3" placeholder="GOAT-…" autocomplete="off" spellcheck="false"></textarea></label>
      <p id="msg-licence" class="aide" role="status"></p>
      <button id="btn-activer" class="btn principal large" type="button">Activer</button>
      <button id="btn-sauvegarde-licence" class="btn secondaire large" type="button">Exporter mes sorties (sauvegarde)</button>
      <p class="aide">Tes sorties t'appartiennent : elles restent sur ton téléphone et tu peux toujours les exporter.</p>
    </div>`;
  ecran.querySelector('#btn-activer').onclick = async () => {
    const v = await activerLicence(ecran.querySelector('#code-licence').value);
    if (v.ok) { toast('Licence activée. Merci !'); await controlerLicence(toast); }
    else ecran.querySelector('#msg-licence').textContent = MESSAGES[v.raison] ?? 'Code refusé.';
  };
  ecran.querySelector('#btn-sauvegarde-licence').onclick = async () => {
    const msg = ecran.querySelector('#msg-licence');
    try { const { blob, nomFichier } = await creerSauvegarde((t) => { msg.textContent = t; }); telecharger(blob, nomFichier); msg.textContent = `${nomFichier} enregistré dans Téléchargements.`; } catch (e) { msg.textContent = `Sauvegarde impossible : ${e.message}`; }
  };
  return sit;
}

/** Carte « Licence » de la page Profil ('' si la licence n'est pas exigée) */
export async function htmlCarteLicence() {
  const sit = await lireSituation();
  if (sit.mode === 'libre') return '';
  const etat = sit.mode === 'licence'
    ? `<p class="licence-ok">Licence active${sit.charge?.nom ? ` · ${echapper(sit.charge.nom)}` : ''}. Merci !</p>`
    : `<p class="aide">Essai gratuit : <b>${sit.joursRestants} jour${sit.joursRestants > 1 ? 's' : ''}</b> restant${sit.joursRestants > 1 ? 's' : ''}.</p>
       ${CONFIG.urlAchat ? `<a class="btn principal" href="${echapper(CONFIG.urlAchat)}" target="_blank" rel="noopener">Acheter GOATout</a>` : ''}
       <label class="champ"><span>Code de licence</span><input id="profil-code-licence" type="text" placeholder="GOAT-…" autocomplete="off" spellcheck="false"></label>
       <button id="profil-activer" class="btn secondaire" type="button">Activer</button>
       <p id="profil-msg-licence" class="aide" role="status"></p>`;
  return `<section class="carte reglages" id="carte-licence"><h2 class="bloc-titre">Licence</h2>${etat}</section>`;
}

export function installerCarteLicence(page, toast) {
  const bouton = page.querySelector('#profil-activer');
  if (!bouton) return;
  bouton.onclick = async () => {
    const v = await activerLicence(page.querySelector('#profil-code-licence').value);
    if (v.ok) { toast('Licence activée. Merci !'); page.querySelector('#carte-licence').outerHTML = await htmlCarteLicence(); }
    else page.querySelector('#profil-msg-licence').textContent = MESSAGES[v.raison] ?? 'Code refusé.';
  };
}
