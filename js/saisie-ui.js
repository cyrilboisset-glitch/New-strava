// Fenêtre « Ajouter une activité » : saisie à la main d'une activité sans fichier, et modification /
// suppression d'une activité saisie à la main (depuis son détail).
import { enregistrerSortie, supprimerSortie } from './db.js';
import { typesProposes } from './strava.js';
import { familleSortie, estVirtuel } from './sortie.js';
import { idSaisie, validerSaisie, resumerSaisie } from './saisie.js';
import { lireVelos } from './profil.js';
import { echapper } from './format.js';

const deuxChiffres = (n) => String(n).padStart(2, '0');
const jourLocal = (d) => `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`;
const heureLocale = (d) => `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`;
const nombreOuNul = (v) => { const n = Number(String(v).replace(',', '.')); return String(v).trim() !== '' && Number.isFinite(n) ? n : null; };

/**
 * @param {{sortie?: object|null, toast: (t: string) => void, apres?: (r: {supprimee?: boolean, id?: string}) => void}} o
 *   sortie : une activité saisie à la main à modifier ; sans elle, on en ajoute une
 */
export async function ouvrirSaisie({ sortie = null, toast, apres = () => {} }) {
  const dialogue = document.getElementById('dialogue-saisie');
  if (!dialogue) return;
  const types = typesProposes();
  const velos = (await lireVelos()).filter((v) => !v.retire || v.id === sortie?.veloId);
  const d = new Date(sortie?.debut ?? Date.now());
  const duree = sortie?.dureeChronoS ?? 0;
  // type de départ : celui de la sortie (ou le premier de la liste, le vélo)
  let indexType = sortie ? types.findIndex((t) => t.sport === sortie.sport && t.sousSport === sortie.sousSport && t.nom === sortie.nomSport) : types.findIndex((t) => t.nom === 'Vélo');
  const autre = sortie && indexType < 0;
  if (indexType < 0) indexType = 0;
  // familles dans l'ordre du menu Activité
  const ORDRE = ['Vélo', 'Vélo virtuel (home trainer)', 'Course à pied', 'Marche', 'Randonnée', 'Natation', 'Musculation', 'Entraînement', 'Ski et neige', "Sports d'eau", 'Balle et raquette', 'Escalade', 'Patins et glisse'];
  const groupes = new Map(ORDRE.map((n) => [n, []]));
  types.forEach((t, i) => {
    const f = familleSortie({ sport: t.sport, sousSport: t.sousSport, nomSport: t.nom }).nom;
    if (!groupes.has(f)) groupes.set(f, []);
    groupes.get(f).push([i, t.nom]);
  });
  const valeur = (v) => (v == null ? '' : v);
  dialogue.innerHTML = `
  <form class="saisie-form" method="dialog" novalidate>
    <h2 class="bloc-titre">${sortie ? 'Modifier l\'activité' : 'Ajouter une activité'}</h2>
    <p class="aide">Sans fichier : tu donnes toi-même les chiffres. Seuls le type, la date et la durée sont obligatoires.</p>
    <label class="champ-ligne"><span>Type d'activité</span>
      <select name="type">
        ${[...groupes].filter(([, l]) => l.length).map(([nom, l]) => `<optgroup label="${echapper(nom)}">${l.map(([i, n]) => `<option value="${i}"${!autre && i === indexType ? ' selected' : ''}>${echapper(n)}</option>`).join('')}</optgroup>`).join('')}
        <option value="autre"${autre ? ' selected' : ''}>Autre activité (je donne le nom)</option>
      </select></label>
    <label class="champ-ligne" data-autre${autre ? '' : ' hidden'}><span>Nom de l'activité</span><input name="nomAutre" type="text" maxlength="40" value="${echapper(autre ? sortie.nomSport : '')}" placeholder="Ex. : Escrime"></label>
    <label class="champ-ligne"><span>Titre (facultatif)</span><input name="nom" type="text" maxlength="80" value="${echapper(sortie?.nom ?? '')}" placeholder="Ex. : Sortie kayak sur le lac"></label>
    <div class="saisie-ligne">
      <label class="champ-ligne"><span>Date</span><input name="jour" type="date" required value="${jourLocal(d)}"></label>
      <label class="champ-ligne"><span>Heure de début</span><input name="heure" type="time" required value="${heureLocale(d)}"></label>
    </div>
    <div class="saisie-ligne saisie-duree">
      <label class="champ-ligne"><span>Durée : heures</span><input name="h" type="number" inputmode="numeric" min="0" max="300" step="1" value="${Math.floor(duree / 3600) || ''}"></label>
      <label class="champ-ligne"><span>minutes</span><input name="min" type="number" inputmode="numeric" min="0" max="59" step="1" value="${duree ? Math.floor((duree % 3600) / 60) : ''}"></label>
      <label class="champ-ligne"><span>secondes</span><input name="s" type="number" inputmode="numeric" min="0" max="59" step="1" value="${duree ? duree % 60 || '' : ''}"></label>
    </div>
    <div class="saisie-ligne">
      <label class="champ-ligne"><span>Distance (km)</span><input name="km" type="number" inputmode="decimal" min="0" step="0.01" value="${sortie?.distanceM ? sortie.distanceM / 1000 : ''}"></label>
      <label class="champ-ligne"><span>Dénivelé + (m)</span><input name="dplus" type="number" inputmode="numeric" min="0" step="1" value="${valeur(sortie?.denivelePosM)}"></label>
    </div>
    <div class="saisie-ligne">
      <label class="champ-ligne"><span>FC moyenne (bpm)</span><input name="fc" type="number" inputmode="numeric" min="30" max="250" step="1" value="${valeur(sortie?.fcMoy)}"></label>
      <label class="champ-ligne"><span>Puissance moyenne (W)</span><input name="w" type="number" inputmode="numeric" min="0" max="2500" step="1" value="${valeur(sortie?.puissanceMoyW)}"></label>
    </div>
    <label class="champ-ligne"><span>Calories (kcal)</span><input name="cal" type="number" inputmode="numeric" min="0" max="30000" step="1" value="${valeur(sortie?.calories)}"></label>
    <label class="champ-ligne" data-velo hidden><span>Vélo</span><select name="velo"><option value="">Aucun</option>${velos.map((v) => `<option value="${v.id}"${(sortie ? sortie.veloId === v.id : v.parDefaut) ? ' selected' : ''}>${echapper(v.nom)}</option>`).join('')}</select></label>
    <p class="aide" data-note-virtuel hidden>Vélo virtuel saisi à la main : seul le temps compte dans tes totaux (voir le détail pour changer).</p>
    <p class="aide erreur" data-erreurs hidden></p>
    <div class="synchro-actions">
      <button class="btn principal" type="submit" value="ok">Enregistrer</button>
      <button class="btn secondaire" type="button" data-a="annuler">Annuler</button>
      ${sortie ? '<button class="btn secondaire danger" type="button" data-a="supprimer">Supprimer</button>' : ''}
    </div>
  </form>`;
  const f = dialogue.querySelector('form');
  const typeChoisi = () => {
    if (f.type.value === 'autre') return { sport: 0, sousSport: 0, nomSport: f.nomAutre.value.trim() || 'Activité' };
    const t = types[Number(f.type.value)];
    return { sport: t.sport, sousSport: t.sousSport, nomSport: t.nom };
  };
  // vélo : seulement pour les sorties à vélo ; mot sur le vélo virtuel
  const majType = () => {
    const t = typeChoisi();
    f.querySelector('[data-autre]').hidden = f.type.value !== 'autre';
    const fam = familleSortie(t).cle;
    f.querySelector('[data-velo]').hidden = !(velos.length && (fam === 'sport-2' || fam === 'velo-virtuel'));
    f.querySelector('[data-note-virtuel]').hidden = !estVirtuel(t) || sortie?.modeVirtuel === 'parcours';
  };
  f.type.addEventListener('change', majType);
  majType();
  const fermer = () => { if (dialogue.open) dialogue.close(); };
  f.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'annuler') fermer();
    else if (a === 'supprimer') {
      if (!confirm('Supprimer cette activité ? Cette action ne peut pas être annulée.')) return;
      await supprimerSortie(sortie.id);
      fermer();
      toast('Activité supprimée.');
      apres({ supprimee: true, id: sortie.id });
    }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = typeChoisi();
    if (f.type.value === 'autre' && !f.nomAutre.value.trim()) { montrerErreurs(['Donne un nom à l\'activité.']); return; }
    const debutMs = new Date(`${f.jour.value}T${f.heure.value || '00:00'}`).getTime();
    const dureeS = (nombreOuNul(f.h.value) ?? 0) * 3600 + (nombreOuNul(f.min.value) ?? 0) * 60 + (nombreOuNul(f.s.value) ?? 0);
    const champs = {
      debutMs, dureeS, distanceKm: nombreOuNul(f.km.value), denivelePosM: nombreOuNul(f.dplus.value),
      fcMoy: nombreOuNul(f.fc.value), puissanceMoyW: nombreOuNul(f.w.value), calories: nombreOuNul(f.cal.value),
    };
    const erreurs = validerSaisie(champs);
    if (erreurs.length) { montrerErreurs(erreurs); return; }
    const resume = resumerSaisie({
      ...champs, id: sortie?.id ?? idSaisie(), nom: f.nom.value, type: t,
      veloId: f.querySelector('[data-velo]').hidden ? null : f.velo.value || null,
    });
    // en modification, on garde ce que l'appli a ajouté depuis (mode virtuel, muscles…)
    const complet = sortie ? { ...sortie, ...resume, nom: resume.nom } : resume;
    if (!resume.veloId) delete complet.veloId;
    try {
      await enregistrerSortie(complet, null, null);
    } catch (err) { console.error(err); montrerErreurs(['Enregistrement impossible.']); return; }
    fermer();
    toast(sortie ? 'Activité modifiée.' : 'Activité ajoutée.');
    apres({ id: complet.id });
  });
  f.addEventListener('input', () => { f.querySelector('[data-erreurs]').hidden = true; });
  const montrerErreurs = (l) => {
    const p = f.querySelector('[data-erreurs]');
    p.hidden = !l.length;
    p.textContent = l.join(' ');
  };
  dialogue.showModal();
}
