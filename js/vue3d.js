// Vue 3D d'une sortie : ruban coloré selon la pente, dessiné sur une toile 2D
// en fausse perspective. Repris de l'appli « Parcours 3D » de Cyril
// (dépôt cyrilboisset-glitch/Parcours-3d : buildTrack, altClean, boxSmooth,
// c3dData, grade100, frame, camTick, flyTick), adapté aux sorties enregistrées :
// pas de réseau (ni relief SRTM, ni noms de cols), curseur relié aux courbes.

const SEG = 5; // trace rééchantillonnée tous les 5 m
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const nf = (x, d = 0) => x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

// Couleurs par pente (identiques à Parcours 3D et au simulateur)
export const GCOL = (g) => (g < -6 ? '#2f6fc4' : g < -2 ? '#4a9be0' : g < 2 ? '#4cc35a' : g < 4 ? '#b5d63a'
  : g < 6 ? '#f2c230' : g < 8 ? '#f08a24' : g < 10 ? '#e0402a' : '#9c1f3c');
export const LEGENDE_PENTES = [[-4, 'descente'], [0, '0–2 %'], [3, '2–4 %'], [5, '4–6 %'], [7, '6–8 %'], [9, '8–10 %'], [11, '> 10 %']];

const RELIEFS = [0, 1, 1.5, 2, 2.5, 3]; // 0 = auto

// ---- Données (sans navigateur : testables dans Node) -----------------------

export function boxSmooth(E, r, pass) {
  const n = E.length;
  if (n < 3) return E;
  const P = Math.min(n - 1, r * pass);
  const m = n + 2 * P;
  const A = new Float64Array(m);
  const pre = new Float64Array(m + 1);
  for (let q = 0; q < m; q++) {
    const k = q - P;
    A[q] = k < 0 ? 2 * E[0] - E[-k] : k >= n ? 2 * E[n - 1] - E[2 * (n - 1) - k] : E[k];
  }
  for (let p = 0; p < pass; p++) {
    pre[0] = 0;
    for (let q = 0; q < m; q++) pre[q + 1] = pre[q] + A[q];
    const B = new Float64Array(m);
    for (let q = 0; q < m; q++) {
      const a = Math.max(0, q - r);
      const b = Math.min(m, q + r + 1);
      B[q] = (pre[b] - pre[a]) / (b - a);
    }
    A.set(B);
  }
  for (let q = 0; q < n; q++) E[q] = A[q + P];
  return E;
}

// Altitude GPS : pics retirés (médiane sur 45 m), bruit mesuré pour choisir la force du lissage
export function altClean(E) {
  const n = E.length;
  const M = new Float32Array(n);
  const w = [];
  for (let q = 0; q < n; q++) {
    w.length = 0;
    for (let m = -4; m <= 4; m++) w.push(E[clamp(q + m, 0, n - 1)]);
    w.sort((a, b) => a - b);
    M[q] = w[4];
  }
  const S = boxSmooth(Float32Array.from(M), 20, 2);
  let r = 0;
  for (let q = 0; q < n; q++) r += (M[q] - S[q]) ** 2;
  r = Math.sqrt(r / Math.max(1, n));
  E.set(M);
  return clamp(Math.round(5 + r * 6), 5, 16);
}

/**
 * Trace rééchantillonnée tous les 5 m (x vers l'est, z vers le sud, en m),
 * altitude nettoyée et lissée, pente sur 100 m.
 * @param {{lat?, lon?, altitudeM?}[]} pts  points de la sortie (pointsDetail)
 * @returns {null | {n, tot, X, Z, E, G, loop, sPoint: Float64Array, avecAltitude}}
 *   sPoint[i] : distance le long de la trace du point i de la sortie (curseur)
 */
export function construireTrace(pts) {
  const idx = [];
  pts.forEach((p, i) => { if (typeof p.lat === 'number' && typeof p.lon === 'number') idx.push(i); });
  if (idx.length < 2) return null;
  const la0 = idx.reduce((a, i) => a + pts[i].lat, 0) / idx.length;
  const lo0 = idx.reduce((a, i) => a + pts[i].lon, 0) / idx.length;
  // mètres par degré sur la sphère de rayon 6 371 km, comme les distances du
  // reste de l'appli (Parcours 3D prend 110 574 m : 0,56 % de moins)
  const M_PAR_DEG = 111195;
  const kx = M_PAR_DEG * Math.cos((la0 * Math.PI) / 180);
  const xs = idx.map((i) => (pts[i].lon - lo0) * kx);
  const zs = idx.map((i) => -(pts[i].lat - la0) * M_PAR_DEG);
  const al = idx.map((i) => pts[i].altitudeM);
  const avecAltitude = al.filter((a) => typeof a === 'number' && a !== 0).length > idx.length * 0.8;
  const cum = [0];
  for (let k = 1; k < idx.length; k++) cum.push(cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]));
  const tot = cum[cum.length - 1];
  if (tot < 20) return null;
  // distance le long de la trace pour chaque point de la sortie (points sans GPS : ceux d'avant)
  const sPoint = new Float64Array(pts.length);
  let k = 0;
  for (let i = 0; i < pts.length; i++) {
    while (k < idx.length - 1 && idx[k + 1] <= i) k++;
    sPoint[i] = idx[k] <= i ? cum[k] : 0;
  }
  const n = Math.max(2, Math.floor(tot / SEG) + 1);
  const X = new Float32Array(n);
  const Z = new Float32Array(n);
  const E = new Float32Array(n);
  const alt = (j) => (typeof al[j] === 'number' ? al[j] : 0);
  k = 0;
  for (let q = 0; q < n; q++) {
    const s = Math.min(tot, q * SEG);
    while (k < idx.length - 2 && cum[k + 1] < s) k++;
    const L = cum[k + 1] - cum[k] || 1;
    const t = clamp((s - cum[k]) / L, 0, 1);
    X[q] = xs[k] + (xs[k + 1] - xs[k]) * t;
    Z[q] = zs[k] + (zs[k + 1] - zs[k]) * t;
    E[q] = avecAltitude ? alt(k) + (alt(k + 1) - alt(k)) * t : 0;
  }
  const sig = altClean(E);
  boxSmooth(E, Math.max(2, Math.round(sig * 0.9)), 3);
  // pente sur 100 m (±50 m)
  const G = new Float32Array(n);
  const w = 10;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(n - 1, i + w);
    G[i] = b > a ? ((E[b] - E[a]) / ((b - a) * SEG)) * 100 : 0;
  }
  const loop = Math.hypot(X[0] - X[n - 1], Z[0] - Z[n - 1]) < 120;
  return { n, tot, X, Z, E, G, loop, sPoint, avecAltitude };
}

/** Chiffres et cadre de la trace (repris de c3dData) */
export function donnees3d(T) {
  const step = Math.max(12, T.tot / 800);
  const n = Math.floor(T.tot / step) + 1;
  const X3 = new Float32Array(n);
  const Z3 = new Float32Array(n);
  const Y3 = new Float32Array(n);
  for (let q = 0; q < n; q++) {
    const s = Math.min(T.tot, q * step);
    X3[q] = aT(T, T.X, s);
    Z3[q] = aT(T, T.Z, s);
    Y3[q] = aT(T, T.E, s);
  }
  let lo = 1e9; let hi = -1e9; let ihi = 0; let dp = 0;
  let bx0 = 1e9; let bx1 = -1e9; let bz0 = 1e9; let bz1 = -1e9;
  for (let q = 0; q < n; q++) {
    if (Y3[q] < lo) lo = Y3[q];
    if (Y3[q] > hi) { hi = Y3[q]; ihi = q; }
    if (q && Y3[q] > Y3[q - 1]) dp += Y3[q] - Y3[q - 1];
    bx0 = Math.min(bx0, X3[q]); bx1 = Math.max(bx1, X3[q]);
    bz0 = Math.min(bz0, Z3[q]); bz1 = Math.max(bz1, Z3[q]);
  }
  return {
    n, step, tot: T.tot, X3, Z3, Y3, lo, hi, ihi, dp,
    cx: (bx0 + bx1) / 2, cz: (bz0 + bz1) / 2, R: Math.max(bx1 - bx0, bz1 - bz0, 400) / 2,
  };
}

// valeur interpolée d'un tableau de la trace à la distance s
function aT(T, A, s) {
  const f = clamp(s / SEG, 0, T.n - 1);
  const i = Math.min(T.n - 2, Math.floor(f));
  const t = f - i;
  return A[i] + (A[i + 1] - A[i]) * t;
}

// ---- Vue (navigateur) ----------------------------------------------------------

/**
 * Crée la vue 3D dans `conteneur`.
 * @param {HTMLElement} conteneur
 * @param {object[]} pts  points de la sortie
 * @param {{auCurseur?: (iPoint: number) => void}} options
 * @returns {null | {placerCurseur(iPoint), afficher(oui), detruire()}}
 */
export function creerVue3d(conteneur, pts, options = {}) {
  const T = construireTrace(pts);
  if (!T) return null;
  const D = donnees3d(T);
  const C3D = { yaw: 0.7, pit: 0.62, zoom: 1, px: 0, pz: 0, py: 0, auto: false, tgt: null };
  let relief = 0; // auto
  let vol = null; // survol en cours { s, b, v }
  let cur = null; // distance du curseur (m)
  let visible = false;
  let raf = 0;
  let derniereT = 0;
  let pick = [];

  conteneur.innerHTML = `
    <canvas class="v3d-toile" aria-label="Parcours en 3D : un doigt pour tourner, deux pour zoomer ou déplacer"></canvas>
    <div class="v3d-boutons">
      <button type="button" data-v3d="centrer" title="Recentrer">◎</button>
      <button type="button" data-v3d="auto" title="Rotation automatique" aria-pressed="false">⟳</button>
      <button type="button" data-v3d="relief" title="Relief">⛰ <span>auto</span></button>
      <button type="button" data-v3d="survol" title="Survol du parcours">🎥 Survol</button>
      <button type="button" data-v3d="plein" title="Plein écran">⤢</button>
    </div>
    <div class="v3d-legende">${LEGENDE_PENTES.map(([g, t]) => `<span style="background:${GCOL(g)}">${t}</span>`).join('')}</div>
    ${T.avecAltitude ? '' : '<p class="v3d-note">Pas d\'altitude dans ce fichier : parcours affiché à plat.</p>'}`;
  const cv = conteneur.querySelector('canvas');
  const btn = (n) => conteneur.querySelector(`[data-v3d="${n}"]`);

  const ve = () => relief || clamp((D.R * 0.45) / Math.max(60, D.hi - D.lo), 1, 6);
  const vue = () => {
    const W = cv.width;
    const H = cv.height;
    return { W, H, ox: W / 2, oy: H * 0.62, S: ((Math.min(W, H * 1.2) * 0.42) / D.R) * C3D.zoom };
  };

  function signaler(s) {
    if (!options.auCurseur) return;
    // point de la sortie le plus proche de la distance s
    let a = 0; let b = T.sPoint.length - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (T.sPoint[m] < s) a = m; else b = m; }
    options.auCurseur(Math.abs(T.sPoint[a] - s) <= Math.abs(T.sPoint[b] - s) ? a : b);
  }

  function arreterVol() {
    C3D.tgt = null;
    if (vol) { vol = null; btn('survol').innerHTML = '🎥 Survol'; }
  }

  let dernierSignal = 0;
  function tickVol(dt) {
    vol.s += vol.v * dt;
    if (vol.s >= vol.b) { cur = vol.b; arreterVol(); return; }
    cur = vol.s;
    const now = performance.now();
    if (now - dernierSignal > 120) { dernierSignal = now; signaler(cur); }
    const dx = aT(T, T.X, vol.s + 150) - aT(T, T.X, vol.s - 150);
    const dz = aT(T, T.Z, vol.s + 150) - aT(T, T.Z, vol.s - 150);
    const Sb = vue().S / C3D.zoom;
    C3D.tgt = {
      px: aT(T, T.X, vol.s) - D.cx, pz: aT(T, T.Z, vol.s) - D.cz, py: (aT(T, T.E, vol.s) - D.lo) * ve(),
      zoom: clamp((cv.width * 0.42) / 380 / Sb, 0.3, 120), yaw: Math.atan2(-dz, dx), pit: 0.34,
    };
  }

  // transition douce de la caméra vers sa cible
  function tickCamera(dt) {
    if (vol) tickVol(dt);
    const t = C3D.tgt;
    if (!t) return;
    const a = 1 - Math.exp(-dt * (vol ? 5 : 4));
    for (const k of ['px', 'pz', 'py', 'pit']) C3D[k] += (t[k] - C3D[k]) * a;
    C3D.zoom *= (t.zoom / C3D.zoom) ** a;
    let dy = t.yaw - C3D.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    C3D.yaw += dy * a;
    if (!vol && Math.abs(dy) < 0.002 && Math.abs(Math.log(t.zoom / C3D.zoom)) < 0.002 && Math.hypot(t.px - C3D.px, t.pz - C3D.pz) < 0.5) C3D.tgt = null;
  }

  function dessiner() {
    raf = visible ? requestAnimationFrame(dessiner) : 0;
    const f = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(cv.clientWidth * f);
    const H = Math.round(cv.clientHeight * f);
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const now = performance.now();
    const dt = Math.min(0.1, (now - (derniereT || now)) / 1000);
    derniereT = now;
    if (C3D.auto) C3D.yaw += 0.0025;
    tickCamera(dt);
    const g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    const V = vue();
    const e = ve();
    const cy = Math.cos(C3D.yaw); const sy = Math.sin(C3D.yaw);
    const cp = Math.cos(C3D.pit); const sp = Math.sin(C3D.pit);
    const cx = D.cx + C3D.px; const cz = D.cz + C3D.pz;
    const pr = (x, y, z) => {
      const X = (x - cx) * cy - (z - cz) * sy;
      const Z = (x - cx) * sy + (z - cz) * cy;
      const Y = (y - D.lo) * e;
      const yy = (Y - C3D.py) * cp - Z * sp;
      const zz = (Y - C3D.py) * sp + Z * cp;
      const k = 1 / Math.max(0.08, 1 + zz / (D.R * 4));
      return [V.ox + X * V.S * k, V.oy - yy * V.S * k, zz];
    };
    // plan de base (quadrillage)
    g.strokeStyle = 'rgba(255,255,255,.06)';
    g.lineWidth = f;
    for (let i = -5; i <= 5; i++) {
      for (const [a, b] of [[[(i / 5) * D.R * 1.2, -D.R * 1.2], [(i / 5) * D.R * 1.2, D.R * 1.2]], [[-D.R * 1.2, (i / 5) * D.R * 1.2], [D.R * 1.2, (i / 5) * D.R * 1.2]]]) {
        const p = pr(D.cx + a[0], D.lo, D.cz + a[1]);
        const q = pr(D.cx + b[0], D.lo, D.cz + b[1]);
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
      }
    }
    // points du tracé (plus serrés quand on zoome), hors écran écartés
    const mpx = V.S / f;
    const st = Math.max(1, Math.min(Math.round(D.step / SEG), Math.round(4 / (mpx * SEG)) || 1));
    const mg = 60 * f;
    const IX = [];
    for (let i = 0; i < T.n - 1; i += st) IX.push(i);
    IX.push(T.n - 1);
    const TP = IX.map((i) => pr(T.X[i], T.E[i], T.Z[i]));
    const BT = IX.map((i) => pr(T.X[i], D.lo, T.Z[i]));
    const VS = IX.map((_, j) => {
      const p = TP[j]; const q = BT[j];
      return Math.max(p[0], q[0]) > -mg && Math.min(p[0], q[0]) < W + mg && Math.max(p[1], q[1]) > -mg - 200 * f && Math.min(p[1], q[1]) < H + mg;
    });
    pick = [];
    for (let j = 0; j < IX.length; j++) if (VS[j]) pick.push([TP[j][0], TP[j][1], IX[j] * SEG]);
    // ombre au sol
    g.strokeStyle = 'rgba(0,0,0,.55)';
    g.lineWidth = 3 * f;
    g.beginPath();
    for (let j = 0; j < IX.length; j++) {
      const p = BT[j];
      if (j && (VS[j] || VS[j - 1])) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]);
    }
    g.stroke();
    // rideau coloré selon la pente, du plus loin au plus proche
    const segs = [];
    for (let j = 0; j < IX.length - 1; j++) {
      if (!VS[j] && !VS[j + 1]) continue;
      segs.push([TP[j][2] + TP[j + 1][2], TP[j], TP[j + 1], BT[j + 1], BT[j], T.G[IX[j]]]);
    }
    segs.sort((u, v) => v[0] - u[0]);
    g.globalAlpha = 0.88;
    for (const [, a, b, b0, a0, gr] of segs) {
      g.fillStyle = GCOL(gr);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b0[0], b0[1]); g.lineTo(a0[0], a0[1]); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    g.strokeStyle = '#fff';
    g.lineWidth = 2 * f;
    g.beginPath();
    let stylo = false;
    for (let j = 0; j < IX.length; j++) {
      const p = TP[j];
      if (VS[j] && stylo) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]);
      stylo = VS[j];
    }
    g.stroke();
    // repères détaillés quand on zoome : tous les 100 m ou 500 m, avec la pente de l'intervalle
    const dstep = 100 * mpx >= 26 ? 100 : 500 * mpx >= 26 ? 500 : 0;
    if (dstep) {
      let cnt = 0;
      g.textAlign = 'center';
      for (let d = dstep; d <= T.tot && cnt < 300; d += dstep) {
        const p = pr(aT(T, T.X, d), aT(T, T.E, d), aT(T, T.Z, d));
        if (!(p[0] > 0 && p[0] < W && p[1] > -150 * f && p[1] < H)) continue;
        cnt++;
        const grand = d % 1000 === 0 || dstep === 500;
        g.strokeStyle = grand ? '#fff' : 'rgba(255,255,255,.75)';
        g.lineWidth = (grand ? 1.6 : 1) * f;
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0], p[1] - (grand ? 12 : 7) * f); g.stroke();
        if (grand || (dstep === 100 && d % 500 === 0)) {
          g.font = `700 ${9.5 * f}px system-ui`;
          g.fillStyle = 'rgba(255,255,255,.9)';
          g.fillText(nf(d / 1000, d % 1000 ? 1 : 0), p[0], p[1] - (grand ? 15 : 10) * f);
        }
        const fin = Math.min(T.tot, d + dstep);
        if (fin - d < dstep * 0.5) continue;
        const q2 = pr(aT(T, T.X, fin), aT(T, T.E, fin), aT(T, T.Z, fin));
        const gpc = ((aT(T, T.E, fin) - aT(T, T.E, d)) / (fin - d)) * 100;
        const txt = `${nf(gpc, 1)} %`;
        g.font = `800 ${9.5 * f}px system-ui`;
        const tw = g.measureText(txt).width + 6 * f;
        if (Math.hypot(q2[0] - p[0], q2[1] - p[1]) < tw + 6 * f) continue;
        const mx = (p[0] + q2[0]) / 2; const my = (p[1] + q2[1]) / 2 - 30 * f;
        g.fillStyle = GCOL(gpc);
        g.fillRect(mx - tw / 2, my - 7 * f, tw, 13 * f);
        g.fillStyle = Math.abs(gpc) < 6 && gpc > -2 ? '#13202b' : '#fff';
        g.fillText(txt, mx, my + 3.5 * f);
      }
    }
    // étiquettes : km, départ, arrivée, point culminant
    const lab = (q, t, col, dy) => {
      const p = pr(D.X3[q], D.Y3[q], D.Z3[q]);
      g.font = `700 ${11 * f}px system-ui`;
      const w = g.measureText(t).width + 10 * f;
      const y = p[1] - dy * f;
      g.strokeStyle = col; g.lineWidth = 1.5 * f;
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0], y); g.stroke();
      g.fillStyle = 'rgba(14,19,27,.85)';
      g.fillRect(p[0] - w / 2, y - 15 * f, w, 16 * f);
      g.strokeRect(p[0] - w / 2, y - 15 * f, w, 16 * f);
      g.fillStyle = '#fff'; g.textAlign = 'center';
      g.fillText(t, p[0], y - 3 * f);
    };
    const pasKm = D.tot > 60000 ? 10000 : 5000;
    for (let d = pasKm; d < D.tot - pasKm / 3; d += pasKm) lab(Math.round(d / D.step), `${nf(d / 1000)} km`, 'rgba(255,255,255,.5)', 14);
    lab(0, '🚩 Départ', '#22c55e', 30);
    if (!T.loop) lab(D.n - 1, '🏁 Arrivée', '#fff', 30);
    if (T.avecAltitude) lab(D.ihi, `▲ ${Math.round(D.hi)} m`, '#ffb21a', 44);
    // curseur (point touché sur les courbes ou la 3D)
    if (cur != null) {
      const X = aT(T, T.X, cur); const Z = aT(T, T.Z, cur); const Y = aT(T, T.E, cur);
      const a = pr(X, D.lo, Z); const b = pr(X, Y, Z);
      g.strokeStyle = '#fff'; g.lineWidth = 2 * f;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(b[0], b[1], 6 * f, 0, 7); g.fill();
      g.fillStyle = '#ff6a13'; g.beginPath(); g.arc(b[0], b[1], 3.5 * f, 0, 7); g.fill();
    }
  }

  // ---- gestes : un doigt tourne, deux doigts zooment et déplacent ----
  const doigts = new Map();
  let ecart0 = 0; let milieu0 = null; let appui = null;
  const deplacer = (dx, dy) => {
    const f = Math.min(2, devicePixelRatio || 1);
    const S = vue().S / f;
    const ax = -dx / S; const az = dy / S / Math.max(0.25, Math.sin(C3D.pit));
    C3D.px += ax * Math.cos(C3D.yaw) + az * Math.sin(C3D.yaw);
    C3D.pz += -ax * Math.sin(C3D.yaw) + az * Math.cos(C3D.yaw);
  };
  cv.onpointerdown = (e) => {
    cv.setPointerCapture(e.pointerId);
    doigts.set(e.pointerId, [e.clientX, e.clientY, e.button === 2 || e.shiftKey]);
    ecart0 = 0; milieu0 = null;
    C3D.auto = false; btn('auto').setAttribute('aria-pressed', 'false');
    arreterVol();
    appui = doigts.size === 1 ? { x: e.clientX, y: e.clientY, bouge: false } : null;
  };
  cv.onpointermove = (e) => {
    const o = doigts.get(e.pointerId);
    if (!o) return;
    const dx = e.clientX - o[0]; const dy = e.clientY - o[1];
    doigts.set(e.pointerId, [e.clientX, e.clientY, o[2]]);
    if (appui && Math.hypot(e.clientX - appui.x, e.clientY - appui.y) > 8) appui.bouge = true;
    if (doigts.size === 2) {
      const [a, b] = [...doigts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (ecart0) C3D.zoom = clamp((C3D.zoom * d) / ecart0, 0.3, 120);
      if (milieu0) deplacer(m[0] - milieu0[0], m[1] - milieu0[1]);
      ecart0 = d; milieu0 = m;
      return;
    }
    if (o[2]) { deplacer(dx, dy); return; }
    // glisser vers la droite : le parcours tourne vers la droite
    C3D.yaw -= dx * 0.008;
    C3D.pit = clamp(C3D.pit + dy * 0.005, 0.15, 1.35);
  };
  cv.onpointerup = cv.onpointercancel = (e) => {
    if (e.type === 'pointerup' && appui && !appui.bouge && doigts.size === 1 && e.button !== 2) {
      // simple toucher : point le plus proche du tracé
      const r = cv.getBoundingClientRect();
      const f = Math.min(2, devicePixelRatio || 1);
      const x = (e.clientX - r.left) * f; const y = (e.clientY - r.top) * f;
      let meilleur = (26 * f) ** 2; let s = null;
      for (const q of pick) {
        const d = (q[0] - x) ** 2 + (q[1] - y) ** 2;
        if (d < meilleur) { meilleur = d; s = q[2]; }
      }
      if (s !== null) { cur = s; signaler(s); }
    }
    doigts.delete(e.pointerId);
    ecart0 = 0; milieu0 = null;
    if (!doigts.size) appui = null;
  };
  cv.oncontextmenu = (e) => e.preventDefault();
  cv.onwheel = (e) => {
    e.preventDefault();
    arreterVol();
    C3D.zoom = clamp(C3D.zoom * Math.exp(-e.deltaY * 0.0012), 0.3, 120);
  };

  conteneur.querySelector('.v3d-boutons').onclick = (e) => {
    const b = e.target.closest('[data-v3d]');
    if (!b) return;
    const a = b.dataset.v3d;
    if (a === 'centrer') {
      arreterVol();
      Object.assign(C3D, { yaw: 0.7, pit: 0.62, zoom: 1, px: 0, pz: 0, py: 0 });
    } else if (a === 'auto') {
      C3D.auto = !C3D.auto;
      b.setAttribute('aria-pressed', String(C3D.auto));
    } else if (a === 'relief') {
      relief = RELIEFS[(RELIEFS.indexOf(relief) + 1) % RELIEFS.length];
      b.querySelector('span').textContent = relief ? `×${nf(relief, relief % 1 ? 1 : 0)}` : 'auto';
    } else if (a === 'survol') {
      if (vol) { arreterVol(); return; }
      // la caméra longe le parcours (8 à 45 s selon la longueur)
      const duree = clamp(T.tot / 1500, 8, 45);
      vol = { s: 0, b: T.tot, v: T.tot / duree };
      C3D.auto = false; btn('auto').setAttribute('aria-pressed', 'false');
      b.innerHTML = '■ Arrêter';
    } else if (a === 'plein') {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else conteneur.requestFullscreen?.().catch(() => {});
    }
  };

  return {
    trace: T,
    /** Curseur placé depuis les courbes (indice du point de la sortie) */
    placerCurseur(iPoint) { cur = iPoint == null ? null : T.sPoint[iPoint]; },
    afficher(oui) {
      visible = oui;
      if (oui && !raf) { derniereT = 0; raf = requestAnimationFrame(dessiner); }
      if (!oui) { cancelAnimationFrame(raf); raf = 0; arreterVol(); }
    },
    detruire() { visible = false; cancelAnimationFrame(raf); raf = 0; },
  };
}
