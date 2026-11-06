// Canvas renderer — ported from the prototype's draw().
// Holds small mutable animation state (heart press, cage open) between frames.

// 3x5 pixel font for the couple's initials (A–Z + '_' fallback).
const FONT3x5 = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'], I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'], K: ['101', '110', '100', '110', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['101', '111', '111', '111', '101'], O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'], Q: ['010', '101', '101', '110', '011'], R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'], U: ['101', '101', '101', '101', '011'],
  V: ['101', '101', '101', '101', '010'], W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'], _: ['111', '101', '101', '101', '111']
};

export class Renderer {
  constructor(sprites) {
    this.C = sprites;
    this.press = {};   // per-heart sink animation: "r,c" -> {d, t}
    this.cageA = null; // cage open/close animation
    // Transient motion set by the game on a move; read here, never persisted.
    this.pA = null;       // player step/warp tween {fr, fc, start, dur, warp}
    this.bA = null;       // pushed-box tween {i, fr, fc, start, dur}
    this.confetti = null; // win burst {t, ps:[...]}
    this.initials = { bride: 'A', groom: 'P' }; // overridden from config by the game
    this._badges = {};
  }

  // Call when switching to a new level so animations don't carry over.
  reset() { this.press = {}; this.cageA = null; this.pA = this.bA = this.confetti = null; }

  // ctx: 2d context sized w*16 x h*16. anim: stone-slide descriptor or null.
  draw(ctx, level, state, t, anim) {
    const C = this.C, M = level.MAP, F = level.F, s = state;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const frame = Math.floor(t / 650) % 2;
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, cw, ch);

    const wallKey = level.wallStyle === 'fence' ? 'fence' : level.wallStyle === 'blossom' ? 'blossom' : 'hedge';
    const at = (k, r, c) => { if (C[k]) ctx.drawImage(C[k], c * 16, r * 16); };
    const occ = new Set([...s.boxes, ...(s.stones || []), s.player].map((o) => o.r + ',' + o.c));

    // Heart-plate sink animation.
    const sink = {};
    level.TG.forEach((k) => {
      const d = occ.has(k);
      let P = this.press[k];
      if (!P) P = this.press[k] = { d, t: -1e9 };
      if (P.d !== d) { P.d = d; P.t = t; }
      const q = Math.min(1, Math.max(0, (t - P.t) / 160)), e = 1 - (1 - q) * (1 - q);
      sink[k] = d ? e : 1 - e;
    });
    const sinkPx = (r, c) => Math.round((sink[r + ',' + c] || 0) * 2);

    // Layer 1: floor + hearts + warps.
    M.forEach((row, r) => [...row].forEach((chx, c) => {
      const fl = F[r][c];
      if (fl === '~') {
        at('water' + frame, r, c);
        if (F[r - 1] && F[r - 1][c] !== '~') at('bank', r, c);
        return;
      }
      at(fl === '=' ? 'carpet' : fl === '_' ? 'stone' : (r + c) % 2 ? 'grassB' : 'grassA', r, c);
      if (r > 0 && '#fQ'.includes(M[r - 1][c]) && !'#fQ'.includes(chx)) at('wallShadow', r, c);
      if (level.TG.has(r + ',' + c)) {
        const hc = (level.heartColorAt && level.heartColorAt[r + ',' + c]) || 0;
        const sk = sink[r + ',' + c], off = Math.round(sk * 2);
        if (sk > 0) { ctx.globalAlpha = sk; at('platePit', r, c); ctx.globalAlpha = 1; }
        if (off < 2) at('plateLip', r, c);
        ctx.drawImage(C['plateFace' + (hc || '')] || C.plateFace, c * 16, r * 16 + off);
        if (sk > 0 && !hc) { ctx.globalAlpha = sk; ctx.drawImage(C.plateFaceDark, c * 16, r * 16 + off); ctx.globalAlpha = 1; }
      }

      if (fl === 'o') at('warp' + frame, r, c);
    }));

    // Layer 2: static map objects.
    M.forEach((row, r) => [...row].forEach((chx, c) => {
      if (chx === '#') at(wallKey, r, c);
      else if (chx === 'f') at('fence', r, c);
      else if (chx === 'h') { at('shadow', r, c); at('chair', r, c); }
      else if (chx === 'l') { at('shadow', r, c); at('lantern', r, c); }
      else if (chx === 'B') { at('shadow', r, c); ctx.drawImage(C.bride, c * 16, r * 16 - (Math.floor((t + 260) / 520) % 2)); }
      else if (chx === 'Q') at('brick', r, c);
    }));

    // Layer 3: cages (bars slide down when open).
    if (level.CAGES.length) {
      const open = level.cageOpen(s);
      const A = this.cageA || (this.cageA = { open, t: -1e9 });
      if (A.open !== open) { A.open = open; A.t = t; }
      const q = Math.min(1, Math.max(0, (t - A.t) / 220)), e = 1 - (1 - q) * (1 - q), off = Math.round((open ? e : 1 - e) * 12);
      level.CAGES.forEach((g) => {
        at('cageBase', g.r, g.c);
        if (off < 12) {
          ctx.save(); ctx.beginPath(); ctx.rect(g.c * 16, g.r * 16, 16, 12); ctx.clip();
          ctx.drawImage(C.cageBars, g.c * 16, g.r * 16 + off); ctx.restore();
        }
      });
    }

    // Layer 4: stones (glow + slide/rotate animation).
    const glowA = 0.8 + 0.2 * Math.sin(t / 380);
    const glow = (k, px, py) => { ctx.globalAlpha = glowA; if (C[k + 'Glow']) ctx.drawImage(C[k + 'Glow'], px, py); ctx.globalAlpha = 1; };
    (s.stones || []).forEach((o, i) => {
      let px = o.c * 16, py = o.r * 16, fk = 'boulder';
      const A = anim;
      if (A && A.i === i && A.tr === o.r && A.tc === o.c && t < A.start + A.dur) {
        const q = Math.max(0, (t - A.start) / A.dur), e = 1 - (1 - q) * (1 - q);
        const fx = A.fc * 16 + (A.tc - A.fc) * 16 * e, fy = A.fr * 16 + (A.tr - A.fr) * 16 * e;
        const trav = Math.abs(fx - A.fc * 16) + Math.abs(fy - A.fr * 16);
        const n = Math.floor(trav / 4) % 4, idx = A.cw ? n : (4 - n) % 4;
        px = Math.round(fx); py = Math.round(fy); fk = idx ? 'boulder' + idx : 'boulder';
      }
      ctx.drawImage(C.shadow, px, py); glow('boulder', px, py); ctx.drawImage(C[fk], px, py);
    });

    // Warp sparkles (not on the tile the player occupies).
    level.WARPS.forEach((w) => { if (!(s.player.r === w.r && s.player.c === w.c)) at('warpFx' + frame, w.r, w.c); });

    // Ease-out tween helper: interpolated top-left for a {fr,fc,start,dur} anim,
    // or null once it has finished (so the object snaps to its logical cell).
    const tw = (A, cx, cy) => {
      if (!A || t >= A.start + A.dur) return null;
      const q = Math.max(0, (t - A.start) / A.dur), e = 1 - (1 - q) * (1 - q);
      return { q, x: Math.round(A.fc * 16 + (cx - A.fc * 16) * e), y: Math.round(A.fr * 16 + (cy - A.fr * 16) * e) };
    };

    // Boxes (gift/cake) — gold + twinkle when correctly placed, cyan glow when not.
    s.boxes.forEach((b, i) => {
      const placed = level.boxPlaced(b);
      let by = b.r * 16 + sinkPx(b.r, b.c), bx = b.c * 16;
      const m = this.bA && this.bA.i === i ? tw(this.bA, bx, by) : null;
      if (m) { bx = m.x; by = m.y; }
      ctx.drawImage(C.shadow, bx, by);
      if (!placed) glow(b.kind, bx, by);
      const key = placed ? (b.kind + 'On') : (b.color ? 'gift' + b.color : b.kind);
      ctx.drawImage(C[key] || C[b.kind], bx, by);
      if (placed && !m && Math.floor((t + (b.r * 7 + b.c * 13) * 61) / 240) % 4 !== 3) at('sparkle', b.r, b.c);
    });

    // Groom (step tween + 2px hop, warp scale, idle bob when still).
    const d = s.dir;
    const pk = d === 'up' ? 'groomUp' : d === 'down' ? 'groomDown' : (s.push ? 'groomPush' : 'groom') + (d === 'left' ? 'Left' : 'Right');
    let groomDrawX = s.player.c * 16, groomDrawY = s.player.r * 16;
    {
      let py = s.player.r * 16 + sinkPx(s.player.r, s.player.c), px = s.player.c * 16, sc = 1, hop = 0;
      const A = this.pA;
      if (A && t < A.start + A.dur) {
        const q = Math.max(0, (t - A.start) / A.dur);
        if (A.warp) { if (q < 0.5) { px = A.fc * 16; py = A.fr * 16; sc = 1 - q * 2; } else sc = q * 2 - 1; }
        else { const m = tw(A, px, py); px = m.x; py = m.y; hop = Math.round(Math.sin(q * Math.PI) * 2); }
      } else hop = Math.floor(t / 480) % 2;
      ctx.drawImage(C.shadow, px, py);
      if (sc < 1) { const z = Math.max(1, Math.round(16 * sc)); ctx.drawImage(C[pk], px + Math.round((16 - z) / 2), py + 16 - z, z, z); groomDrawX = px; groomDrawY = py; }
      else { ctx.drawImage(C[pk], px, py - hop); groomDrawX = px; groomDrawY = py - hop; }
    }

    // Lighting overlay.
    const light = level.lighting;
    if (light !== 'day') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = light === 'golden' ? 'rgba(255,190,130,0.45)' : 'rgba(70,55,140,0.6)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'screen';
      const glows = light === 'golden' ? [] : M.flatMap((row, r) => [...row].map((chx, c) => (chx === 'l' ? [r, c] : null)).filter(Boolean));
      if (light === 'golden') {
        const g = ctx.createLinearGradient(0, 0, cw, ch);
        g.addColorStop(0, 'rgba(255,200,120,0.35)'); g.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
      }
      glows.forEach(([r, c]) => {
        const cx = c * 16 + 8, cy = r * 16 + 6;
        const fl = 34 + Math.sin(t / 130 + r * 3 + c) * 1.5 + Math.sin(t / 53 + c) * 0.8; // candle flicker
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, fl);
        g.addColorStop(0, 'rgba(255,214,130,0.75)'); g.addColorStop(1, 'rgba(255,214,130,0)');
        ctx.fillStyle = g; ctx.fillRect(cx - 34, cy - 34, 68, 68);
      });
      ctx.globalCompositeOperation = 'source-over';
    }

    // Couple initials, drawn last so lighting doesn't tint the labels.
    const bi = this.initials && this.initials.bride;
    const gi = this.initials && this.initials.groom;
    if (bi) level.BRIDES.forEach((b) => this.drawBadge(ctx, bi, b.r - (Math.floor((t + 260) / 520) % 2) / 16, b.c));
    if (gi) this.drawBadge(ctx, gi, groomDrawY / 16, groomDrawX / 16);

    // Win confetti burst (80 particles from the groom tile; fades over last 0.7s of 2.8s).
    const K = this.confetti;
    if (K) {
      const dt = (t - K.t) / 1000;
      if (dt > 2.8) this.confetti = null;
      else if (dt > 0) {
        ctx.globalAlpha = Math.min(1, (2.8 - dt) / 0.7);
        K.ps.forEach((p) => {
          const kk = (1 - Math.exp(-dt * 1.6)) / 1.6;
          const fx = p.x + p.vx * kk, fy = p.y + p.vy * kk + 70 * dt * dt;
          const flip = Math.abs(Math.cos(dt * p.spin)) > 0.4;
          ctx.fillStyle = p.col;
          ctx.fillRect(Math.round(fx), Math.round(fy), flip ? p.s + 1 : 1, flip ? p.s : p.s + 1);
        });
        ctx.globalAlpha = 1;
      }
    }
  }

  badge(letter) {
    const key = (String(letter || '').toUpperCase().match(/[A-Z]/) || ['_'])[0];
    if (this._badges[key]) return this._badges[key];
    const W = 7, PILL = 7, H = PILL + 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const INK = '#3a2433', CREAM = '#fffaf4';
    x.fillStyle = INK; x.fillRect(0, 0, W, PILL);
    x.fillStyle = CREAM; x.fillRect(1, 1, W - 2, PILL - 2);
    x.fillStyle = INK; x.fillRect(2, PILL, 3, 1); x.fillRect(3, PILL + 1, 1, 1); // downward tail
    x.fillStyle = INK;
    (FONT3x5[key] || FONT3x5._).forEach((row, gy) => { for (let gx = 0; gx < 3; gx++) if (row[gx] === '1') x.fillRect(2 + gx, 1 + gy, 1, 1); });
    this._badges[key] = cv;
    return cv;
  }

  drawBadge(ctx, letter, r, c) {
    const b = this.badge(letter);
    ctx.drawImage(b, c * 16 + 8 - (b.width >> 1), r * 16 - (b.height - 2));
  }
}
