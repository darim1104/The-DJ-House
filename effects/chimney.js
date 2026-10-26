/* 1. 굴뚝 도형 연기 — 음악이 나오면 덱 굴뚝에서 덱 버튼 모양(HIGH/MID/LOW 별, FILTER 타원 3겹, ECHO 곡선,
      SPACE 3/4 원, TEMPO·VOLUME·PAN 캡)이 파스텔 색으로 박자에 맞춰 겹치며 올라간다.
      손을 휘저으면(빠르게 움직이면) 손 근처 도형이 손이 움직인 방향으로 밀려 흩어진다. */
import { pick, rand } from "./shapes.js";
// 덱(index.html)의 버튼 도형을 그대로 가져옴 — 좌표는 약 ±38 (지름 76) 기준
const BUTTONS = [
  { color:"#cb4d00", fill:new Path2D("M-37.9-37.9Q0-19 37.9-37.9Q19 0 37.9 37.9Q0 19-37.9 37.9Q-19 0-37.9-37.9Z") },        // HIGH·MID·LOW
  { color:"#00745a", fill:(() => { const p = new Path2D(); for (const y of [-24.25, 0, 24.25]) { p.moveTo(38.5, y); p.ellipse(0, y, 38.5, 13.75, 0, 0, Math.PI * 2); } return p; })() }, // FILTER
  { color:"#ffaa02", stroke:new Path2D("M-15.3 -27.9 C-31.8 -22.9 -36.8 -2.9 -21.8 6.1 C-9.3 12.1 -1.8 -5.4 15.7 -3.9 C30.7 -1.9 27.2 17.1 27.2 30.6"), scale:1.257, width:13 }, // ECHO
  { color:"#93ffe8", fill:new Path2D("M0 0V-38.75A38.75 38.75 0 1 0 38.75 0Z") },                                                // SPACE
  { color:"#b19414", fill:new Path2D("M-32.2-35V35H-9.2V-11.7H10V11.6H32.2V-35Z") },                                              // TEMPO
  { color:"#fe4d00", fill:new Path2D("M-34.8 0.8V18.5H34.8V0.8L0-18.7Z") },                                                      // VOLUME
  { color:"#ffb9ff", fill:new Path2D("M-5-28.6L-32.1 0-5 28.6-4.6 15.5H4.6L5 28.6 32.1 0 5-28.6 4.6-15.5H-4.6Z") }             // PAN
];
function drawButton(g, b, color, x, y, size, rot, alpha) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(size / 76, size / 76); g.globalAlpha = alpha;
  if (b.stroke) { g.scale(b.scale, b.scale); g.lineWidth = b.width; g.lineCap = "butt"; g.strokeStyle = color; g.stroke(b.stroke); }
  else { g.fillStyle = color; g.fill(b.fill); }
  g.restore();
}
export default {
  id:"chimney", name:"굴뚝 도형 연기", key:"1",
  create() {
    const parts = []; let acc = 0;
    function emit(f, n, big) {
      for (let i = 0; i < n && parts.length < 90; i++) parts.push({
        x:f.chimney.x + rand(-.5, .5) * f.chimney.w, y:f.chimney.y - 6 * f.u,
        vx:rand(-38, 38), vy:-rand(50, 95), s:rand(22, big ? 58 : 40), grow:rand(6, 16),
        rot:pick([0, 0, rand(-.25, .25), rand(-Math.PI, Math.PI)]), vr:rand(-.25, .25),
        btn:pick(BUTTONS), color:pick(f.pal.colors), life:0, max:rand(4.5, 6.5), wob:rand(0, 6)
      });
    }
    return {
      update(f, active) {
        const playing = f.audio.level > .015;
        if (active && playing) {
          acc += f.dt;
          if (f.audio.beat) emit(f, 2, true);
          if (acc > .55) { acc = 0; emit(f, 1, false); }
        }
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]; p.life += f.dt;
          if (p.life > p.max) { parts.splice(i, 1); continue; }
          for (const h of f.hands) {                      // 손바람
            const d = Math.hypot(p.x - h.palm.x, p.y - h.palm.y), sp = Math.hypot(h.vx, h.vy);
            if (d < 170 * f.u && sp > 120) { const k = (1 - d / (170 * f.u)) * f.dt * 2.2; p.vx += h.vx * k; p.vy += h.vy * k; }
          }
          p.vx *= 1 - f.dt * .6; p.vy += (-80 - p.vy) * f.dt * .5;
          p.x += (p.vx + Math.sin(p.life * 1.3 + p.wob) * 10) * f.dt * f.u * 1.4;
          p.y += p.vy * f.dt * f.u * 1.4;
          p.rot += p.vr * f.dt; p.s += p.grow * f.dt;
        }
      },
      draw(g, f) {
        for (const p of parts) {
          const a = Math.min(1, p.life / .35) * Math.min(1, (p.max - p.life) / 1.4);
          drawButton(g, p.btn, p.color, p.x, p.y, p.s * f.u, p.rot, a * f.pal.alpha);
        }
      }
    };
  }
};
