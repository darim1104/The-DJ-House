/* ===== 여백 손 효과: 공통 틀 =====
   - 효과는 덱·카메라 "뒤" 레이어에 그려져서 여백에서만 보인다.
   - 각 효과 파일은 같은 모양({ id, name, key, create(env) → { update(f), draw(g, f) } })으로 손·음악 정보를 받는다.
   - 주소 뒤에 ?lab 을 붙이면 실험 패널이 뜬다(숫자키로 켜고 끄기, 마우스로 손 흉내).
   - 평소 실행 화면에서 켤 효과는 config.js 의 ENABLED 에 적는다. */
import { ENABLED } from "./config.js";
import chimney from "./chimney.js";
import fireworks from "./fireworks.js";
import arrows from "./arrows.js";

export const EFFECTS = [chimney, fireworks, arrows];

/* 산뜻하고 채도 높은 파스텔 팔레트 (모든 효과 공통).
   낮은 흰 바탕 위에 그대로 겹쳐 칠하고(탁해지지 않게), 밤은 검은 바탕 위 스크린(빛 겹침) */
export const PASTEL = ["#FF8AD8", "#8AF3FF", "#B8FF6B", "#FFF36B", "#B79CFF", "#FFB86B", "#6BFFC8", "#FF8A9E"];
export const PALETTES = {
  day:   { colors:PASTEL, blend:"source-over", line:"#C9C9C9", alpha:.92 },
  night: { colors:PASTEL, blend:"screen",      line:"#E8FFF5", alpha:.92 }
};

const HOUSE = [[0,104],[867,8.25],[1430.25,70.6],[1430.25,.75],[1557.25,.75],[1557.25,84.4],[1735.5,104.25]]; // 덱 지붕선(덱 좌표)
const roofY = x => {                                   // 덱 좌표 x에서 지붕 높이
  for (let i = 0; i < HOUSE.length - 1; i++) {
    const [x0, y0] = HOUSE[i], [x1, y1] = HOUSE[i + 1];
    if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && x1 !== x0) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return 104;
};

export function createFxLab({ stage, deck, cam, buttons, AC, master, getTheme }) {
  const lab = /[?&]lab\b/.test(location.search);
  const layer = document.createElement("canvas");
  layer.id = "fxLayer";
  layer.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block";
  stage.insertBefore(layer, stage.firstChild);        // 맨 아래 → 덱·카메라가 위를 덮음
  const g = layer.getContext("2d");
  let dpr = 1;
  const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); layer.width = Math.round(innerWidth * dpr); layer.height = Math.round(innerHeight * dpr); };
  resize(); addEventListener("resize", resize);

  /* ---- 음악 분석 ---- */
  const analyser = AC.createAnalyser();
  analyser.fftSize = 2048; analyser.smoothingTimeConstant = .6;
  master.connect(analyser);
  const freq = new Uint8Array(analyser.frequencyBinCount), wave = new Uint8Array(analyser.fftSize);
  const audio = { level:0, bass:0, beat:false, bands:new Array(7).fill(0), wave, bassAvg:.1, lastBeat:0 };
  const binHz = AC.sampleRate / analyser.fftSize;
  const bandEdges = [60, 140, 300, 600, 1200, 2500, 5000, 9000];
  function analyse(t) {
    analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave);
    let s = 0; for (let i = 0; i < wave.length; i += 4) { const v = (wave[i] - 128) / 128; s += v * v; }
    audio.level = Math.sqrt(s / (wave.length / 4));
    let b = 0, n = 0; for (let i = Math.max(1, Math.floor(40 / binHz)); i <= Math.ceil(150 / binHz); i++) { b += freq[i]; n++; }
    audio.bass = n ? b / n / 255 : 0;
    audio.beat = false;
    if (audio.bass > .3 && audio.bass > audio.bassAvg * 1.25 && t - audio.lastBeat > .24) { audio.beat = true; audio.lastBeat = t; }
    audio.bassAvg += (audio.bass - audio.bassAvg) * .05;
    for (let k = 0; k < 7; k++) {
      let m = 0, c = 0;
      for (let i = Math.floor(bandEdges[k] / binHz); i < Math.ceil(bandEdges[k + 1] / binHz); i++) { m += freq[i] || 0; c++; }
      const v = c ? m / c / 255 : 0;
      audio.bands[k] += (v - audio.bands[k]) * .35;
    }
  }

  /* ---- 여백 판정: 카메라 원·덱(집 모양)·나가기·해/달 위가 아니면 여백 ---- */
  function geometry() {
    const d = deck.getBoundingClientRect(), c = cam.getBoundingClientRect();
    return { d, c, sx:d.width / 1736, sy:d.height / 647, u:d.width / 1736 };   // u = 시안 1px
  }
  let geo = geometry();
  function inMargin(p) {
    if (!p) return false;
    const { d, c, sx, sy } = geo;
    if (Math.hypot(p.x - (c.left + c.width / 2), p.y - (c.top + c.height / 2)) < c.width / 2 + 6) return false;
    const lx = (p.x - d.left) / sx, ly = (p.y - d.top) / sy;
    if (lx >= 0 && lx <= 1736 && ly >= roofY(lx) - 4) return false;
    for (const b of buttons) { const r = b.getBoundingClientRect(); if (p.x > r.left - 10 && p.x < r.right + 10 && p.y > r.top - 10 && p.y < r.bottom + 10) return false; }
    return true;
  }

  /* ---- 손 자세: 펼침 / 주먹 / 집게, 손바닥 중심, 속도 ---- */
  const handState = {};
  function readHand(id, pts, pinching, t, dt, override) {
    let s = handState[id] || (handState[id] = { id, pose:"none", prevPose:"none", vx:0, vy:0, palm:null, pinch:false, prevPinch:false, gone:0 });
    s.prevPose = s.pose; s.prevPinch = s.pinch;
    if (!pts) { s.pose = "none"; s.pinch = false; s.palm = null; s.inMargin = false; return s; }
    const palm = override ? override.palm : [0, 5, 9, 13, 17].reduce((a, i) => ({ x:a.x + pts[i].x / 5, y:a.y + pts[i].y / 5 }), { x:0, y:0 });
    const scale = Math.max(1, Math.hypot(pts[9].x - pts[0].x, pts[9].y - pts[0].y));
    let ext = 0, curl = 0;
    for (const [tip, mcp] of [[8,5],[12,9],[16,13],[20,17]]) {
      const dt_ = Math.hypot(pts[tip].x - pts[0].x, pts[tip].y - pts[0].y), dm = Math.hypot(pts[mcp].x - pts[0].x, pts[mcp].y - pts[0].y);
      if (dt_ > dm * 1.55) ext++;
      if (dt_ < dm * 1.12) curl++;
    }
    s.pose = override ? override.pose : ext >= 4 ? "open" : curl >= 3 ? "fist" : "other";
    if (s.palm && dt > 0) {
      const k = Math.min(1, dt * 12);
      s.vx += ((palm.x - s.palm.x) / dt - s.vx) * k; s.vy += ((palm.y - s.palm.y) / dt - s.vy) * k;
    }
    s.palm = palm; s.pts = pts; s.scale = scale; s.pinch = !!pinching;
    s.tip = override ? override.palm : { x:(pts[4].x + pts[8].x) / 2, y:(pts[4].y + pts[8].y) / 2 };
    s.inMargin = inMargin(palm);
    s.tipInMargin = inMargin(s.tip);
    return s;
  }

  /* ---- 마우스로 손 흉내 (실험 모드에서만): 이동 = 펼친 손, 누르고 끌기 = 집게, Shift 누름 = 주먹, H = 두 번째 손 고정 ---- */
  const mouse = { x:-1, y:-1, down:false, shift:false, inside:false, ghost:null };
  if (lab) {
    addEventListener("pointermove", e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; });
    addEventListener("pointerdown", e => { if (inMargin({ x:e.clientX, y:e.clientY })) mouse.down = true; });
    addEventListener("pointerup", () => { mouse.down = false; });
    addEventListener("keydown", e => {
      if (e.key === "Shift") mouse.shift = true;
      if (e.key === "h" || e.key === "H") mouse.ghost = mouse.ghost ? null : { x:mouse.x, y:mouse.y };
    });
    addEventListener("keyup", e => { if (e.key === "Shift") mouse.shift = false; });
  }
  function fakeHand(cx, cy, pose) {                  // 손 21점을 대략 만들어 같은 판정을 통과시킨다
    const r = 46 * geo.u * 2.2, pts = [];
    const ang = [-.55, -.2, 0, .2, .4];
    pts[0] = { x:cx, y:cy + r * .9 };
    const fingers = [[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];
    fingers.forEach((f, k) => {
      const a = ang[k] - Math.PI / 2, len = pose === "fist" ? .45 : 1;
      f.forEach((idx, j) => { const t = (j + 1) / 4; const L = r * (.55 + (k ? 1.05 : .7) * t * len); pts[idx] = { x:cx + Math.cos(a) * L * (k ? .6 : 1), y:pts[0].y + Math.sin(a) * L }; });
    });
    pts[5] = { x:cx - r * .25, y:cy }; pts[9] = { x:cx, y:cy - r * .05 }; pts[13] = { x:cx + r * .22, y:cy }; pts[17] = { x:cx + r * .4, y:cy + r * .1 };
    return pts;
  }

  /* ---- 효과 켜기/끄기 ---- */
  let on = new Set(ENABLED);
  if (lab) {
    try { const saved = JSON.parse(localStorage.getItem("theDJHouse.fxLab3")); if (Array.isArray(saved)) on = new Set(saved); else on = new Set(EFFECTS.map(e => e.id)); }
    catch (error) { on = new Set(EFFECTS.map(e => e.id)); }
  }
  const save = () => { if (lab) try { localStorage.setItem("theDJHouse.fxLab3", JSON.stringify([...on])); } catch (error) {} };
  const env = { lab };
  const instances = EFFECTS.map(e => ({ def:e, fx:e.create(env) }));

  let panel = null;
  if (lab) {
    panel = document.createElement("div");
    panel.id = "fxLabPanel";
    panel.innerHTML = `<b>FX LAB</b><div class="rows"></div><p>숫자키 = 켜기/끄기 · A = 모두 · 0 = 모두 끄기<br>마우스(여백에서): 누르고 끌기 = 집게 · Shift 눌렀다 떼기 = 주먹→펼침(불꽃)</p>`;
    document.body.appendChild(panel);
    const style = document.createElement("style");
    style.textContent = `#fxLabPanel{position:fixed;z-index:9999;left:12px;top:22%;width:230px;padding:10px 12px;background:rgba(20,20,20,.82);color:#eee;font:11px/1.5 "Helvetica Neue",Arial,sans-serif;border-radius:6px;backdrop-filter:blur(4px)}
      #fxLabPanel b{letter-spacing:.12em}#fxLabPanel .rows{margin:6px 0}#fxLabPanel label{display:flex;gap:6px;align-items:center;cursor:pointer}
      #fxLabPanel kbd{display:inline-block;min-width:16px;text-align:center;border:1px solid #777;border-radius:3px;font-size:10px}#fxLabPanel p{margin:6px 0 0;color:#aaa;font-size:10px}`;
    document.head.appendChild(style);
    const rows = panel.querySelector(".rows");
    const render = () => {
      rows.innerHTML = "";
      for (const { def } of instances) {
        const l = document.createElement("label");
        l.innerHTML = `<input type="checkbox" ${on.has(def.id) ? "checked" : ""}> <kbd>${def.key}</kbd> ${def.name}`;
        l.querySelector("input").onchange = ev => { ev.target.checked ? on.add(def.id) : on.delete(def.id); save(); };
        rows.appendChild(l);
      }
    };
    render();
    addEventListener("keydown", e => {
      if (e.target && /input|textarea/i.test(e.target.tagName) && e.target.type !== "checkbox") return;
      const hit = instances.find(i => i.def.key === e.key);
      if (hit) { on.has(hit.def.id) ? on.delete(hit.def.id) : on.add(hit.def.id); save(); render(); }
      if (e.key === "a" || e.key === "A") { on = new Set(EFFECTS.map(x => x.id)); save(); render(); }
      if (e.key === "0") { on.clear(); save(); render(); }
    });
  }

  /* ---- 매 프레임 ---- */
  let last = performance.now() / 1000, frameNo = 0;
  function frame({ hands, turning }) {
    const t = performance.now() / 1000, dt = Math.min(.05, Math.max(.001, t - last)); last = t;
    if (++frameNo % 30 === 0) geo = geometry();
    if (!on.size) { g.setTransform(1,0,0,1,0,0); g.clearRect(0, 0, layer.width, layer.height); return; }
    analyse(t);
    const theme = getTheme() === "day" ? "day" : "night";
    const list = hands.map(h => readHand(h.id, h.pts, h.pinching, t, dt));
    if (lab && mouse.inside) {
      const p = { x:mouse.x, y:mouse.y }, mPose = mouse.shift ? "fist" : "open";
      list.push(readHand("mouse", inMargin(p) ? fakeHand(p.x, p.y, mPose) : null, mouse.down, t, dt, { palm:p, pose:mPose }));
      if (mouse.ghost) list.push(readHand("ghost", fakeHand(mouse.ghost.x, mouse.ghost.y, "open"), false, t, dt, { palm:mouse.ghost, pose:"open" }));
    }
    const { d, sx, sy, u } = geo;
    const f = {
      t, dt, w:innerWidth, h:innerHeight, u, theme, pal:PALETTES[theme], audio, inMargin, turning,
      hands:list.filter(h => h.palm),
      chimney:{ x:d.left + 1493.75 * sx, y:d.top + 2 * sy, w:127 * sx }
    };
    g.setTransform(1,0,0,1,0,0); g.clearRect(0, 0, layer.width, layer.height);
    g.setTransform(dpr,0,0,dpr,0,0);
    for (const { def, fx } of instances) {
      const active = on.has(def.id) && !turning;
      fx.update(f, active);
      g.save(); g.globalCompositeOperation = f.pal.blend; fx.draw(g, f); g.restore();
    }
  }
  return { frame, lab, layer };
}

