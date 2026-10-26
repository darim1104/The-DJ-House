/* 3. 화살표 흐름 — 여백에서 엄지·검지로 집은 채 끌면 끄는 방향으로 넓은 화살표가 생기고,
      놓으면 줄무늬·체커·점 패턴을 단 채 그 방향으로 흘러가며 사라진다. */
import { pattern, pick, rand } from "./shapes.js";
function arrowPath(g, len, h) {
  const head = Math.min(len * .4, h * 1.15), shaft = h * .62;
  g.beginPath();
  g.moveTo(0, -shaft / 2); g.lineTo(len - head, -shaft / 2); g.lineTo(len - head, -h / 2 * 1.35); g.lineTo(len, 0);
  g.lineTo(len - head, h / 2 * 1.35); g.lineTo(len - head, shaft / 2); g.lineTo(0, shaft / 2); g.closePath();
}
export default {
  id:"arrows", name:"화살표 흐름", key:"3",
  create() {
    const drags = {}, flying = [];
    return {
      update(f, active) {
        for (const h of f.hands) {
          const d = drags[h.id];
          if (active && h.pinch && !h.prevPinch && h.tipInMargin) drags[h.id] = { x:h.tip.x, y:h.tip.y, ex:h.tip.x, ey:h.tip.y, color:pick(f.pal.colors), kind:pick(["stripes", "checker", "vstripes", "dots", "solid"]) };
          else if (d && h.pinch) { d.ex = h.tip.x; d.ey = h.tip.y; }
          else if (d && !h.pinch) {
            const len = Math.hypot(d.ex - d.x, d.ey - d.y);
            if (len > 50 * f.u && flying.length < 8) flying.push({ ...d, len, ang:Math.atan2(d.ey - d.y, d.ex - d.x), life:0, max:1.8, speed:rand(260, 380) });
            delete drags[h.id];
          }
        }
        for (const id in drags) if (!f.hands.find(h => h.id === id)) delete drags[id];
        for (let i = flying.length - 1; i >= 0; i--) {
          const a = flying[i]; a.life += f.dt;
          a.x += Math.cos(a.ang) * a.speed * f.u * f.dt; a.y += Math.sin(a.ang) * a.speed * f.u * f.dt;
          if (a.life > a.max) flying.splice(i, 1);
        }
      },
      draw(g, f) {
        const paint = (a, len, alpha) => {
          const h = 96 * f.u;
          g.save(); g.translate(a.x, a.y); g.rotate(a.ang); g.globalAlpha = alpha * f.pal.alpha;
          arrowPath(g, len, h);
          g.fillStyle = a.kind === "solid" ? a.color : pattern(g, a.kind, a.color, 12 * f.u); g.fill();
          g.lineWidth = 3 * f.u; g.strokeStyle = a.color; g.stroke();
          g.restore();
        };
        for (const id in drags) { const d = drags[id], len = Math.hypot(d.ex - d.x, d.ey - d.y); if (len > 12) paint({ ...d, ang:Math.atan2(d.ey - d.y, d.ex - d.x) }, len, .8); }
        for (const a of flying) { const k = a.life / a.max; paint(a, a.len * (1 + k * .2), 1 - k * k); }
      }
    };
  }
};
