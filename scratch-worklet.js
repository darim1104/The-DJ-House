/* 턴테이블 스크래치 플레이어 (AudioWorklet)
   - 현재 앨범의 실제 음원(AudioBuffer 채널 데이터)을 가변 속도·양방향으로 읽는다.
   - 메인 스레드가 보내는 플래터 속도(1 = 정상 재생, 음수 = 역방향)를 샘플 단위로 부드럽게 따라가므로
     손 움직임에 따라 음높이·속도·방향이 연속적으로 변한다(그레인 반복이 없어 클릭 노이즈가 없음).
   - 같은 DSP가 script.js 안에 ScriptProcessor 폴백으로도 들어 있다. */
class ScratchPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ch = null; this.len = 0; this.ratio = 1; this.srcRate = sampleRate;
    this.pos = 0; this.rate = 0; this.target = 0; this.velGain = 0;
    this.lp = [0, 0]; this.dcX = [0, 0]; this.dcY = [0, 0];
    this.kRate = 1 - Math.exp(-1 / (sampleRate * 0.009));   // 속도 smoothing ≈ 9ms
    this.kGain = 1 - Math.exp(-1 / (sampleRate * 0.004));   // 정지/출발 gain ramp ≈ 4ms
    this.blocks = 0;
    this.port.onmessage = event => {
      const m = event.data;
      if (m.type === "load") {
        this.ch = m.channels; this.len = this.ch[0].length;
        this.srcRate = m.sampleRate; this.ratio = m.sampleRate / sampleRate;
      } else if (m.type === "start") {
        this.pos = m.position * this.srcRate; this.rate = m.rate; this.target = m.rate;
        this.velGain = Math.min(1, Math.abs(m.rate) / 0.12);
      } else if (m.type === "rate") {
        this.target = m.rate;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    if (!this.ch) { L.fill(0); if (R !== L) R.fill(0); return true; }
    const c0 = this.ch[0], c1 = this.ch[1] || this.ch[0], last = this.len - 3;
    for (let i = 0; i < L.length; i++) {
      this.rate += (this.target - this.rate) * this.kRate;
      const a = Math.abs(this.rate);
      this.velGain += (Math.min(1, a / 0.12) - this.velGain) * this.kGain;
      this.pos += this.rate * this.ratio;
      if (this.pos < 1) this.pos = 1; else if (this.pos > last) this.pos = last;
      const n = this.pos | 0, f = this.pos - n;
      // 빠를수록 고역을 살짝 줄여 앨리어싱을 막는 1-pole low-pass
      const alpha = a <= 1 ? 1 : Math.max(0.18, 1 / Math.pow(a, 0.85));
      for (let k = 0; k < 2; k++) {
        const d = k === 0 ? c0 : c1;
        const xm = d[n - 1], x0 = d[n], x1 = d[n + 1], x2 = d[n + 2];
        const c = (x1 - xm) * 0.5, v = x0 - x1, w = c + v, aa = w + v + (x2 - x0) * 0.5, bb = w + aa;
        let s = ((aa * f - bb) * f + c) * f + x0;          // Hermite 보간
        this.lp[k] += (s - this.lp[k]) * alpha; s = this.lp[k];
        const y = s - this.dcX[k] + 0.995 * this.dcY[k];   // DC 차단
        this.dcX[k] = s; this.dcY[k] = y;
        (k === 0 ? L : R)[i] = y * this.velGain;
      }
    }
    if (++this.blocks % 12 === 0) this.port.postMessage({ pos: this.pos / this.srcRate });
    return true;
  }
}
registerProcessor("scratch-player", ScratchPlayer);
