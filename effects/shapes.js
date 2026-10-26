/* ===== 효과들이 함께 쓰는 도형·패턴 ===== */
export function shape(g, type, x, y, s, rot, color, alpha = 1) {
  g.save(); g.translate(x, y); g.rotate(rot || 0); g.globalAlpha *= alpha; g.fillStyle = color;
  g.beginPath();
  if (type === "circle") g.arc(0, 0, s / 2, 0, Math.PI * 2);
  else if (type === "square") g.rect(-s / 2, -s / 2, s, s);
  else if (type === "bar") g.rect(-s / 2, -s / 6, s, s / 3);
  else if (type === "para") { const k = s * .18; g.moveTo(-s / 2 + k, -s / 2); g.lineTo(s / 2 + k, -s / 2); g.lineTo(s / 2 - k, s / 2); g.lineTo(-s / 2 - k, s / 2); }
  else if (type === "pennant") { g.moveTo(-s / 2, -s / 4); g.lineTo(s / 2, 0); g.lineTo(-s / 2, s / 4); }
  else if (type === "half") g.arc(0, 0, s / 2, Math.PI, 0);
  g.closePath(); g.fill(); g.restore();
}
const patternCache = new Map();
export function pattern(g, kind, color, cell) {
  const key = kind + color + Math.round(cell);
  if (patternCache.has(key)) return patternCache.get(key);
  const c = document.createElement("canvas"), n = Math.max(4, Math.round(cell));
  c.width = c.height = n * 2; const x = c.getContext("2d"); x.fillStyle = color;
  if (kind === "checker") { x.fillRect(0, 0, n, n); x.fillRect(n, n, n, n); }
  else if (kind === "stripes") { x.fillRect(0, 0, n * 2, n * .9); }
  else if (kind === "vstripes") { x.fillRect(0, 0, n * .9, n * 2); }
  else if (kind === "dots") { x.beginPath(); x.arc(n / 2, n / 2, n * .32, 0, Math.PI * 2); x.arc(n * 1.5, n * 1.5, n * .32, 0, Math.PI * 2); x.fill(); }
  const p = g.createPattern(c, "repeat"); patternCache.set(key, p); return p;
}
export const pick = a => a[Math.floor(Math.random() * a.length)];
export const rand = (a, b) => a + Math.random() * (b - a);
