(() => {
const W = 1080, H = 1920, FPS = 30, DUR = 24;
const GOLD = '#dda974', GOLD_L = '#eecda0', GOLD_D = '#a5713a';
const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const eo = x => 1 - Math.pow(1 - clamp(x), 3);
const prog = (t, t0, d) => clamp((t - t0) / d);
const F = (w, s) => `${w} ${s}px Montserrat, Helvetica, Arial, sans-serif`;
const MONO = s => `700 ${s}px "Space Mono", monospace`;

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

let LOGO, IMGS;

function txt(s, x, y, o = {}) {
  const { font = F(800, 60), color = '#fff', align = 'center', alpha = 1, dy = 0, shadow = true, ls = '0px' } = o;
  if (alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = clamp(alpha);
  ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color;
  ctx.letterSpacing = ls;
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4; }
  ctx.fillText(s, x, y + dy);
  ctx.restore();
}
function width(s, font) { ctx.save(); ctx.font = font; const w = ctx.measureText(s).width; ctx.restore(); return w; }
function appear(t, t0, d = 0.5) { const p = eo(prog(t, t0, d)); return { alpha: p, dy: (1 - p) * 42 }; }
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function logo(cx, cy, h, alpha = 1) {
  const w = h * LOGO.width / LOGO.height;
  ctx.save(); ctx.globalAlpha = clamp(alpha); ctx.drawImage(LOGO, cx - w / 2, cy - h / 2, w, h); ctx.restore();
}

function bg(t) {
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, '#0d3c5c'); g.addColorStop(0.45, '#062a43'); g.addColorStop(1, '#030d16');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const gx = 860 + Math.sin(t * 0.6) * 50, gy = 330 + Math.cos(t * 0.5) * 40;
  let r = ctx.createRadialGradient(gx, gy, 0, gx, gy, 640);
  r.addColorStop(0, 'rgba(238,205,160,.22)'); r.addColorStop(1, 'rgba(238,205,160,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  const hx = 160 + Math.cos(t * 0.4) * 50, hy = 1450 + Math.sin(t * 0.45) * 40;
  r = ctx.createRadialGradient(hx, hy, 0, hx, hy, 560);
  r.addColorStop(0, 'rgba(221,169,116,.14)'); r.addColorStop(1, 'rgba(221,169,116,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
}

const SCENES = { A: [0, 3.5], B: [3.5, 8], C: [8, 16], D: [16, 20.5], E: [20.5, 24] };
function sceneAlpha(ts, dur, inD = 0.3, outD = 0.3, first = false, last = false) {
  const a = first ? 1 : prog(ts, 0, inD);
  const b = last ? 1 : 1 - prog(ts, dur - outD, outD);
  return Math.min(a, b);
}

function sceneA(ts, sa) {
  const lines = [['Where do your', 0.15, '#fff', 800], ['customers', 0.45, '#fff', 800], ['actually look?', 0.8, GOLD_L, 900]];
  const ys = [820, 935, 1050];
  lines.forEach(([s, t0, c, w], i) => { const a = appear(ts, t0); txt(s, 540, ys[i], { font: F(w, 98), color: c, alpha: a.alpha * sa, dy: a.dy }); });
  const p = eo(prog(ts, 1.4, 0.7));
  const w = width('actually look?', F(900, 98));
  ctx.save(); ctx.globalAlpha = sa; ctx.fillStyle = GOLD; rr(540 - w / 2, 1082, w * p, 9, 4); ctx.fill(); ctx.restore();
  const b = appear(ts, 1.8, 0.5);
  txt('LYNESIGN  |  INDOOR BILLBOARDS', 540, 1230, { font: MONO(32), color: GOLD, alpha: b.alpha * sa, dy: b.dy, ls: '3px', shadow: false });
}

function sceneB(ts, sa) {
  const items = [['Feeds get scrolled past.', 0.2], ['Flyers get tossed.', 0.8], ['Ads get skipped.', 1.4]];
  const ys = [700, 830, 960];
  items.forEach(([s, t0], i) => {
    const a = appear(ts, t0);
    const sp = eo(prog(ts, t0 + 0.7, 0.45));
    txt(s, 540, ys[i], { font: F(700, 68), alpha: a.alpha * (1 - 0.5 * sp) * sa, dy: a.dy });
    const w = width(s, F(700, 68));
    ctx.save(); ctx.globalAlpha = a.alpha * sa; ctx.fillStyle = GOLD; rr(540 - w / 2, ys[i] - 26, w * sp, 8, 4); ctx.fill(); ctx.restore();
  });
  const a1 = appear(ts, 2.7), a2 = appear(ts, 3.05);
  txt('But everyone looks up', 540, 1250, { font: F(800, 78), alpha: a1.alpha * sa, dy: a1.dy });
  txt('while they wait.', 540, 1350, { font: F(900, 84), color: GOLD_L, alpha: a2.alpha * sa, dy: a2.dy });
}

const CAPS = ['At the barbershop', 'At the gym', 'At the laundromat', 'At the restaurant'];
function sceneC(ts, sa) {
  const SLOT = 2.0;
  const idx = Math.min(3, Math.floor(ts / SLOT));
  const local = ts - idx * SLOT;
  const cx = 540, cy = 990, S = 900;
  const drawCard = (i, loc, alpha) => {
    const z = 1.0 + 0.08 * (loc / SLOT);
    ctx.save(); ctx.globalAlpha = alpha * sa; rr(cx - S / 2, cy - S / 2, S, S, 38); ctx.clip();
    const px = (loc - 1) * 8;
    ctx.drawImage(IMGS[i], cx - S * z / 2 + px, cy - S * z / 2, S * z, S * z);
    ctx.restore();
  };
  if (idx > 0 && local < 0.3) drawCard(idx - 1, SLOT + local, 1);
  drawCard(idx, local, idx === 0 ? 1 : prog(local, 0, 0.3));
  ctx.save(); ctx.globalAlpha = 0.55 * sa; ctx.strokeStyle = GOLD_L; ctx.lineWidth = 3; rr(cx - S / 2, cy - S / 2, S, S, 38); ctx.stroke(); ctx.restore();
  // chip
  const label = 'EXAMPLE VENUE', cw = width(label, MONO(24)) + 70, chx = cx + S / 2 - 28 - cw, chy = cy - S / 2 + 28;
  ctx.save(); ctx.globalAlpha = sa; ctx.fillStyle = 'rgba(4,20,32,.72)'; rr(chx, chy, cw, 52, 26); ctx.fill();
  ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(chx + 26, chy + 26, 7, 0, 7); ctx.fill(); ctx.restore();
  txt(label, chx + 44, chy + 35, { font: MONO(24), align: 'left', alpha: sa, shadow: false });
  // eyebrow + caption
  const eb = appear(ts, 0.1, 0.5);
  txt('WHERE INDOOR ADS BELONG', 540, 400, { font: MONO(30), color: GOLD, alpha: eb.alpha * sa, dy: eb.dy, ls: '3px', shadow: false });
  const ca = appear(local, 0.1, 0.4);
  const out = idx < 3 ? 1 - prog(local, 1.75, 0.25) : 1;
  txt(CAPS[idx], 540, 490, { font: F(800, 72), alpha: ca.alpha * out * sa, dy: ca.dy });
  const sb = appear(ts, 0.4, 0.6);
  txt('Captive. Relaxed. Watching.', 540, 1520, { font: F(700, 46), color: GOLD_L, alpha: sb.alpha * sa, dy: sb.dy });
  // dots
  for (let i = 0; i < 4; i++) {
    ctx.save(); ctx.globalAlpha = sa; ctx.fillStyle = i === idx ? GOLD : 'rgba(255,255,255,.3)';
    ctx.beginPath(); ctx.arc(540 + (i - 1.5) * 34, 1585, i === idx ? 8 : 6, 0, 7); ctx.fill(); ctx.restore();
  }
}

function sceneD(ts, sa) {
  const n1 = Math.round(49 * eo(prog(ts, 0.3, 1.2)));
  const a1 = appear(ts, 0.2), b1 = appear(ts, 0.5);
  txt(n1 + '+', 540, 800, { font: F(900, 230), color: GOLD_L, alpha: a1.alpha * sa, dy: a1.dy });
  txt('minutes of average dwell time', 540, 890, { font: F(700, 42), alpha: b1.alpha * 0.9 * sa, dy: b1.dy });
  const dp = eo(prog(ts, 1.5, 0.5));
  ctx.save(); ctx.globalAlpha = sa; ctx.fillStyle = 'rgba(238,205,160,.5)'; rr(540 - 160 * dp, 1010, 320 * dp, 5, 3); ctx.fill(); ctx.restore();
  const n2 = Math.round(20 * eo(prog(ts, 2.1, 1.0)));
  const a2 = appear(ts, 2.0), b2 = appear(ts, 2.3);
  txt(n2 + '+', 540, 1250, { font: F(900, 230), color: GOLD_L, alpha: a2.alpha * sa, dy: a2.dy });
  txt('screens across Houston, TX', 540, 1340, { font: F(700, 42), alpha: b2.alpha * 0.9 * sa, dy: b2.dy });
}

function sceneE(ts, sa) {
  const s = 0.85 + 0.15 * eo(prog(ts, 0, 0.6));
  logo(540, 700, 340 * s, eo(prog(ts, 0, 0.5)));
  const a1 = appear(ts, 0.5), a2 = appear(ts, 0.85);
  txt('Your Ad', 540, 1020, { font: F(900, 124), alpha: a1.alpha, dy: a1.dy });
  txt('Here.', 540, 1150, { font: F(900, 124), color: GOLD_L, alpha: a2.alpha, dy: a2.dy });
  const bp = appear(ts, 1.3, 0.5);
  const pulse = ts > 1.8 ? 1 + 0.025 * Math.sin((ts - 1.8) * 5) : 1;
  ctx.save(); ctx.globalAlpha = bp.alpha; ctx.translate(540, 1320 + bp.dy); ctx.scale(pulse, pulse);
  const g = ctx.createLinearGradient(-330, 0, 330, 0);
  g.addColorStop(0, GOLD_D); g.addColorStop(0.6, GOLD); g.addColorStop(1, GOLD_L);
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
  ctx.fillStyle = g; rr(-330, -60, 660, 120, 60); ctx.fill(); ctx.restore();
  ctx.save(); ctx.globalAlpha = bp.alpha; ctx.translate(540, 1320 + bp.dy); ctx.scale(pulse, pulse); ctx.restore();
  txt('lynesign.com/landing', 540, 1334, { font: F(800, 46), alpha: bp.alpha, dy: bp.dy, shadow: false });
  const c = appear(ts, 1.7, 0.5);
  txt('HOUSTON, TX', 540, 1470, { font: MONO(34), color: GOLD, alpha: c.alpha, dy: c.dy, ls: '4px', shadow: false });
}

function draw(t) {
  bg(t);
  const pr = t / DUR;
  ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.12)'; rr(60, 22, W - 120, 6, 3); ctx.fill();
  ctx.fillStyle = GOLD; rr(60, 22, (W - 120) * pr, 6, 3); ctx.fill(); ctx.restore();
  const inRange = ([a, b]) => t >= a && t < b;
  if (t < SCENES.E[0]) logo(540, 190, 130, eo(prog(t, 0.1, 0.5)));
  for (const k of Object.keys(SCENES)) {
    const [a, b] = SCENES[k];
    if (t < a || t >= b + (k === 'E' ? 1 : 0)) continue;
    const ts = t - a, dur = b - a;
    const sa = sceneAlpha(ts, dur, 0.3, 0.3, k === 'A', k === 'E');
    ({ A: sceneA, B: sceneB, C: sceneC, D: sceneD, E: sceneE })[k](ts, sa);
  }
}

window.VID = {
  W, H, FPS, DUR,
  async init(assets) {
    LOGO = await loadImg(assets.logo);
    IMGS = await Promise.all(assets.imgs.map(loadImg));
  },
  draw,
  canvas,
  async encode(muxerSrc) {
    const url = URL.createObjectURL(new Blob([muxerSrc], { type: 'text/javascript' }));
    const { Muxer, ArrayBufferTarget } = await import(url);
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
    const cfg = { codec: 'avc1.640029', width: W, height: H, bitrate: 5_000_000, framerate: FPS };
    const sup = await VideoEncoder.isConfigSupported(cfg);
    if (!sup.supported) throw new Error('H.264 encoding not supported in this Chrome');
    const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { throw e; } });
    enc.configure(cfg);
    const N = DUR * FPS;
    for (let i = 0; i < N; i++) {
      draw(i / FPS);
      const bmp = await createImageBitmap(canvas);
      const f = new VideoFrame(bmp, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      enc.encode(f, { keyFrame: i % FPS === 0 });
      f.close(); bmp.close();
      while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 2));
    }
    await enc.flush();
    muxer.finalize();
    const bytes = new Uint8Array(target.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
};
})();
