// Canvas renderer — ported from the prototype's draw().
// Holds small mutable animation state (heart press, cage open) between frames.

export class Renderer {
  constructor(sprites) {
    this.C = sprites;
    this.press = {};   // per-heart sink animation: "r,c" -> {d, t}
    this.cageA = null; // cage open/close animation
  }

  // Call when switching to a new level so animations don't carry over.
  reset() { this.press = {}; this.cageA = null; }

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
        const sk = sink[r + ',' + c], off = Math.round(sk * 2);
        if (sk > 0) { ctx.globalAlpha = sk; at('platePit', r, c); ctx.globalAlpha = 1; }
        if (off < 2) at('plateLip', r, c);
        ctx.drawImage(C.plateFace, c * 16, r * 16 + off);
        if (sk > 0) { ctx.globalAlpha = sk; ctx.drawImage(C.plateFaceDark, c * 16, r * 16 + off); ctx.globalAlpha = 1; }
      }
      if (fl === 'o') at('warp' + frame, r, c);
    }));

    // Layer 2: static map objects.
    M.forEach((row, r) => [...row].forEach((chx, c) => {
      if (chx === '#') at(wallKey, r, c);
      else if (chx === 'f') at('fence', r, c);
      else if (chx === 'h') { at('shadow', r, c); at('chair', r, c); }
      else if (chx === 'l') { at('shadow', r, c); at('lantern', r, c); }
      else if (chx === 'B') { at('shadow', r, c); at('bride', r, c); }
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

    // Boxes (gift/cake) — gold + sparkle when delivered, cyan glow when not.
    s.boxes.forEach((b) => {
      const on = level.TG.has(b.r + ',' + b.c);
      const by = b.r * 16 + sinkPx(b.r, b.c), bx = b.c * 16;
      ctx.drawImage(C.shadow, bx, by);
      if (!on) glow(b.kind, bx, by);
      ctx.drawImage(C[b.kind + (on ? 'On' : '')], bx, by);
      if (on) at('sparkle', b.r, b.c);
    });

    // Groom.
    const d = s.dir;
    const pk = d === 'up' ? 'groomUp' : d === 'down' ? 'groomDown' : (s.push ? 'groomPush' : 'groom') + (d === 'left' ? 'Left' : 'Right');
    {
      const py = s.player.r * 16 + sinkPx(s.player.r, s.player.c), px = s.player.c * 16;
      ctx.drawImage(C.shadow, px, py); ctx.drawImage(C[pk], px, py);
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
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 34);
        g.addColorStop(0, 'rgba(255,214,130,0.75)'); g.addColorStop(1, 'rgba(255,214,130,0)');
        ctx.fillStyle = g; ctx.fillRect(cx - 34, cy - 34, 68, 68);
      });
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
