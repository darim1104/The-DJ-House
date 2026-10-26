/* 2. 방사형 불꽃놀이 — 여백에서 손을 접었다(주먹) 펴면 그 자리에서 불꽃이 하나 터진다.
      형태는 4가지 중 랜덤 1개: ① 점 동심원  ② 가는 선 햇살  ③ 네 꼭짓점 별  ④ 8갈래 별표(*)
      터진 뒤 계속 커지면서 점점 투명해져 서서히 사라진다. 색은 파스텔 팔레트 중 랜덤 1개. */
import { pick, rand } from "./shapes.js";

const FORMS = ["dots", "rays", "star4", "asterisk"];
const easeOut = t => 1 - Math.pow(1 - t, 3);

// 모든 형태는 반지름 1 기준으로 그린다 (g 는 이미 이동·확대된 상태, lw 는 화면 기준 선 두께를 1 단위로 환산한 값)
export function drawForm(g, form, lw) {
  if (form === "dots") {                       // 바깥 점 22개 + 안쪽 점 10개 + 가운데 점
    const dot = (x, y) => { g.beginPath(); g.arc(x, y, .045, 0, Math.PI * 2); g.fill(); };
    for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; dot(Math.cos(a), Math.sin(a)); }
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2; dot(Math.cos(a) * .48, Math.sin(a) * .48); }
    dot(0, 0);
  } else if (form === "rays") {                // 가운데가 비어 있는 가는 선 36개
    g.lineWidth = lw; g.lineCap = "butt"; g.beginPath();
    for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; g.moveTo(Math.cos(a) * .1, Math.sin(a) * .1); g.lineTo(Math.cos(a), Math.sin(a)); }
    g.stroke();
  } else if (form === "star4") {               // 오목한 네 꼭짓점 별 (채움)
    const k = .2; g.beginPath(); g.moveTo(0, -1);
    g.quadraticCurveTo(k, -k, 1, 0); g.quadraticCurveTo(k, k, 0, 1);
    g.quadraticCurveTo(-k, k, -1, 0); g.quadraticCurveTo(-k, -k, 0, -1);
    g.closePath(); g.fill();
  } else {                                     // 8갈래 별표: 세로가 가장 길고, 가로 → 대각선 순으로 짧아짐
    g.lineWidth = lw * 1.2; g.lineCap = "butt"; g.beginPath();
    const arm = [[0, 1], [Math.PI / 2, .92], [Math.PI / 4, .78], [-Math.PI / 4, .78]];
    for (const [a, l] of arm) { const s = Math.sin(a) * l, c = Math.cos(a) * l; g.moveTo(-s, -c); g.lineTo(s, c); }
    g.stroke();
  }
}

export default {
  id:"fireworks", name:"방사형 불꽃놀이", key:"2",
  create() {
    const bursts = []; const wasFist = {};
    return {
      update(f, active) {
        for (const h of f.hands) {
          if (h.pose === "fist") wasFist[h.id] = f.t;
          else if (h.pose === "open" && wasFist[h.id] && f.t - wasFist[h.id] < .8 && active && h.inMargin) {
            wasFist[h.id] = 0;
            const power = 1 + Math.min(1, f.audio.level * 6) * .5;      // 음악이 크면 조금 더 크게
            bursts.push({ x:h.palm.x, y:h.palm.y, t:0, max:2.6, form:pick(FORMS),
              color:pick(f.pal.colors), r0:50 * power, r1:230 * power, rot:rand(-.15, .15) });
            if (bursts.length > 6) bursts.shift();
          }
        }
        for (let i = bursts.length - 1; i >= 0; i--) { bursts[i].t += f.dt; if (bursts[i].t > bursts[i].max) bursts.splice(i, 1); }
      },
      draw(g, f) {
        for (const b of bursts) {
          const k = b.t / b.max;
          const R = (b.r0 + (b.r1 - b.r0) * easeOut(Math.min(1, k * 1.15)) + k * 40) * f.u;   // 빠르게 커졌다가 계속 천천히 커짐
          const alpha = Math.min(1, b.t / .06) * Math.pow(1 - k, 1.6);                            // 점점 투명하게
          g.save(); g.translate(b.x, b.y); g.rotate(b.rot); g.scale(R, R);
          g.globalAlpha = alpha * f.pal.alpha; g.fillStyle = g.strokeStyle = b.color;
          drawForm(g, b.form, 4 * f.u / R);
          g.restore();
        }
        g.globalAlpha = 1;
      }
    };
  }
};
