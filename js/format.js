// Mise en forme des nombres, durées et dates (partagée par les écrans).

export const fmtJour = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtJourLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtHeure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const fmtMois = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
export const fmtDateCourte = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

export const nombre = (v, dec = 0) => v.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const km = (m) => nombre(m / 1000, m < 100000 ? 1 : 0);

// « 58 min », « 1 h 05 »
export function duree(s) {
  if (s == null) return '–';
  const totalMin = Math.round(s / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  return `${h} h ${String(totalMin % 60).padStart(2, '0')}`;
}

// « 0:45 », « 12:03 », « 1:02:30 » (chronomètre)
export function chrono(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function ilYA(t) {
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${fmtDateCourte.format(t)}`;
}

export const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export function echapper(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Menus repliables (segments, même parcours) -------------------------------------
// Ouvert / fermé gardé pendant que l'appli est ouverte (d'une sortie à l'autre).
const repliOuverts = new Set();

/** <details> avec un titre et un résumé ; `cle` : nom du menu (ouvert ou non) */
export function htmlRepli(cle, titre, resume, contenu, forcerOuvert = false) {
  return `<details class="repli" data-repli="${cle}"${repliOuverts.has(cle) || forcerOuvert ? ' open' : ''}>
    <summary><span class="repli-titre">${titre}</span><span class="repli-resume">${resume}</span>
      <svg class="chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
    <div class="repli-contenu">${contenu}</div>
  </details>`;
}

/** Retient l'état des menus repliables d'un bloc (l'événement « toggle » ne remonte pas) */
export function suivreReplis(bloc) {
  if (bloc.dataset.replis) return;
  bloc.dataset.replis = '1';
  bloc.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.classList?.contains('repli')) return;
    if (d.open) repliOuverts.add(d.dataset.repli); else repliOuverts.delete(d.dataset.repli);
  }, true);
}
