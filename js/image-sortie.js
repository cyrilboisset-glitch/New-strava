// Image d'une sortie à partager sur les réseaux (Instagram, Facebook, WhatsApp…) :
// carte OpenStreetMap avec le tracé, chiffres principaux, photos prises pendant la
// sortie, et le nom de l'appli. Formats adaptés à chaque usage. Tout est dessiné
// sur le téléphone (canvas) ; seules les tuiles de la carte viennent d'internet.
// Partie sans navigateur (formats, chiffres, EXIF, position des photos) testée dans
// tests/test-image.mjs.
import { cadrer, tuiles } from './carte-statique.js';
import { nombre, km, duree, fmtJourLong } from './format.js';

export const NOM_APPLI = 'GOATout';
export const ACCROCHE_APPLI = 'Go out. Be the GOAT.';
export const ADRESSE_APPLI = 'cyrilboisset-glitch.github.io/New-strava';

/** Formats (pixels) : tailles conseillées par les réseaux */
export const FORMATS_IMAGE = {
  portrait: { l: 1080, h: 1350, nom: 'Portrait 4:5', usage: 'Publication Instagram ou Facebook (la plus grande dans le fil)' },
  story: { l: 1080, h: 1920, nom: 'Story 9:16', usage: 'Story Instagram ou Facebook, statut WhatsApp' },
  carre: { l: 1080, h: 1080, nom: 'Carré 1:1', usage: 'Instagram, Facebook, message WhatsApp' },
  paysage: { l: 1200, h: 630, nom: 'Paysage', usage: 'Facebook, aperçu de lien, WhatsApp' },
};

// ---- Chiffres affichés -------------------------------------------------------------

/**
 * Chiffres principaux, dans l'ordre d'importance, 6 au plus.
 * @returns {{label: string, valeur: string, unite: string}[]}
 */
export function chiffresImage(s, { estimee = false } = {}) {
  const res = [];
  const ajout = (label, valeur, unite = '') => { if (valeur != null && valeur !== '') res.push({ label, valeur, unite }); };
  if (s.distanceM > 0) ajout('Distance', km(s.distanceM), 'km');
  if (s.dureeChronoS != null) ajout('Temps', duree(s.dureeChronoS));
  if (s.denivelePosM != null && s.distanceM > 0) ajout('Dénivelé', nombre(s.denivelePosM), 'm');
  if (s.vitesseMoyMs > 0) ajout('Vitesse moy.', nombre(s.vitesseMoyMs * 3.6, 1), 'km/h');
  if (s.puissanceNormW) ajout('Puissance NP', nombre(s.puissanceNormW), 'W');
  else if (s.puissanceMoyW) ajout('Puissance moy.', nombre(s.puissanceMoyW), 'W');
  else if (estimee && s.puissanceEstimee?.normW) ajout('Puiss. estimée', `≈ ${nombre(s.puissanceEstimee.normW)}`, 'W');
  if (s.fcMoy) ajout('FC moyenne', nombre(s.fcMoy), 'bpm');
  if (s.calories) ajout('Calories', nombre(s.calories), 'kcal');
  return res.slice(0, 6);
}

// ---- Photos : date et position (EXIF) ----------------------------------------------

/**
 * Date de prise de vue et position GPS d'une photo JPEG (EXIF), si présentes.
 * La date sans fuseau est lue à l'heure du téléphone. Android retire souvent la
 * position des photos choisies dans la galerie : la date sert alors à les placer.
 * @param {ArrayBuffer} buffer
 * @returns {{dateMs: number|null, lat: number|null, lon: number|null}}
 */
export function lireExif(buffer) {
  const res = { dateMs: null, lat: null, lon: null };
  const v = new DataView(buffer);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return res;
  let o = 2;
  while (o + 4 <= v.byteLength) {
    const marqueur = v.getUint16(o);
    const long = v.getUint16(o + 2);
    if (marqueur === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return lireTiff(v, o + 10, res); // « Exif »
    if ((marqueur & 0xff00) !== 0xff00 || marqueur === 0xffda) break;
    o += 2 + long;
  }
  return res;
}

function lireTiff(v, t, res) {
  if (t + 8 > v.byteLength) return res;
  const le = v.getUint16(t) === 0x4949; // « II » : petit-boutiste
  const u16 = (p) => v.getUint16(t + p, le);
  const u32 = (p) => v.getUint32(t + p, le);
  const ascii = (p, n) => { let s = ''; for (let k = 0; k < n - 1 && t + p + k < v.byteLength; k++) s += String.fromCharCode(v.getUint8(t + p + k)); return s; };
  const entrees = (ifd) => {
    const n = u16(ifd);
    const liste = [];
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + 12 * k;
      liste.push({ tag: u16(e), type: u16(e + 2), n: u32(e + 4), valeur: e + 8 });
    }
    return liste;
  };
  const texte = (e) => ascii(e.n > 4 ? u32(e.valeur) : e.valeur, e.n);
  const rationnels = (e) => { const p = u32(e.valeur); return Array.from({ length: e.n }, (_, k) => u32(p + 8 * k) / (u32(p + 8 * k + 4) || 1)); };
  try {
    const ifd0 = entrees(u32(4));
    const exif = ifd0.find((e) => e.tag === 0x8769);
    const gps = ifd0.find((e) => e.tag === 0x8825);
    if (exif) {
      const ex = entrees(u32(exif.valeur));
      const date = ex.find((e) => e.tag === 0x9003) ?? ex.find((e) => e.tag === 0x9004);
      const decalage = ex.find((e) => e.tag === 0x9011);
      const m = date && texte(date).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (m) {
        const [, a, mo, j, h, mi, se] = m.map(Number);
        const d = decalage && texte(decalage).match(/^([+-])(\d{2}):(\d{2})/);
        res.dateMs = d
          ? Date.UTC(a, mo - 1, j, h, mi, se) - (d[1] === '-' ? -1 : 1) * (Number(d[2]) * 60 + Number(d[3])) * 60000
          : new Date(a, mo - 1, j, h, mi, se).getTime();
      }
    }
    if (gps) {
      const g = entrees(u32(gps.valeur));
      const val = (tag) => g.find((e) => e.tag === tag);
      const ref = (tag) => { const e = val(tag); return e ? String.fromCharCode(v.getUint8(t + e.valeur)) : ''; };
      const deg = (tag) => { const e = val(tag); if (!e) return null; const [d, m, s] = rationnels(e); return d + m / 60 + s / 3600; };
      const la = deg(2); const lo = deg(4);
      if (la != null && lo != null && (la || lo)) {
        res.lat = ref(1) === 'S' ? -la : la;
        res.lon = ref(3) === 'W' ? -lo : lo;
      }
    }
  } catch { /* EXIF abîmé : on garde ce qui a été lu */ }
  return res;
}

/**
 * Place une photo sur la sortie : par sa position GPS (à moins de 300 m du tracé),
 * sinon par son heure (prise entre le départ et l'arrivée, 10 min de marge).
 * @param {{dateMs, lat, lon}} info
 * @param {{tS, lat?, lon?, distanceM}[]} pts
 * @returns {{i: number|null, dansSortie: boolean, distanceM: number|null}}
 */
export function placerPhoto(info, pts, debutMs) {
  const gps = pts.map((p, i) => [p, i]).filter(([p]) => typeof p.lat === 'number');
  if (info.lat != null && gps.length) {
    let meilleur = null; let dMin = Infinity;
    for (const [p, i] of gps) {
      const d = Math.hypot((p.lat - info.lat) * 111195, (p.lon - info.lon) * 111195 * Math.cos((info.lat * Math.PI) / 180));
      if (d < dMin) { dMin = d; meilleur = i; }
    }
    if (dMin <= 300) return { i: meilleur, dansSortie: true, distanceM: pts[meilleur].distanceM };
  }
  if (info.dateMs != null && pts.length) {
    const tS = (info.dateMs - debutMs) / 1000;
    const finS = pts[pts.length - 1].tS;
    if (tS >= -600 && tS <= finS + 600) {
      let i = 0;
      while (i < pts.length - 1 && pts[i + 1].tS <= tS) i++;
      const avecPos = typeof pts[i].lat === 'number' ? i : (gps.length ? gps.reduce((a, [, k]) => (Math.abs(k - i) < Math.abs(a - i) ? k : a), gps[0][1]) : null);
      return { i: avecPos, dansSortie: true, distanceM: avecPos != null ? pts[avecPos].distanceM : null };
    }
  }
  return { i: null, dansSortie: false, distanceM: null };
}

// ---- Dessin (navigateur) ------------------------------------------------------------

const C = {
  fond: '#0f0e0d', panneau: '#1c1a17', texte: '#f4efe6', gris: '#b9b1a3', accent: '#f0cf73', cuivre: '#e9a178',
  trace: '#ff6a13', depart: '#2e9e4f', or: '#f2c230', photo: '#1e88e5',
};
const CHIFFRES = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const MARQUE = "'Space Grotesk', 'Barlow Condensed', sans-serif";

// Icône de l'appli (même fichier que l'icône installée) ; sans elle, un petit logo dessiné
let logoImg = null;
function chargerLogo() {
  return new Promise((ok) => {
    const img = new Image();
    const fin = setTimeout(() => ok(null), 3000);
    img.onload = () => { clearTimeout(fin); ok(img); };
    img.onerror = () => { clearTimeout(fin); ok(null); };
    img.src = 'icons/icone-192.png';
  });
}
const TEXTE = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function chargerTuile(url, delaiMs = 6000) {
  return new Promise((ok) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // tuiles OSM servies avec CORS : l'image reste exportable
    const fin = setTimeout(() => ok(null), delaiMs);
    img.onload = () => { clearTimeout(fin); ok(img); };
    img.onerror = () => { clearTimeout(fin); ok(null); };
    img.src = url;
  });
}

function couvrir(ctx, img, x, y, w, h) {
  const iw = img.width; const ih = img.height;
  const e = Math.max(w / iw, h / ih);
  const sw = w / e; const sh = h / e;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

function arrondi(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function tronquer(ctx, texte, largeur) {
  if (ctx.measureText(texte).width <= largeur) return texte;
  let t = texte;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > largeur) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

// Texte sur au plus `max` lignes (coupé aux espaces)
function lignes(ctx, texte, largeur, max) {
  const mots = texte.split(/\s+/);
  const res = [];
  let ligne = '';
  for (const m of mots) {
    const essai = ligne ? `${ligne} ${m}` : m;
    if (ctx.measureText(essai).width <= largeur || !ligne) ligne = essai;
    else { res.push(ligne); ligne = m; }
  }
  if (ligne) res.push(ligne);
  if (res.length > max) { res.length = max; res[max - 1] = tronquer(ctx, `${res[max - 1]} …`, largeur); }
  return res;
}

// Pastille numérotée (photos sur la carte et sur les photos)
function pastille(ctx, x, y, n, r = 22) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = C.photo; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(r * 1.15)}px ${TEXTE}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 1);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

/** Carte : tuiles OSM claires, tracé orange liseré de blanc, départ / arrivée, photos */
async function dessinerCarte(ctx, trace, x, y, w, h, rayon, reperes) {
  ctx.save();
  arrondi(ctx, x, y, w, h, rayon); ctx.clip();
  ctx.fillStyle = '#23272f'; ctx.fillRect(x, y, w, h);
  if (trace.length >= 2) {
    const cadre = cadrer(trace, w, h, Math.round(Math.min(w, h) * 0.08));
    const liste = tuiles(cadre, w, h);
    const imgs = await Promise.all(liste.map((t) => chargerTuile(`https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`)));
    // carte claire (comme dans l'appli), même sur le fond sombre de l'image
    liste.forEach((t, k) => { if (imgs[k]) ctx.drawImage(imgs[k], x + t.gauche, y + t.haut, 256, 256); });
    const p = cadre.points.map(([a, b]) => [x + a, y + b]);
    const chemin = () => { ctx.beginPath(); p.forEach(([a, b], k) => (k ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    chemin(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(9, w / 90); ctx.stroke();
    chemin(); ctx.strokeStyle = C.trace; ctx.lineWidth = Math.max(5, w / 160); ctx.stroke();
    const rond = ([a, b], couleur) => { ctx.beginPath(); ctx.arc(a, b, Math.max(9, w / 70), 0, Math.PI * 2); ctx.fillStyle = couleur; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke(); };
    rond(p[p.length - 1], '#15171b');
    rond(p[0], C.depart);
    for (const r of reperes) if (p[r.k]) pastille(ctx, p[r.k][0], p[r.k][1], r.n, Math.max(16, w / 34));
  }
  ctx.restore();
  ctx.save();
  arrondi(ctx, x, y, w, h, rayon); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.stroke();
  ctx.restore();
}

// Logo et nom de l'appli (promotion)
function marque(ctx, x, yBas, taille, largeurMax) {
  const s = taille;
  ctx.save();
  if (logoImg) ctx.drawImage(logoImg, x, yBas - s, s, s);
  else {
    arrondi(ctx, x, yBas - s, s, s, s * 0.24); ctx.fillStyle = C.fond; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.2, yBas - s * 0.3); ctx.lineTo(x + s * 0.42, yBas - s * 0.62); ctx.lineTo(x + s * 0.6, yBas - s * 0.42); ctx.lineTo(x + s * 0.8, yBas - s * 0.75);
    ctx.lineWidth = s * 0.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = C.accent; ctx.stroke();
  }
  // GOAT en crème, « out » en or
  ctx.font = `700 ${Math.round(s * 0.6)}px ${MARQUE}`;
  const yMot = yBas - s * 0.42;
  ctx.fillStyle = C.texte; ctx.fillText('GOAT', x + s * 1.25, yMot);
  ctx.fillStyle = C.accent; ctx.fillText('out', x + s * 1.25 + ctx.measureText('GOAT').width, yMot);
  ctx.fillStyle = C.gris; ctx.font = `400 ${Math.round(s * 0.3)}px ${TEXTE}`;
  ctx.fillText(tronquer(ctx, ADRESSE_APPLI, largeurMax - s * 1.25), x + s * 1.25, yBas - s * 0.02);
  ctx.restore();
}

// Grille des chiffres : libellé en petit, valeur en grand
function grilleChiffres(ctx, chiffres, x, y, w, colonnes, hLigne, tailleValeur) {
  const lc = w / colonnes;
  chiffres.forEach((c, k) => {
    const cx = x + (k % colonnes) * lc;
    const cy = y + Math.floor(k / colonnes) * hLigne;
    ctx.fillStyle = C.gris; ctx.font = `500 ${Math.round(tailleValeur * 0.36)}px ${TEXTE}`;
    ctx.fillText(c.label.toUpperCase(), cx, cy + tailleValeur * 0.36);
    ctx.fillStyle = C.texte; ctx.font = `600 ${tailleValeur}px ${CHIFFRES}`;
    const v = tronquer(ctx, c.valeur, lc - 12);
    ctx.fillText(v, cx, cy + tailleValeur * 1.32);
    if (c.unite) {
      const lv = ctx.measureText(v).width;
      ctx.fillStyle = C.gris; ctx.font = `500 ${Math.round(tailleValeur * 0.45)}px ${CHIFFRES}`;
      ctx.fillText(c.unite, cx + lv + 8, cy + tailleValeur * 1.32);
    }
  });
}

/**
 * Dessine l'image de la sortie.
 * @param {HTMLCanvasElement} canvas
 * @param {{format: string, sortie: object, trace: [lat, lon][], chiffres: object[], photos: {img, k: number|null, n: number}[],
 *   nbRecords: number, sousTitre: string}} o   photos[].k : indice dans `trace` (null = hors tracé)
 */
export async function dessinerImageSortie(canvas, o) {
  const f = FORMATS_IMAGE[o.format] ?? FORMATS_IMAGE.portrait;
  const W = f.l; const H = f.h;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  try { await Promise.all([...['500', '600', '700'].map((p) => document.fonts.load(`${p} 40px 'Barlow Condensed'`)), document.fonts.load("700 40px 'Space Grotesk'")]); } catch { /* police de secours */ }
  logoImg ??= await chargerLogo();
  ctx.fillStyle = C.fond; ctx.fillRect(0, 0, W, H);
  const titre = o.sortie.nom || o.sortie.nomSport || 'Sortie';
  const reperes = o.photos.filter((p) => p.k != null).map((p) => ({ k: p.k, n: p.n }));
  const photos = o.photos;

  // Zone visuelle : photo principale + carte en médaillon, ou carte seule
  const visuel = async (x, y, w, h, rayon, avecVignettes) => {
    if (!photos.length) {
      if (o.trace.length >= 2) await dessinerCarte(ctx, o.trace, x, y, w, h, rayon, reperes);
      else {
        const g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, '#2a3a12'); g.addColorStop(1, C.panneau);
        ctx.save(); arrondi(ctx, x, y, w, h, rayon); ctx.fillStyle = g; ctx.fill();
        ctx.fillStyle = C.accent; ctx.font = `700 ${Math.round(h * 0.18)}px ${CHIFFRES}`; ctx.textAlign = 'center';
        ctx.fillText(o.sortie.nomSport ?? 'Sortie', x + w / 2, y + h / 2 + h * 0.06); ctx.restore();
      }
      return;
    }
    const nVig = avecVignettes ? Math.min(3, photos.length - 1) : 0;
    const hVig = nVig ? Math.min(260, h * 0.26) : 0;
    const hPrincipal = h - (nVig ? hVig + 16 : 0);
    ctx.save(); arrondi(ctx, x, y, w, hPrincipal, rayon); ctx.clip();
    couvrir(ctx, photos[0].img, x, y, w, hPrincipal);
    // dégradé discret pour détacher le médaillon
    const g = ctx.createLinearGradient(0, y + hPrincipal * 0.55, 0, y + hPrincipal);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, hPrincipal);
    ctx.restore();
    if (photos[0].k != null) pastille(ctx, x + 40, y + 40, photos[0].n, 24);
    if (o.trace.length >= 2) {
      const mw = Math.round(Math.min(w * 0.42, hPrincipal * 0.6));
      const mh = Math.round(mw * 0.78);
      await dessinerCarte(ctx, o.trace, x + 20, y + hPrincipal - mh - 20, mw, mh, rayon * 0.7, reperes);
    }
    for (let k = 0; k < nVig; k++) {
      const lv = (w - 16 * (nVig - 1)) / nVig;
      const vx = x + k * (lv + 16); const vy = y + hPrincipal + 16;
      ctx.save(); arrondi(ctx, vx, vy, lv, hVig, rayon * 0.7); ctx.clip();
      couvrir(ctx, photos[k + 1].img, vx, vy, lv, hVig); ctx.restore();
      if (photos[k + 1].k != null) pastille(ctx, vx + 30, vy + 30, photos[k + 1].n, 20);
    }
  };

  const records = o.nbRecords > 0 ? `🏆 ${o.nbRecords} record${o.nbRecords > 1 ? 's' : ''} perso sur les segments` : '';

  if (o.format === 'paysage') {
    const pad = 36;
    const wv = 640;
    await visuel(pad, pad, wv, H - 2 * pad, 24, false);
    const x = pad + wv + 36; const w = W - x - pad;
    let y = pad;
    ctx.fillStyle = C.texte; ctx.font = `700 46px ${CHIFFRES}`;
    for (const l of lignes(ctx, titre, w, 2)) { y += 46; ctx.fillText(l, x, y); }
    ctx.fillStyle = C.gris; ctx.font = `400 21px ${TEXTE}`;
    y += 34; ctx.fillText(tronquer(ctx, o.sousTitre, w), x, y);
    y += 26;
    grilleChiffres(ctx, o.chiffres, x, y, w, 2, 92, 54);
    y += Math.ceil(o.chiffres.length / 2) * 92;
    if (records) { ctx.fillStyle = C.or; ctx.font = `600 22px ${TEXTE}`; ctx.fillText(tronquer(ctx, records, w), x, Math.min(y + 18, H - pad - 70)); }
    marque(ctx, x, H - pad, 52, w);
    return canvas;
  }

  // Formats verticaux : titre, visuel, chiffres, marque
  const pad = 60;
  const haut = o.format === 'story' ? 220 : pad; // story : place pour les boutons d'Instagram
  const bas = o.format === 'story' ? 230 : pad;
  const tailleTitre = o.format === 'carre' ? 56 : 66;
  const tailleValeur = o.format === 'carre' ? 60 : 70;
  const hLigne = Math.round(tailleValeur * 1.75);
  const nLignesChiffres = Math.ceil(o.chiffres.length / 3);
  ctx.font = `700 ${tailleTitre}px ${CHIFFRES}`;
  const lt = lignes(ctx, titre, W - 2 * pad, o.format === 'carre' ? 1 : 2);
  let y = haut;
  ctx.fillStyle = C.texte;
  for (const l of lt) { y += tailleTitre; ctx.fillText(l, pad, y); }
  ctx.fillStyle = C.gris; ctx.font = `400 ${o.format === 'carre' ? 28 : 31}px ${TEXTE}`;
  y += 46; ctx.fillText(tronquer(ctx, o.sousTitre, W - 2 * pad), pad, y);
  y += 30;
  const hMarque = 78;
  const hRecords = records ? 54 : 0;
  const hChiffres = nLignesChiffres * hLigne;
  const hVisuel = H - bas - hMarque - 34 - hChiffres - hRecords - 30 - y;
  await visuel(pad, y, W - 2 * pad, hVisuel, 30, o.format !== 'carre');
  y += hVisuel + 30;
  grilleChiffres(ctx, o.chiffres, pad, y, W - 2 * pad, 3, hLigne, tailleValeur);
  y += hChiffres;
  if (records) { ctx.fillStyle = C.or; ctx.font = `600 30px ${TEXTE}`; ctx.fillText(tronquer(ctx, records, W - 2 * pad), pad, y + 30); }
  marque(ctx, pad, H - bas, hMarque, W - 2 * pad);
  return canvas;
}

/** Sous-titre : date et activité */
export const sousTitreImage = (s) => `${fmtJourLong.format(new Date(s.debut)).replace(/^./, (c) => c.toUpperCase())} · ${s.nomSport ?? 'Sortie'}`;
