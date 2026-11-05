// Sprite builder — ported from the prototype's buildSprites().
// Produces a map of name -> 16x16 offscreen <canvas> ready to drawImage().
import { PAL } from './palette.js';

function norm(rows) {
  const o = rows.map((r) => (r + '.'.repeat(16)).slice(0, 16));
  while (o.length < 16) o.push('.'.repeat(16));
  return o.slice(0, 16);
}
function blank(ch) { return Array(16).fill(ch.repeat(16)); }
function setCell(rows, x, y, ch) {
  if (y < 0 || y > 15 || x < 0 || x > 15) return;
  rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
}
function swap(rows, m) { return rows.map((r) => [...r].map((ch) => m[ch] || ch).join('')); }
function flip(rows) { return rows.map((r) => [...r].reverse().join('')); }

function paint(rows) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const x = cv.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, i) => {
    const col = PAL[ch];
    if (col) { x.fillStyle = col; x.fillRect(i, y, 1, 1); }
  }));
  return cv;
}

export function buildSprites() {
  const R = {};
  const grass = (base, tuft, pts) => {
    const g = blank(base);
    pts.forEach(([x, y]) => { setCell(g, x, y, tuft); setCell(g, x + 2, y, tuft); setCell(g, x + 1, y + 1, tuft); });
    return g;
  };
  R.grassA = grass('G', 'g', [[3, 3], [10, 8], [5, 12]]);
  R.grassB = grass('g', 'q', [[11, 2], [2, 9], [8, 13]]);
  R.carpet = Array.from({ length: 16 }, () => [...Array(16)].map((_, x) => (x === 0 || x === 15 ? 'c' : x === 1 || x === 14 ? 'Y' : 'C')).join(''));
  [[5, 3], [10, 9], [7, 13], [4, 10]].forEach(([x, y]) => setCell(R.carpet, x, y, 'P'));
  R.stone = Array.from({ length: 16 }, (_, y) => [...Array(16)].map((_, x) => {
    if (y === 7 || y === 15) return 'e';
    if (y < 7) return x === 7 || x === 15 ? 'e' : 'E';
    return x === 3 || x === 11 ? 'e' : 'E';
  }).join(''));
  const water = (gl) => { const w = blank('U'); gl.forEach(([x, y, n]) => { for (let i = 0; i < n; i++) setCell(w, x + i, y, 'u'); }); return w; };
  R.water0 = water([[2, 4, 3], [9, 8, 3], [5, 12, 2], [12, 13, 2]]);
  R.water1 = water([[3, 4, 2], [10, 8, 3], [4, 12, 3], [12, 3, 2]]);
  R.bank = norm(['DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD', 'D.DD.DDD.DD.DDD.']);
  R.wallShadow = norm(['OOOOOOOOOOOOOOOO', 'OOOOOOOOOOOOOOOO', 'OOOOOOOOOOOOOOOO']);
  R.shadow = norm([...Array(13).fill(''), '...OOOOOOOOOO...', '..OOOOOOOOOOOO..', '....OOOOOOOO....']);
  R.heart = norm(['', '', '..R..........P..', '', '....rrr..rrr....', '...rPPRrrRRRr...', '...rPRRRRRRRr...', '...rRRRRRRRRr...', '....rRRRRRRr....', '.....rRRRRr.....', '......rRRr......', '.......rr.......', '', '.P.........R....']);
  const core = R.heart.map((row, y) => (y === 2 || y === 13 ? '.'.repeat(16) : row));
  R.plateFace = norm(['', '.KKKKKKKKKKKKKK.', ...Array(11).fill('.KWWWWWWWWWWWwK.'), '.KwwwwwwwwwwwwK.']).map((row, y) => [...row].map((ch, i) => (core[y][i] !== '.' ? core[y][i] : ch)).join(''));
  R.plateFaceDark = swap(R.plateFace, { W: 'w', w: 'v', R: 'r', P: 'R', r: 'c' });
  R.plateFaceDarkS = norm(['', '', ...R.plateFaceDark.slice(0, 14)]);
  R.plateLip = norm([...Array(14).fill(''), '.KPPPPPPPPPPPPK.', '.KKKKKKKKKKKKKK.']);
  R.platePit = norm(['', '.KKKKKKKKKKKKKK.', '.KOOOOOOOOOOOOK.']);
  R.heartLip = swap(R.heart, { r: 'K', R: 'K', P: 'K' });
  R.heartPit = swap(R.heart, { r: 'O', R: 'O', P: 'O' });
  R.heartLipS = norm(['', '', ...R.heartLip.slice(0, 14)]);
  R.heartDownS = norm(['', '', ...R.heart.slice(0, 14)]);
  R.gift = norm(['', '.....KK..KK.....', '....KRRKKRRK....', '...KKRrKKrRKK...', '.KKKKKKRRKKKKKK.', '.KWWWWWRRWWWWWK.', '.KWWWWWRRWWWWWK.', '.KRRRRRRRRRRRRK.', '.KWWWWWRRWWWWWK.', '.KKKKKKKKKKKKKK.', '.KwwwwwrrwwwwwK.', '.KwwwwwrrwwwwwK.', '.KwwwwwrrwwwwwK.', '.KvvvvvrrvvvvvK.', '.KKKKKKKKKKKKKK.']);
  R.giftOn = swap(R.gift, { R: 'Y', r: 'y' });
  R.cake = norm(['', '.......KK.......', '......KRRK......', '.....KKKKKK.....', '.....KWWWWK.....', '.....KwPwPK.....', '...KKKKKKKKKK...', '...KWWWWWWWWK...', '...KPwPwPwPwK...', '...KwwwwwwwwK...', '.KKKKKKKKKKKKKK.', '.KWWWWWWWWWWWWK.', '.KPwPwPwPwPwPwK.', '.KwwwwwwwwwwwwK.', '.KKKKKKKKKKKKKK.']);
  R.cakeOn = swap(R.cake, { P: 'Y', R: 'Y', r: 'y' });
  R.sparkle = norm(['.............W..', '............WWW.', '.............W..', '', '', '', '.W..............', 'WWW.............', '.W..............']);
  R.hedge = norm(['', '....KKKKKKKK....', '..KKLLLLLLLLKK..', '.KLLLGLLLLLGLLK.', '.KLGGLLLRLLLLLK.', 'KLLGLLLLLLLGGLLK', 'KLLLLLRLLLLLGLLK', 'KLLLLLLLLLLLLLLK', 'KlLLLLLLLRLLLLlK', 'KllLLLLLLLLLLllK', 'KllllllllllllllK', 'KlllRlllllllRllK', 'KllllllllllllllK', '.KllllllllllllK.', '..KKKKKKKKKKKK..']);
  R.blossom = swap(R.hedge, { L: 'P', l: 'r', G: 'W', R: 'Y' });
  R.fence = norm(['', '..K....K....K...', '.KWK..KWK..KWK..', '.KWK..KWK..KWK..', 'KKWKKKKWKKKKWKKK', 'KWWWWWWWWWWWWWWK', 'KwwwwwwwwwwwwwwK', 'KKWKKKKWKKKKWKKK', '.KWK..KWK..KWK..', '.KwK..KwK..KwK..', 'KKWKKKKWKKKKWKKK', 'KWWWWWWWWWWWWWWK', 'KwwwwwwwwwwwwwwK', 'KKwKKKKwKKKKwKKK', '.KvK..KvK..KvK..', '.KKK..KKK..KKK..']);
  R.chair = norm(['', '', '....KKKKKKKK....', '....KWWWWWWK....', '....KWKKKKWK....', '....KWKRRKWK....', '....KWKKKKWK....', '....KWWWWWWK....', '...KKKKKKKKKK...', '...KWWWWWWWWK...', '...KwwwwwwwwK...', '...KKKKKKKKKK...', '...KwK....KwK...', '...KwK....KwK...', '...KKK....KKK...']);
  R.lantern = norm(['', '.......KK.......', '......KyyK......', '.....KKKKKK.....', '.....KyYYyK.....', '.....KYWWYK.....', '.....KYWWYK.....', '.....KyYYyK.....', '.....KKKKKK.....', '......KttK......', '......KttK......', '......KttK......', '.....KKttKK.....', '....KttttttK....', '....KKKKKKKK....']);
  R.brick = norm(['KKKKKKKKKKKKKKKK', 'KWMMMMMMMMMMMMMK', 'KMMMMMMMMMMMMMMK', 'KMMMMMMMMMMMMMmK', 'KKKKKKKKKKKKKKKK', 'KMMMMMMnMMMMMMmK', 'KMMMMMMnMMMMMMmK', 'KmmmmmmnmmmmmmmK', 'KnnnnnnnnnnnnnnK', 'KMMMnMMMMMMnMMmK', 'KMMMnMMMMMMnMMmK', 'KmmmnmmmmmmnmmmK', 'KnnnnnnnnnnnnnnK', 'KMMMMMMnMMMMMMmK', 'KmmmmmmnmmmmmmmK', 'KKKKKKKKKKKKKKKK']);
  R.warp0 = norm(['', '', '', '.....KKKKKK.....', '...KKvvvvvvKK...', '..KvPPPPPPPPvK..', '.KvPWWWWWWWWPvK.', '.KvPWuuuuuuWPvK.', '.KvPWuuuuuuWPvK.', '.KvPWWWWWWWWPvK.', '..KvPPPPPPPPvK..', '..KKvvvvvvvvKK..', '....KKKKKKKK....']);
  R.warp1 = swap(R.warp0, { u: 'W', W: 'u', P: 'v', v: 'P' });
  R.warpFx0 = norm(['', '.....u..........', '..........W.....', '', '......W...u.....']);
  R.warpFx1 = norm(['......W.........', '.........u......', '.....u..........', '...........W....', '']);
  R.boulder = norm(['', '.....KKKKKK.....', '...KKMMMMMMKK...', '..KMMWWMMMMmmK..', '.KMMWWMMMMMMmmK.', '.KMWMMMMMMMMmmK.', 'KMMMMMMnMMMMmmnK', 'KMMMMMnnMMMMmmnK', 'KMMMMMMMMMMmmnnK', 'KmMMMMMMMMmmmnnK', 'KmmMMMMMMmmmnnnK', '.KmmmmmmmmmnnnK.', '.KnmmmmmmmnnnnK.', '..KnnnnnnnnnnK..', '...KKKKKKKKKK...']);
  R.groomDown = norm(['', '....KKKKKKKK....', '...KHHHHHHHHK...', '..KHHhHHHHhHHK..', '..KHSSSSSSSSHK..', '..KSSKSSSSKSSK..', '..KSSKSSSSKSSK..', '..KSPSSSSSSPSK..', '...KsSSSSSSsK...', '...KBWWRRWWBK...', '..KBRBWRRWBBBK..', '..KSKBBWWBBKSK..', '...KKBBBBBBKK...', '....KBBKKBBK....', '....KKK..KKK....']);
  R.groomUp = norm(['', '....KKKKKKKK....', '...KHHHHHHHHK...', '..KHHhHHHHhHHK..', '..KHHHHHHHHHHK..', '..KHHHhHHhHHHK..', '..KHHHHHHHHHHK..', '..KsHHHHHHHHsK..', '....KSSSSSSK....', '...KBBBBBBBBK...', '..KBBBBbbBBBBK..', '..KSKBBbbBBKSK..', '...KKBBBBBBKK...', '....KBBKKBBK....', '....KKK..KKK....']);
  R.groomRight = norm(['', '.....KKKKKK.....', '....KHHHHHHK....', '...KHHhHHHHHK...', '...KHHHHSSSSK...', '...KHHHSSSKSK...', '...KHHsSSSKSK...', '...KHSSSSSPSSK..', '....KsSSSSSK....', '....KBBBWRK.....', '...KBBBBBWK.....', '...KBBBBSSK.....', '....KBBBBBK.....', '....KBBKBBK.....', '....KKK.KKKK....']);
  R.groomPushRight = R.groomRight.slice();
  R.groomPushRight[10] = '...KBBBBBBSSK...';
  R.groomPushRight[11] = '...KBBBBBBSSK...';
  R.groomLeft = flip(R.groomRight);
  R.groomPushLeft = flip(R.groomPushRight);
  R.bride = norm(['......KKKK......', '....KKWWWWKK....', '...KWKAAAAKWK...', '..KWKAAPYAAKWK..', '..KWKASSSSAKWK..', '..KWKSKSSKSKWK..', '..KWKSPSSPSKWK..', '..KwWKsSSsKWwK..', '..KwWWKSSKWWwK..', '..KwWKWWWWKWwK..', '.KwWKSPRRPSKWwK.', '.KwKWWLRRLWWKwK.', '.KKWWWWWWWWWWKK.', '..KWwWWwWWwWWK..', '..KKKKKKKKKKKK..']);
  R.cageBars = norm(['', 'KKKKKKKKKKKKKKKK', 'KYYYYYYYYYYYYYYK', 'KyyyyyyyyyyyyyyK', 'KKKKKKKKKKKKKKKK', 'KMK.KMK..KMK.KMK', 'KMK.KMK..KMK.KMK', 'KMK.KMK..KMK.KMK', 'KMK.KMK..KMK.KMK', 'KMK.KMK..KMK.KMK', 'KnK.KnK..KnK.KnK', 'KnK.KnK..KnK.KnK']);
  R.cageBase = norm([...Array(11).fill(''), '.OOOOOOOOOOOOOO.', 'KKKKKKKKKKKKKKKK', 'KnnnnnnnnnnnnnnK', 'KKKKKKKKKKKKKKKK']);

  const C = {};
  Object.keys(R).forEach((k) => { C[k] = paint(R[k]); });

  // Boulder rotations (for the rolling-stone spin animation).
  const rot = (rows) => rows.map((_, y) => rows.map((_, x) => rows[15 - x][y]).join(''));
  R.boulder1 = rot(R.boulder); R.boulder2 = rot(R.boulder1); R.boulder3 = rot(R.boulder2);
  ['boulder1', 'boulder2', 'boulder3'].forEach((k) => { C[k] = paint(R[k]); });

  // Cyan glow rims for off-goal pushables / stones.
  ['gift', 'cake', 'boulder'].forEach((k) => {
    const rows = R[k];
    const on = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && rows[y][x] !== '.';
    const ring1 = new Set();
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const x = cv.getContext('2d');
    for (let y = 0; y < 16; y++) for (let i = 0; i < 16; i++) {
      if (!on(i, y) && (on(i - 1, y) || on(i + 1, y) || on(i, y - 1) || on(i, y + 1))) {
        ring1.add(i + ',' + y); x.fillStyle = '#2ef3ff'; x.fillRect(i, y, 1, 1);
      }
    }
    for (let y = 0; y < 16; y++) for (let i = 0; i < 16; i++) {
      if (!on(i, y) && !ring1.has(i + ',' + y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => ring1.has((i + a) + ',' + (y + b)))) {
        x.fillStyle = 'rgba(46,243,255,0.45)'; x.fillRect(i, y, 1, 1);
      }
    }
    C[k + 'Glow'] = cv;
  });

  return C;
}
