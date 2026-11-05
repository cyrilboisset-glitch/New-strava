// Petite carte fixe (aperçu d'une sortie ou d'un segment) : tuiles
// OpenStreetMap posées sous le tracé, sans Leaflet (léger dans une liste).
// Seules les tuiles de la zone sont demandées à internet ; sans réseau, le
// fond quadrillé reste visible. En thème sombre, les tuiles sont assombries.

const TUILE = 256;
const ZOOM_MAXI = 16;

// Web Mercator : position en pixels au zoom z
export function versPixels(lat, lon, z) {
  const n = TUILE * 2 ** z;
  const la = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n];
}

/**
 * Cadrage : zoom le plus fort où tout le tracé tient dans L × H (moins la marge).
 * @returns {{z, x0, y0, points: [x, y][]}}  x0, y0 : coin haut-gauche (pixels monde)
 */
export function cadrer(trace, L, H, marge = 18) {
  let z = ZOOM_MAXI;
  let px;
  for (; z > 1; z--) {
    px = trace.map(([la, lo]) => versPixels(la, lo, z));
    const xs = px.map((p) => p[0]); const ys = px.map((p) => p[1]);
    if (Math.max(...xs) - Math.min(...xs) <= L - 2 * marge && Math.max(...ys) - Math.min(...ys) <= H - 2 * marge) break;
  }
  px = trace.map(([la, lo]) => versPixels(la, lo, z));
  const xs = px.map((p) => p[0]); const ys = px.map((p) => p[1]);
  const x0 = (Math.min(...xs) + Math.max(...xs)) / 2 - L / 2;
  const y0 = (Math.min(...ys) + Math.max(...ys)) / 2 - H / 2;
  return { z, x0, y0, points: px.map(([x, y]) => [x - x0, y - y0]) };
}

/** Tuiles à poser : [{ z, x, y, gauche, haut }] (gauche / haut en pixels dans l'aperçu) */
export function tuiles({ z, x0, y0 }, L, H) {
  const res = [];
  const n = 2 ** z;
  for (let ty = Math.floor(y0 / TUILE); ty * TUILE < y0 + H; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(x0 / TUILE); tx * TUILE < x0 + L; tx++) {
      res.push({ z, x: ((tx % n) + n) % n, y: ty, gauche: tx * TUILE - x0, haut: ty * TUILE - y0 });
    }
  }
  return res;
}

/**
 * HTML de l'aperçu : tuiles + tracé (départ vert, arrivée foncée).
 * @param {[lat, lon][]} trace
 */
export function htmlCarteStatique(trace, { largeur = 320, hauteur = 150, classe = '' } = {}) {
  if (!trace || trace.length < 2) return '';
  const L = largeur; const H = hauteur;
  const cadre = cadrer(trace, L, H);
  const pct = (v, total) => `${((v / total) * 100).toFixed(3)}%`;
  const imgs = tuiles(cadre, L, H).map((t) =>
    `<img class="tuile" src="https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png" alt="" loading="lazy" decoding="async"
      style="left:${pct(t.gauche, L)};top:${pct(t.haut, H)};width:${pct(TUILE, L)};height:${pct(TUILE, H)}" onerror="this.remove()">`).join('');
  const d = cadre.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const [a, b] = [cadre.points[0], cadre.points[cadre.points.length - 1]];
  return `<div class="apercu carte-fond ${classe}" style="aspect-ratio:${L}/${H}">
    <div class="tuiles" aria-hidden="true">${imgs}</div>
    <svg viewBox="0 0 ${L} ${H}" aria-hidden="true"><path class="apercu-trace" d="${d}"/>
      <circle class="apercu-depart" cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="4.5"/>
      <circle class="apercu-arrivee" cx="${b[0].toFixed(1)}" cy="${b[1].toFixed(1)}" r="4.5"/></svg>
    <span class="attribution">© OpenStreetMap</span></div>`;
}

// Retire une carte Leaflet ; si un zoom animé est en cours, à la fin du zoom
// (sinon Leaflet plante en terminant son animation sur une carte retirée)
export function retirerCarte(c) {
  if (c._animatingZoom) c.once('zoomend', () => c.remove());
  else c.remove();
}
