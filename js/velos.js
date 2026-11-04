// Vélos (Profil) : liste avec kilométrage, ajout / modification, vélo par
// défaut, et attribution en lot (matériel noté sur Strava, sorties sans vélo).
import { lireVelos, ecrireVelos, nouvelIdVelo, bilanVelos } from './profil.js';
import { toutesLesSorties, mettreAJourSorties } from './db.js';
import { familleSortie } from './sortie.js';
import { nombre, echapper, fmtDate } from './format.js';

const kmTxt = (m) => `${nombre(Math.round(m / 1000))} km`;

function optionsVelos(velos, choisi = '', vide = 'Choisir un vélo') {
  return `<option value="">${vide}</option>${velos.filter((v) => !v.retire || v.id === choisi)
    .map((v) => `<option value="${v.id}"${v.id === choisi ? ' selected' : ''}>${echapper(v.nom)}</option>`).join('')}`;
}

function formulaire(v) {
  return `
  <form class="velo-form" data-id="${v?.id ?? ''}">
    <label class="champ-ligne"><span>Nom</span><input name="nom" type="text" maxlength="40" required value="${echapper(v?.nom ?? '')}" placeholder="Ex. : vélo de route"></label>
    <label class="champ-ligne"><span>Km faits avant l'appli</span><input name="kmAvant" type="number" inputmode="numeric" min="0" step="1" value="${v ? Math.round((v.kmAvantM ?? 0) / 1000) : 0}"></label>
    <label class="case"><input name="parDefaut" type="checkbox"${v?.parDefaut ? ' checked' : ''}> Vélo par défaut : mis d'office sur les nouvelles sorties vélo</label>
    <label class="case"><input name="retire" type="checkbox"${v?.retire ? ' checked' : ''}> Retiré (vendu, rangé) : n'est plus proposé</label>
    <div class="synchro-actions">
      <button class="btn principal" type="submit">Enregistrer</button>
      <button class="btn secondaire" type="button" data-action="annuler">Annuler</button>
      ${v ? '<button class="btn secondaire danger" type="button" data-action="supprimer">Supprimer</button>' : ''}
    </div>
  </form>`;
}

/**
 * Remplit la section `bloc` (dans la page Profil).
 * @param {HTMLElement} bloc
 * @param {(texte: string) => void} toast
 */
export async function afficherVelos(bloc, toast) {
  const velos = await lireVelos();
  const sorties = await toutesLesSorties();
  const bilan = bilanVelos(velos, sorties);
  let edition = null; // id du vélo en cours de modification, ou 'nouveau'

  // Matériel noté sur Strava (archive) pour les sorties vélo, regroupé par nom
  const materiels = new Map();
  for (const s of sorties) {
    if (!s.materielStrava || familleSortie(s).cle !== 'sport-2') continue; // pas les chaussures
    const m = materiels.get(s.materielStrava) ?? { n: 0, sansVelo: 0 };
    m.n++;
    if (!s.veloId) m.sansVelo++;
    materiels.set(s.materielStrava, m);
  }
  const veloSansVelo = sorties.filter((s) => !s.veloId && familleSortie(s).cle === 'sport-2');

  const rendre = () => {
    const liste = velos.map((v) => {
      if (edition === v.id) return formulaire(v);
      const b = bilan[v.id];
      return `
      <div class="velo${v.retire ? ' retire' : ''}">
        <div class="velo-texte">
          <p class="velo-nom">${echapper(v.nom)}${v.parDefaut ? ' <span class="badge">par défaut</span>' : ''}${v.retire ? ' <span class="badge">retiré</span>' : ''}</p>
          <p class="velo-km"><b>${kmTxt(b.distanceM)}</b> · ${b.n} sortie${b.n > 1 ? 's' : ''}${b.derniere ? ` · dernière le ${fmtDate.format(b.derniere)}` : ''}${v.kmAvantM ? ` · dont ${kmTxt(v.kmAvantM)} avant l'appli` : ''}</p>
        </div>
        <button class="btn secondaire petit" type="button" data-action="modifier" data-id="${v.id}">Modifier</button>
      </div>`;
    }).join('');
    const actifs = velos.filter((v) => !v.retire);
    const lots = [];
    if (actifs.length && materiels.size) {
      lots.push(`<h3 class="sous-titre">Matériel noté sur Strava</h3>
        <p class="aide">Pour reprendre l'historique : choisis le vélo correspondant à chaque matériel de ton archive Strava.</p>
        ${[...materiels].sort((a, b) => b[1].n - a[1].n).map(([nom, m]) => `
        <div class="lot" data-materiel="${echapper(nom)}">
          <span class="lot-texte">« ${echapper(nom)} » : ${m.n} sortie${m.n > 1 ? 's' : ''}</span>
          <select aria-label="Vélo pour ${echapper(nom)}">${optionsVelos(velos)}</select>
          <button class="btn secondaire petit" type="button" data-action="lot-materiel">Attribuer</button>
        </div>`).join('')}`);
    }
    if (actifs.length && veloSansVelo.length) {
      lots.push(`<h3 class="sous-titre">Sorties vélo sans vélo</h3>
        <div class="lot" data-lot="sans-velo">
          <span class="lot-texte">${veloSansVelo.length} sortie${veloSansVelo.length > 1 ? 's' : ''}</span>
          <select aria-label="Vélo pour les sorties sans vélo">${optionsVelos(velos)}</select>
          <button class="btn secondaire petit" type="button" data-action="lot-sans-velo">Attribuer</button>
        </div>`);
    }
    bloc.innerHTML = `
      <h2 class="bloc-titre">Vélos</h2>
      ${velos.length ? '' : '<p class="aide">Ajoute tes vélos pour suivre leur kilométrage. Chaque sortie vélo peut ensuite recevoir son vélo (dans le détail de la sortie).</p>'}
      <div class="velos">${liste}</div>
      ${edition === 'nouveau' ? formulaire(null) : '<button class="btn secondaire" type="button" data-action="ajouter">Ajouter un vélo</button>'}
      ${lots.join('')}`;
    bloc.querySelector('.velo-form input[name="nom"]')?.focus();
  };
  rendre();

  const recharger = () => afficherVelos(bloc, toast);

  bloc.onclick = async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;
    if (action === 'ajouter') { edition = 'nouveau'; rendre(); }
    else if (action === 'modifier') { edition = b.dataset.id; rendre(); }
    else if (action === 'annuler') { edition = null; rendre(); }
    else if (action === 'supprimer') {
      const id = b.closest('form').dataset.id;
      const v = velos.find((x) => x.id === id);
      const n = bilan[id]?.n ?? 0;
      if (!confirm(`Supprimer « ${v.nom} » ?${n ? ` Ses ${n} sorties n'auront plus de vélo.` : ''}`)) return;
      await ecrireVelos(velos.filter((x) => x.id !== id));
      await mettreAJourSorties(sorties.filter((s) => s.veloId === id).map((s) => s.id), { veloId: null });
      toast(`« ${v.nom} » supprimé.`);
      await recharger();
    } else if (action === 'lot-materiel' || action === 'lot-sans-velo') {
      const lot = b.closest('.lot');
      const veloId = lot.querySelector('select').value;
      if (!veloId) { toast('Choisis d\'abord un vélo.'); return; }
      const ids = action === 'lot-materiel'
        ? sorties.filter((s) => s.materielStrava === lot.dataset.materiel).map((s) => s.id)
        : veloSansVelo.map((s) => s.id);
      await mettreAJourSorties(ids, { veloId });
      toast(`${ids.length} sortie${ids.length > 1 ? 's' : ''} attribuée${ids.length > 1 ? 's' : ''} à « ${velos.find((v) => v.id === veloId).nom} ».`);
      await recharger();
    }
  };

  bloc.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const nom = f.nom.value.trim();
    if (!nom) { toast('Donne un nom au vélo.'); return; }
    const km = Number(f.kmAvant.value || 0);
    if (!(km >= 0 && km < 1e6)) { toast('Km à vérifier.'); return; }
    const champs = { nom, kmAvantM: Math.round(km) * 1000, parDefaut: f.parDefaut.checked, retire: f.retire.checked };
    const id = f.dataset.id;
    let liste;
    if (id) liste = velos.map((v) => (v.id === id ? { ...v, ...champs } : v));
    else liste = [...velos, { id: nouvelIdVelo(), ...champs }];
    // Le nouveau vélo par défaut remplace l'ancien
    if (champs.parDefaut) for (const v of liste) if (v.id !== (id || liste[liste.length - 1].id)) v.parDefaut = false;
    await ecrireVelos(liste);
    toast(`Vélo « ${nom} » enregistré.`);
    await recharger();
  };
}

/** Menu de choix du vélo dans le détail d'une sortie */
export function htmlChoixVelo(velos, s) {
  if (!velos.length) return '<p class="velo-sortie aide">Ajoute tes vélos dans Profil pour suivre leur kilométrage.</p>';
  return `<label class="velo-sortie"><span>Vélo</span><select id="choix-velo">${optionsVelos(velos, s.veloId ?? '', 'Aucun')}</select></label>`;
}
