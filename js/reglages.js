// Page Profil : FTP (avec estimation depuis les sorties), FC max,
// sauvegarde des sorties et place utilisée.
import { lireProfil, ecrireProfil, estimerMaFtp } from './profil.js';
import { creerSauvegarde, telecharger } from './sauvegarde.js';
import { toutesLesSorties, lireReglage } from './db.js';
import { ZONES_PUISSANCE, JOURS_ESTIMATION_FTP } from './analyse.js';
import { nombre, echapper, fmtDate, ilYA } from './format.js';

function tableauZones(ftpW) {
  if (!ftpW) return '';
  let bas = 0;
  return ZONES_PUISSANCE.map((z) => {
    const haut = Number.isFinite(z.max) ? Math.round(ftpW * z.max) : null;
    const plage = haut === null ? `> ${bas - 1} W` : bas ? `${bas}–${haut} W` : `≤ ${haut} W`;
    if (haut !== null) bas = haut + 1;
    return `<div class="detail"><dt>${z.nom} ${z.libelle}</dt><dd>${plage}</dd></div>`;
  }).join('');
}

/**
 * @param {HTMLElement} page
 * @param {(texte: string) => void} toast
 */
export async function afficherReglages(page, toast) {
  const profil = await lireProfil();
  const derniere = await lireReglage('derniereSauvegarde');
  const nbSorties = (await toutesLesSorties()).length;
  page.innerHTML = `
  <section class="carte reglages">
    <h2 class="bloc-titre">Puissance</h2>
    <label class="champ">
      <span>FTP (puissance au seuil)</span>
      <span class="champ-saisie"><input id="champ-ftp" type="number" inputmode="numeric" min="50" max="600" step="1" value="${profil.ftpW ?? ''}"> W</span>
    </label>
    <p class="aide">Sert aux zones de puissance, au facteur d'intensité et au TSS de toutes les sorties.</p>
    <button id="btn-estimer" class="btn secondaire" type="button">Estimer ma FTP depuis mes sorties</button>
    <div id="estimation" class="estimation" hidden></div>
    <dl class="sortie-details zones-reglages" id="zones-reglages">${tableauZones(profil.ftpW)}</dl>
  </section>

  <section class="carte reglages">
    <h2 class="bloc-titre">Fréquence cardiaque</h2>
    <label class="champ">
      <span>FC max</span>
      <span class="champ-saisie"><input id="champ-fcmax" type="number" inputmode="numeric" min="100" max="230" step="1" value="${profil.fcMaxReglee ? profil.fcMaxBpm : ''}" placeholder="${profil.fcMaxBpm ?? ''}"> bpm</span>
    </label>
    <p class="aide">${profil.fcMaxReglee || !profil.fcMaxBpm ? 'Sert aux zones de fréquence cardiaque.' : `Non réglée : l'appli prend la plus haute relevée dans tes sorties (${profil.fcMaxBpm} bpm).`}</p>
  </section>

  <button id="btn-enregistrer" class="btn principal large" type="button">Enregistrer les réglages</button>

  <section class="carte reglages" id="bloc-sauvegarde">
    <h2 class="bloc-titre">Sauvegarde</h2>
    <p class="aide">Tes sorties ne sont gardées que sur ce téléphone, dans Chrome. Exporte une sauvegarde de temps en temps
      et copie-la ailleurs (PC, Google Drive). Pour la remettre : onglet Sorties → Importer un fichier → ce zip.</p>
    <p class="sauvegarde-date" id="sauvegarde-date">${derniere ? `Dernière sauvegarde ${ilYA(derniere)}.` : 'Aucune sauvegarde pour l\'instant.'}</p>
    <div class="synchro-actions">
      <button id="btn-sauvegarder" class="btn principal" type="button">Exporter une sauvegarde</button>
      <button id="btn-restaurer" class="btn secondaire" type="button">Restaurer</button>
    </div>
    <p class="progression" id="sauvegarde-etat" hidden></p>
  </section>

  <section class="carte reglages">
    <h2 class="bloc-titre">Données</h2>
    <p class="aide" id="donnees">${nbSorties} sortie${nbSorties > 1 ? 's' : ''} sur ce téléphone.</p>
  </section>`;

  const champFtp = page.querySelector('#champ-ftp');
  const champFc = page.querySelector('#champ-fcmax');
  const estimation = page.querySelector('#estimation');
  champFtp.addEventListener('input', () => {
    const v = Number(champFtp.value);
    page.querySelector('#zones-reglages').innerHTML = v >= 50 ? tableauZones(Math.round(v)) : '';
  });

  page.querySelector('#btn-estimer').addEventListener('click', async (e) => {
    const bouton = e.currentTarget;
    bouton.disabled = true;
    estimation.hidden = false;
    estimation.textContent = 'Calcul en cours…';
    try {
      const r = await estimerMaFtp();
      if (!r) {
        estimation.innerHTML = `<p>Aucune sortie avec capteur de puissance d'au moins 20 min sur les ${JOURS_ESTIMATION_FTP / 7} dernières semaines.</p>`;
        return;
      }
      const nom = r.sortie.nom || r.sortie.nomSport;
      estimation.innerHTML = `
        <p>Meilleurs 20 min des ${JOURS_ESTIMATION_FTP / 7} dernières semaines : <b>${nombre(r.puissance20W)} W</b>
        (« ${echapper(nom)} », ${fmtDate.format(new Date(r.sortie.debut))}).
        95 % de cette valeur : <b>FTP estimée ${nombre(r.ftpW)} W</b>.</p>
        <p class="aide">Juste seulement si ces 20 min étaient un effort à fond ; sinon l'estimation est trop basse.</p>
        <button id="btn-utiliser" class="btn secondaire" type="button">Utiliser ${nombre(r.ftpW)} W</button>`;
      estimation.querySelector('#btn-utiliser').addEventListener('click', () => {
        champFtp.value = r.ftpW;
        champFtp.dispatchEvent(new Event('input'));
      });
    } catch (err) {
      console.error(err);
      estimation.textContent = `Estimation impossible : ${err.message}`;
    } finally {
      bouton.disabled = false;
    }
  });

  // Place utilisée (approximative, donnée par le navigateur)
  navigator.storage?.estimate?.().then(async (e) => {
    const persistant = await navigator.storage.persisted?.();
    const mo = e.usage / 1e6;
    page.querySelector('#donnees').textContent += ` Place utilisée : environ ${nombre(mo, mo < 10 ? 1 : 0)} Mo.${persistant ? ' Stockage protégé : Chrome ne l\'effacera pas de lui-même.' : ''}`;
  }).catch(() => {});

  page.querySelector('#btn-restaurer').addEventListener('click', () => document.getElementById('champ-fichier').click());
  page.querySelector('#btn-sauvegarder').addEventListener('click', async (e) => {
    const bouton = e.currentTarget;
    const etatTxt = page.querySelector('#sauvegarde-etat');
    bouton.disabled = true;
    etatTxt.hidden = false;
    try {
      const { blob, nomFichier, nbSorties: n } = await creerSauvegarde((t) => { etatTxt.textContent = t; });
      telecharger(blob, nomFichier);
      etatTxt.textContent = `${nomFichier} : ${n} sorties, ${nombre(blob.size / 1e6, 1)} Mo. Enregistré dans Téléchargements.`;
      page.querySelector('#sauvegarde-date').textContent = "Dernière sauvegarde à l'instant.";
    } catch (err) {
      console.error(err);
      etatTxt.textContent = `Sauvegarde impossible : ${err.message}`;
    } finally {
      bouton.disabled = false;
    }
  });

  page.querySelector('#btn-enregistrer').addEventListener('click', async () => {
    const ftp = Math.round(Number(champFtp.value));
    if (!(ftp >= 50 && ftp <= 600)) { toast('FTP à vérifier : entre 50 et 600 W.'); champFtp.focus(); return; }
    const fcTexte = champFc.value.trim();
    const fc = fcTexte ? Math.round(Number(fcTexte)) : null;
    if (fc !== null && !(fc >= 100 && fc <= 230)) { toast('FC max à vérifier : entre 100 et 230 bpm.'); champFc.focus(); return; }
    await ecrireProfil({ ftpW: ftp, fcMaxBpm: fc });
    toast(`Réglages enregistrés : FTP ${ftp} W${fc ? `, FC max ${fc} bpm` : ''}.`);
  });
}
