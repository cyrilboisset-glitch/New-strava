// Panneau « Partager en image » du détail d'une sortie : choix du format, photos
// prises pendant la sortie (placées sur la carte par leur heure ou leur position),
// aperçu, partage (Instagram, Facebook, WhatsApp… par le menu de partage
// d'Android) ou enregistrement de l'image. Les photos restent sur le téléphone et
// ne sont pas gardées par l'appli (seulement le temps de faire l'image).
import {
  dessinerImageSortie, chiffresImage, lireExif, placerPhoto, FORMATS_IMAGE, sousTitreImage, NOM_APPLI,
} from './image-sortie.js';
import { telecharger } from './sauvegarde.js';
import { nombre } from './format.js';

export const PHOTOS_MAXI = 4;
let etat = null; // { sortieId, format, photos: [{ img, url, place, nom }] }

function liberer() {
  for (const p of etat?.photos ?? []) { p.img.close?.(); URL.revokeObjectURL(p.url); }
}

export const htmlBoutonImage = () => '<button class="btn principal" type="button" id="btn-image-sortie">📷 Partager en image</button>';
export const htmlBlocImage = () => '<section class="carte bloc" id="bloc-image" hidden></section>';

/**
 * @param {HTMLElement} page
 * @param {{s: object, pts: object[], nbRecords: number, estimee: boolean, toast: (t: string) => void}} o
 */
export function installerImageSortie(page, { s, pts, nbRecords, estimee, toast }) {
  const bouton = page.querySelector('#btn-image-sortie');
  const bloc = page.querySelector('#bloc-image');
  if (!bouton || !bloc) return;
  // photos gardées tant qu'on reste sur la même sortie
  if (etat?.sortieId !== s.id) { liberer(); etat = { sortieId: s.id, format: 'portrait', photos: [] }; }

  // Tracé simplifié (1 500 points au plus) et correspondance avec les indices des points
  const avecPos = [];
  pts.forEach((p, i) => { if (typeof p.lat === 'number') avecPos.push(i); });
  const pas = Math.max(1, Math.ceil(avecPos.length / 1500));
  const garde = avecPos.filter((_, k) => k % pas === 0 || k === avecPos.length - 1);
  const trace = garde.map((i) => [pts[i].lat, pts[i].lon]);
  const versK = (i) => {
    if (i == null || !garde.length) return null;
    let bas = 0; let haut = garde.length - 1;
    while (bas < haut) { const m = (bas + haut) >> 1; if (garde[m] < i) bas = m + 1; else haut = m; }
    return bas > 0 && i - garde[bas - 1] < garde[bas] - i ? bas - 1 : bas;
  };
  const chiffres = chiffresImage(s, { estimee });
  const titre = s.nom || s.nomSport || 'Sortie';

  let rendu = 0;
  let canvas = null;
  const dessiner = async () => {
    const n = ++rendu;
    const c = document.createElement('canvas');
    c.className = 'image-sortie';
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', `Image de la sortie, format ${FORMATS_IMAGE[etat.format].nom}`);
    await dessinerImageSortie(c, {
      format: etat.format, sortie: s, trace, chiffres, nbRecords, sousTitre: sousTitreImage(s),
      photos: etat.photos.map((p, k) => ({ img: p.img, k: p.place.dansSortie ? versK(p.place.i) : null, n: k + 1 })),
    });
    if (n !== rendu || !bloc.isConnected) return;
    canvas = c;
    const zone = bloc.querySelector('.apercu-image');
    zone.replaceChildren(c);
    zone.classList.remove('en-cours');
  };

  const textePlace = (p) => (!p.place.dansSortie ? 'hors de la sortie'
    : p.place.distanceM != null ? `km ${nombre(p.place.distanceM / 1000, 1)}` : 'pendant la sortie');

  const rendre = () => {
    const f = FORMATS_IMAGE[etat.format];
    bloc.innerHTML = `
      <h2 class="bloc-titre">Image à partager</h2>
      <div class="segments defile formats-image" role="group" data-segments="format-image">${Object.entries(FORMATS_IMAGE).map(([k, x]) =>
        `<button type="button" data-valeur="${k}" aria-pressed="${k === etat.format}">${x.nom}</button>`).join('')}</div>
      <p class="aide">${f.usage} · ${f.l} × ${f.h} px.${etat.format === 'carre' || etat.format === 'paysage' ? ' Une seule photo dans ce format.' : ''}</p>
      ${etat.photos.length ? `<div class="photos-image">${etat.photos.map((p, k) => `
        <div class="photo-vignette${k === 0 ? ' principale' : ''}">
          <button class="photo-choisir" type="button" data-photo-principale="${k}" aria-label="Mettre la photo ${k + 1} en grand"><img src="${p.url}" alt=""></button>
          <span>${k + 1}. ${textePlace(p)}</span>
          <button class="photo-retirer" type="button" data-photo-retirer="${k}" aria-label="Retirer la photo ${k + 1}">✕</button>
        </div>`).join('')}</div>` : ''}
      ${etat.photos.length < PHOTOS_MAXI ? `<label class="btn secondaire ajout-photos">＋ Ajouter des photos de la sortie<input type="file" id="photos-image" accept="image/*" multiple hidden></label>` : ''}
      <div class="apercu-image en-cours">${canvas ? '' : '<p class="aide">Préparation de l\'image…</p>'}</div>
      <div class="synchro-actions">
        <button class="btn principal" type="button" data-image="partager">Partager…</button>
        <button class="btn secondaire" type="button" data-image="enregistrer">Enregistrer l'image</button>
      </div>
      <p class="bloc-note">« Partager » ouvre le menu d'Android : choisis Instagram, Facebook, WhatsApp… Les photos sont placées sur la carte par leur heure (ou leur position) ; touche une photo pour la mettre en grand. Elles restent sur ton téléphone et ne sont pas gardées par l'appli.</p>`;
    if (canvas) bloc.querySelector('.apercu-image').replaceChildren(canvas);
    dessiner().catch((e) => { console.error(e); toast(`Image impossible : ${e.message}`); });
  };

  const ajouterPhotos = async (fichiers) => {
    for (const f of fichiers.slice(0, PHOTOS_MAXI - etat.photos.length)) {
      try {
        const info = lireExif(await f.slice(0, 256 * 1024).arrayBuffer());
        const img = await createImageBitmap(f, { resizeWidth: 1600, resizeQuality: 'high' });
        etat.photos.push({ img, url: URL.createObjectURL(f), place: placerPhoto(info, pts, s.debut), nom: f.name });
      } catch (e) {
        toast(`Photo illisible : ${f.name}`);
      }
    }
    if (fichiers.length > PHOTOS_MAXI) toast(`${PHOTOS_MAXI} photos au plus.`);
    // celles de la sortie d'abord, dans l'ordre du parcours
    etat.photos.sort((a, b) => (b.place.dansSortie - a.place.dansSortie) || ((a.place.distanceM ?? 0) - (b.place.distanceM ?? 0)));
    rendre();
  };

  const exporter = async (partager) => {
    if (!canvas) return;
    let blob;
    try { blob = await new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error('image vide'))), 'image/jpeg', 0.92)); } catch (e) { toast(`Image impossible : ${e.message}`); return; }
    const jour = new Date(s.debut).toISOString().slice(0, 10);
    const base = titre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sortie';
    const fichier = new File([blob], `${jour}-${base}-${etat.format}.jpg`, { type: 'image/jpeg' });
    if (partager && navigator.canShare?.({ files: [fichier] })) {
      try { await navigator.share({ files: [fichier], title: titre, text: `${titre} — avec ${NOM_APPLI}` }); } catch (e) { if (e.name !== 'AbortError') toast(`Partage impossible : ${e.message}`); }
      return;
    }
    telecharger(fichier, fichier.name);
    toast(`${fichier.name} enregistré dans Téléchargements.`);
  };

  bouton.onclick = () => {
    bloc.hidden = !bloc.hidden;
    if (!bloc.hidden) { rendre(); bloc.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };
  bloc.onclick = (e) => {
    const fmt = e.target.closest('[data-segments="format-image"] button');
    if (fmt) { etat.format = fmt.dataset.valeur; canvas = null; rendre(); return; }
    const r = e.target.closest('[data-photo-retirer]');
    if (r) { const [p] = etat.photos.splice(Number(r.dataset.photoRetirer), 1); p.img.close?.(); URL.revokeObjectURL(p.url); rendre(); return; }
    const pp = e.target.closest('[data-photo-principale]');
    if (pp) { const [p] = etat.photos.splice(Number(pp.dataset.photoPrincipale), 1); etat.photos.unshift(p); rendre(); return; }
    const a = e.target.closest('[data-image]')?.dataset.image;
    if (a) exporter(a === 'partager');
  };
  bloc.onchange = (e) => {
    if (e.target.id !== 'photos-image') return;
    const fichiers = [...e.target.files];
    e.target.value = '';
    ajouterPhotos(fichiers);
  };
}
