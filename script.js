import { CONTROLS } from "./controls.js?v=20261024v22";
import { createFxLab } from "./effects/core.js?v=20261024v22";

/* ================= 1. 톤암 / LP / 음악 ================= */
const deck = document.getElementById("deck");
const lp = document.getElementById("lp");
const arm = document.getElementById("arm");
const handLayer = document.getElementById("handLayer");
const handCtx = handLayer.getContext("2d");
const leftHandState = document.getElementById("leftHandState");
const rightHandState = document.getElementById("rightHandState");
const fxPad = document.getElementById("fxPad");
const fxCursor = document.getElementById("fxCursor");
const hotCueButtons = [...document.querySelectorAll(".hotCueButton")];
const cueMessage = document.getElementById("cueMessage");
const DW = 1736, DH = 647;                 // 디자인 시안의 덱(집 모양) 좌표계
const PIVOT = { x: 612.85, y: 170.6 };     // 톤암 회전축 = 연두 원 중심
const REST = -20.2, PLAY_START = 0, PLAY_END = 0; // 각도(도). 톤암은 정지(LP 밖) ↔ 재생(LP 위) 두 자세 사이에서만 움직인다
const ARM_PLAY_THRESHOLD = -10;           // 이 각도보다 LP 쪽에 놓으면 재생, 바깥이면 정지
const ARM_MAX = PLAY_START;
const LP_C = { x: 396.6, y: 359.2 };
const LP_R = 260.5;                        // 테두리 포함 반지름
const FX_PAD = { cx:1483.2, cy:350.4, rx:217.25, ry:158.4 };  // FX 타원
const PLAY_BUTTON = { x1:137, y1:524.5, x2:237.8, y2:617.2 }; // PLAY 버튼(사각형)
const ARM_SHAPE = [[612.85, 170.6], [572, 448.6], [489.35, 531.7]]; // 회전 전 톤암 선(축 → 꺾임 → 헤드셸 중심)
const HOT_CUE_ENABLED = false;             // HOT CUE는 현재 디자인에서 제외(코드는 남겨 둠)

function layoutHandLayer() {
  const ratio = window.devicePixelRatio || 1;
  handLayer.width = Math.max(1, Math.round(window.innerWidth * ratio));
  handLayer.height = Math.max(1, Math.round(window.innerHeight * ratio));
}
function layoutStage() { layoutHandLayer(); }
layoutStage(); addEventListener("resize", layoutStage);

const TRACK = window.DJ_TRACK || { index: 2, mp3: "assets/song1.mp3", lp: "assets/lp/03.png" };
lp.src = TRACK.lp + "?v=20261024v22"; // 구멍 없는 LP PNG

const audio = document.getElementById("djAudio") || new Audio();
if (audio.getAttribute("src") !== TRACK.mp3) audio.src = TRACK.mp3;
audio.preload = "auto";
audio.muted = false;
audio.volume = 1;
let angle = REST, targetAngle = REST, animating = false;
let playing = false, dragging = false, spin = 0, spinSpeed = 0, scratching = false, pitchRate = 1;

// 손 그래픽 색: 밤 = 왼손 청록 / 오른손 #FF00FF, 낮 = 왼손 #1CED00 / 오른손 #FF4D00
const HAND_COLORS = { night:{ left:"#00f5d4", right:"#FF00FF" }, day:{ left:"#1CED00", right:"#FF4D00" } };
const handTheme = () => HAND_COLORS[document.getElementById("stage").dataset.theme === "day" ? "day" : "night"];
let LEFT_HAND_COLOR = HAND_COLORS.night.left;
let RIGHT_HAND_COLOR = HAND_COLORS.night.right;
const ACTIVE_COLOR = "#ff3b30";
const RING_ACTIVE = "#FF912B";       // 조작 중인 노브·페이더·FX를 감싸는 선 색
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[17,0]
];
const HAND_TIPS = [4,8,12,16,20];
const SCRATCH_TIPS = [8,12,16,20];
const leftHand = { smooth:null, lostFrames:99, pinching:false, playPressed:false };
const rightHand = { smooth:null, lostFrames:99, pinching:false, playPressed:false };
let handLandmarker = null;
let handControl = null;
let hoveredHandControl = null;
let handArmGrab = null;
let hoveredHandAction = null;
let handActionLatch = null;

function setArm(a) { angle = a; arm.style.transform = `rotate(${a}deg)`; }
setArm(REST);

function glideTo(a, ms = 700) {
  const from = angle, t0 = performance.now(); targetAngle = a; animating = true;
  const id = glideTo.id = (glideTo.id || 0) + 1;
  (function step(t) {
    if (id !== glideTo.id) return;
    const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2;
    setArm(from + (a - from) * e);
    if (k < 1) requestAnimationFrame(step); else animating = false;
  })(t0);
}
async function unlockAudio() {
  if (AC.state !== "running") await AC.resume();
}
async function startPlay() {
  if (playing && !audio.paused) return;
  if (platter.active) cancelScratch();
  try {
    await unlockAudio();
    if (audio.ended || (audio.duration && audio.currentTime >= audio.duration - .05)) audio.currentTime = 0;
    await audio.play();
    playing = true;
    glideTo(armAngleForTime(audio.currentTime));
  } catch (e) {
    console.warn("재생 실패", e);
    playing = false;
    glideTo(REST);
  }
}
function armAngleForTime(t) {
  const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  return d ? PLAY_START + (PLAY_END - PLAY_START) * clamp(t / d, 0, 1) : PLAY_START;
}
// 톤암을 옮겨 놓으면 그 위치(바늘 위치)로 곡 위치만 이동한다. 재생/정지는 PLAY 버튼만 담당.
function dropNeedle() {
  const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  // LP 밖(거치대 쪽)에 놓으면 곡 위치는 그대로 두고 제자리로
  if (!d || angle < PLAY_START - 4) { glideTo(playing ? armAngleForTime(audio.currentTime) : REST, 300); return; }
  const frac = clamp((angle - PLAY_START) / (PLAY_END - PLAY_START), 0, 1);
  if (angle < PLAY_START) setArm(PLAY_START);
  seekDeck(frac * (d - .1));
}
function armReleased() {
  if (angle >= ARM_PLAY_THRESHOLD) {
    if (playing && !audio.paused) glideTo(PLAY_START, 300);
    else startPlay();
  } else stopPlay();
}
function stopPlay() {
  if (!playing && angle === REST) return;
  if (!playing && audio.paused) { glideTo(REST); return; }
  if (platter.active) cancelScratch();
  playing = false; audio.pause(); glideTo(REST);
}
function togglePlay() { playing ? stopPlay() : startPlay(); }
audio.addEventListener("ended", () => { playing = false; audio.currentTime = 0; glideTo(REST, 900); });

// 회전 루프 (33⅓ rpm ≈ 200°/s) + 재생 중 톤암 미세 이동
let last = performance.now();
function loop(t) {
  const dt = Math.min(.05, Math.max(0, (t - last) / 1000)); last = t;
  if (!platter.active) { spinSpeed += ((playing ? 200 * pitchRate : 0) - spinSpeed) * Math.min(1, dt * 4); spin = (spin + spinSpeed * dt) % 360; }
  else platterTick(dt);
  lp.style.transform = `rotate(${spin}deg)`;
  fxTick(dt);
  if (playing && !dragging && !animating && audio.duration)
    setArm(PLAY_START + (PLAY_END - PLAY_START) * (audio.currentTime / audio.duration));
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop); // 모듈의 모든 상태가 선언된 뒤 첫 프레임부터 시작


/* ===== 오디오 엔진 ===== */
const AC = window.DJ_AUDIO_CONTEXT || new (window.AudioContext || window.webkitAudioContext)();
window.DJ_AUDIO_CONTEXT = AC;

const input = AC.createGain(); // 덱(미디어 요소) 신호. 스크래치·HOT CUE 이동 때 짧은 gain ramp로 클릭 방지
AC.createMediaElementSource(audio).connect(input);
audio.preservesPitch = false; audio.webkitPreservesPitch = false; audio.mozPreservesPitch = false;
const setP = (p, v) => p.setTargetAtTime(v, AC.currentTime, .02);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const lowEQ = AC.createBiquadFilter();
const midEQ = AC.createBiquadFilter();
const highEQ = AC.createBiquadFilter();
const toneFilter = AC.createBiquadFilter();
const panNode = AC.createStereoPanner ? AC.createStereoPanner() : AC.createGain();
const dryGain = AC.createGain();
const echoDelay = AC.createDelay(1.2);
const echoWet = AC.createGain();
const echoFeedback = AC.createGain();
/* FLANGER: dry/wet 병렬 + LFO로 변조되는 짧은 DelayNode + 제한된 feedback 루프 */
const flangerSend = AC.createGain();        // wet 경로 입력 (bypass 시 0)
const flangerSum = AC.createGain();         // 입력 + feedback 합산
const flangerDelay = AC.createDelay(.03);
const flangerWet = AC.createGain();
const flangerFeedback = AC.createGain();
const flangerFeedbackHP = AC.createBiquadFilter();
const flangerFeedbackLP = AC.createBiquadFilter();
const flangerClip = AC.createWaveShaper();
const flangerLFO = AC.createOscillator();
const flangerDepth = AC.createGain();
const channelVolume = AC.createGain();
const master = AC.createDynamicsCompressor();
const scratchBus = AC.createGain();
/* SPACE (DJ 믹서의 COLOR FX "SPACE"): 가운데 = 꺼짐, 위 = 밝은 고역 리버브, 아래 = 어두운 저역 리버브 */
const spaceSend = AC.createGain();
const spaceFilter = AC.createBiquadFilter();
const spaceVerb = AC.createConvolver();
const spaceWet = AC.createGain();

lowEQ.type = "lowshelf"; lowEQ.frequency.value = 240; lowEQ.gain.value = 0;
midEQ.type = "peaking"; midEQ.frequency.value = 1150; midEQ.Q.value = .78; midEQ.gain.value = 0;
highEQ.type = "highshelf"; highEQ.frequency.value = 4200; highEQ.gain.value = 0;
toneFilter.type = "allpass";
toneFilter.Q.value = .9;
dryGain.gain.value = 1;
echoDelay.delayTime.value = .28;
echoWet.gain.value = 0;
echoFeedback.gain.value = 0;
flangerSend.gain.value = 0;
flangerSum.gain.value = 1;
flangerDelay.delayTime.value = .004;
flangerWet.gain.value = 0;
flangerFeedback.gain.value = 0;
flangerFeedbackHP.type = "highpass"; flangerFeedbackHP.frequency.value = 120; flangerFeedbackHP.Q.value = .5;
flangerFeedbackLP.type = "lowpass"; flangerFeedbackLP.frequency.value = 9000; flangerFeedbackLP.Q.value = .5;
{ // feedback 루프 안의 soft clipper: 작은 신호는 그대로(기울기 1), 큰 신호만 눌러서 발진·폭주 방지
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * 1.2) / 1.2; }
  flangerClip.curve = curve;
}
flangerLFO.type = "sine";
flangerLFO.frequency.value = .5;
flangerDepth.gain.value = 0;
channelVolume.gain.value = 1;
scratchBus.gain.value = 1;
master.threshold.value = -4;
master.knee.value = 8;
master.ratio.value = 8;
master.attack.value = .003;
master.release.value = .18;

spaceSend.gain.value = 0;
spaceFilter.type = "highpass"; spaceFilter.frequency.value = 650; spaceFilter.Q.value = .6;
spaceWet.gain.value = 1;
spaceVerb.buffer = (() => {                 // 2.6초 스테레오 리버브 임펄스 응답
  const length = Math.round(AC.sampleRate * 2.6), pre = Math.round(AC.sampleRate * .014);
  const ir = AC.createBuffer(2, length, AC.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = pre; i < length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - (i - pre) / (length - pre), 3.4);
  }
  return ir;
})();

input.connect(lowEQ);
scratchBus.connect(lowEQ);
lowEQ.connect(midEQ);
midEQ.connect(highEQ);
highEQ.connect(toneFilter);
toneFilter.connect(panNode);
panNode.connect(dryGain);
dryGain.connect(channelVolume);
panNode.connect(echoDelay);
echoDelay.connect(echoWet);
echoWet.connect(channelVolume);
echoDelay.connect(echoFeedback);
echoFeedback.connect(echoDelay);
panNode.connect(spaceSend);
spaceSend.connect(spaceFilter);
spaceFilter.connect(spaceVerb);
spaceVerb.connect(spaceWet);
spaceWet.connect(channelVolume);
panNode.connect(flangerSend);
flangerSend.connect(flangerSum);
flangerSum.connect(flangerDelay);
flangerDelay.connect(flangerWet);
flangerWet.connect(channelVolume);
flangerDelay.connect(flangerFeedbackHP);
flangerFeedbackHP.connect(flangerFeedbackLP);
flangerFeedbackLP.connect(flangerClip);
flangerClip.connect(flangerFeedback);
flangerFeedback.connect(flangerSum);
channelVolume.connect(master);
master.connect(AC.destination);
flangerLFO.connect(flangerDepth);
flangerDepth.connect(flangerDelay.delayTime);
flangerLFO.start();

function rampParam(param, value, tau) {
  const now = AC.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(value, now, tau);
}
const deckGain = (value, tau = .005) => rampParam(input.gain, value, tau);

/* ===== 스크래치 엔진: 현재 앨범의 실제 음원(AudioBuffer)을 플래터 속도로 앞뒤 재생 ===== */
const RPM_DEG = 200;                     // 33⅓ rpm ≈ 200°/s = 재생 속도 1.0
const scratchOut = AC.createGain();
scratchOut.gain.value = 0;
scratchOut.connect(scratchBus);
const scratchGain = (value, tau = .005) => rampParam(scratchOut.gain, value, tau);
const scratchVoiceState = { pos:0 };     // 스크래치 플레이어의 실제 재생 위치(초)
let scratchVoice = null;
let scratchLoad = null;
let trackBlobURL = null;                 // 서버가 Range를 지원하지 않을 때 쓰는 탐색 가능한 사본

function decodeAudio(bytes) {
  return new Promise((resolve, reject) => {
    const promise = AC.decodeAudioData(bytes, resolve, reject); // Safari 구버전 콜백 방식 호환
    if (promise && promise.then) promise.then(resolve, reject);
  });
}

function createScriptVoice(channels, srcRate) {
  // AudioWorklet이 없는 브라우저용 폴백 (scratch-worklet.js와 같은 DSP)
  const node = AC.createScriptProcessor(1024, 1, 2);
  const c0 = channels[0], c1 = channels[1] || channels[0], last = c0.length - 3;
  const ratio = srcRate / AC.sampleRate;
  const kRate = 1 - Math.exp(-1 / (AC.sampleRate * .009));
  const kGain = 1 - Math.exp(-1 / (AC.sampleRate * .004));
  const st = { pos:0, rate:0, target:0, velGain:0, lp:[0, 0], dcX:[0, 0], dcY:[0, 0] };
  node.onaudioprocess = event => {
    const L = event.outputBuffer.getChannelData(0), R = event.outputBuffer.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      st.rate += (st.target - st.rate) * kRate;
      const a = Math.abs(st.rate);
      st.velGain += (Math.min(1, a / .12) - st.velGain) * kGain;
      st.pos += st.rate * ratio;
      if (st.pos < 1) st.pos = 1; else if (st.pos > last) st.pos = last;
      const n = st.pos | 0, f = st.pos - n;
      const alpha = a <= 1 ? 1 : Math.max(.18, 1 / Math.pow(a, .85));
      for (let k = 0; k < 2; k++) {
        const d = k === 0 ? c0 : c1;
        const xm = d[n - 1], x0 = d[n], x1 = d[n + 1], x2 = d[n + 2];
        const c = (x1 - xm) * .5, v = x0 - x1, w = c + v, aa = w + v + (x2 - x0) * .5, bb = w + aa;
        let s = ((aa * f - bb) * f + c) * f + x0;
        st.lp[k] += (s - st.lp[k]) * alpha; s = st.lp[k];
        const y = s - st.dcX[k] + .995 * st.dcY[k];
        st.dcX[k] = s; st.dcY[k] = y;
        (k === 0 ? L : R)[i] = y * st.velGain;
      }
    }
    scratchVoiceState.pos = st.pos / srcRate;
  };
  node.connect(scratchOut);
  return {
    kind:"script",
    post(m) {
      if (m.type === "start") { st.pos = m.position * srcRate; st.rate = st.target = m.rate; st.velGain = Math.min(1, Math.abs(m.rate) / .12); }
      else if (m.type === "rate") st.target = m.rate;
    }
  };
}

let firstSoundTime = 0;                  // 곡 앞쪽 무음이 끝나는 지점(재생 전 스크래치용)
function findFirstSound(buffer) {
  const d = buffer.getChannelData(0), win = 2048;
  for (let i = 0; i + win < d.length; i += win) {
    let sum = 0; for (let k = i; k < i + win; k += 4) sum += d[k] * d[k];
    if (Math.sqrt(sum / (win / 4)) > .03) return i / buffer.sampleRate;
  }
  return 0;
}
async function createScratchVoice(buffer) {
  firstSoundTime = findFirstSound(buffer);
  const channels = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c).slice());
  if (AC.audioWorklet && window.AudioWorkletNode) {
    try {
      await AC.audioWorklet.addModule("scratch-worklet.js?v=20261024v9");
      const node = new AudioWorkletNode(AC, "scratch-player", { numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2] });
      node.port.onmessage = event => { if (event.data && Number.isFinite(event.data.pos)) scratchVoiceState.pos = event.data.pos; };
      node.port.postMessage({ type:"load", channels, sampleRate:buffer.sampleRate }, channels.map(a => a.buffer));
      node.connect(scratchOut);
      return { kind:"worklet", post:m => node.port.postMessage(m) };
    } catch (error) {
      console.warn("AudioWorklet 사용 불가 → ScriptProcessor로 대체", error);
    }
  }
  return createScriptVoice(channels, buffer.sampleRate);
}

function prepareScratch() {
  if (scratchLoad) return scratchLoad;
  scratchLoad = fetch(TRACK.mp3)
    .then(response => {
      if (!response.ok) throw new Error("scratch audio load failed");
      return response.arrayBuffer();
    })
    .then(bytes => {
      try { trackBlobURL = URL.createObjectURL(new Blob([bytes.slice(0)], { type:"audio/mpeg" })); } catch (error) {}
      return decodeAudio(bytes);
    })
    .then(createScratchVoice)
    .then(voice => (scratchVoice = voice))
    .catch(error => {
      console.warn("스크래치 음원 준비 실패", error);
      scratchLoad = null;
      return null;
    });
  return scratchLoad;
}
prepareScratch();

/* 플래터(LP) 물리: 손/마우스 → low-pass → 목표 각도 → 임계감쇠 스프링 → 회전 속도 → 재생 속도 */
const SCRATCH_INPUT = {
  pointer:{ tau:.012, omega:2 * Math.PI * 13, radial:false, deadzone:0 },
  hand:{ tau:.05, omega:2 * Math.PI * 7, radial:true, deadzone:.06 }
};
const platter = {
  active:false, touching:false, owner:null, lastOwner:"pointer",
  angle:0, target:0, vel:0, raw:null, filt:null, prev:null,
  wasPlaying:false, pos:0, voiceReady:false
};

function platterDelta(prev, cur, cfg) {
  // 이동량을 LP 접선 방향으로 투영 → 회전 각도. 손은 앞뒤·위아래 어느 방향이든 반응하도록 반경 방향도 보조 반영
  const mx = (prev.x + cur.x) / 2 - LP_C.x, my = (prev.y + cur.y) / 2 - LP_C.y;
  const r = Math.max(1, Math.hypot(mx, my));
  const dx = cur.x - prev.x, dy = cur.y - prev.y;
  const tangential = dx * (-my / r) + dy * (mx / r);
  const radial = dx * (mx / r) + dy * (my / r);
  let s = tangential;
  if (cfg.radial && Math.abs(radial) > Math.abs(tangential) * 1.4) s = Math.hypot(dx, dy) * Math.sign(dx - dy);
  let degrees = s / Math.max(r, 95) * 180 / Math.PI;
  if (cfg.deadzone) degrees = Math.sign(degrees) * Math.max(0, Math.abs(degrees) - cfg.deadzone);
  return degrees;
}

function scratchGrab(owner, p) {
  if (platter.touching && platter.owner !== owner) return false;
  unlockAudio(); prepareScratch();
  if (!platter.active) {
    platter.active = true;
    platter.wasPlaying = playing && !audio.paused;
    platter.pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    // 재생 전(정지 상태)에도 LP를 흔들면 소리가 나도록, 곡 맨 앞 무음 구간이면 첫 소리 지점부터 긁는다
    if (!platter.wasPlaying && platter.pos < firstSoundTime) platter.pos = firstSoundTime;
    platter.angle = spin;
    platter.vel = spinSpeed;                      // 돌던 속도 그대로 손이 붙잡는다
    platter.voiceReady = !!scratchVoice;
    if (scratchVoice) {
      scratchVoiceState.pos = platter.pos;
      scratchVoice.post({ type:"start", position:platter.pos, rate:platter.vel / RPM_DEG });
      deckGain(0, .004);                          // 원래 재생은 무음으로 계속 진행(slip) → 끝나면 그 흐름으로 복귀
      scratchGain(1, .004);
    }
  }
  platter.touching = true; platter.owner = owner; platter.lastOwner = owner;
  platter.target = platter.angle;
  platter.raw = { x:p.x, y:p.y }; platter.filt = { x:p.x, y:p.y }; platter.prev = { x:p.x, y:p.y };
  scratching = true;
  return true;
}
function scratchMove(owner, p) {
  if (platter.touching && platter.owner === owner) platter.raw = { x:p.x, y:p.y };
}
function scratchRelease(owner) {
  if (!platter.touching || platter.owner !== owner) return;
  platter.touching = false; platter.owner = null;
}

function platterTick(dt) {
  const cfg = SCRATCH_INPUT[platter.owner || platter.lastOwner];
  if (platter.touching && platter.raw) {
    const k = 1 - Math.exp(-dt / cfg.tau);
    platter.filt = { x:platter.filt.x + (platter.raw.x - platter.filt.x) * k, y:platter.filt.y + (platter.raw.y - platter.filt.y) * k };
    platter.target += platterDelta(platter.prev, platter.filt, cfg);
    platter.prev = platter.filt;
    const steps = Math.max(1, Math.ceil(dt / .004)), h = dt / steps, w = cfg.omega;
    for (let i = 0; i < steps; i++) {
      platter.vel += (w * w * (platter.target - platter.angle) - 2 * w * platter.vel) * h;
      platter.vel = clamp(platter.vel, -RPM_DEG * 10, RPM_DEG * 10);
      platter.angle += platter.vel * h;
    }
  } else {
    // 손을 놓은 뒤: 재생 중이었다면 모터가 원래 속도로 다시 끌어올리고, 아니면 짧은 관성 후 감속
    const motor = platter.wasPlaying && playing;
    const goal = motor ? RPM_DEG * pitchRate : 0;
    platter.vel += (goal - platter.vel) * (1 - Math.exp(-dt / (motor ? .16 : .12)));
    platter.angle += platter.vel * dt;
    if (Math.abs(platter.vel - goal) < (motor ? 6 : 4)) {
      spin = ((platter.angle % 360) + 360) % 360;
      finishScratch();
      return;
    }
  }
  spin = ((platter.angle % 360) + 360) % 360;
  const rate = platter.vel / RPM_DEG;
  const duration = Number.isFinite(audio.duration) ? audio.duration : Infinity;
  platter.pos = clamp(platter.pos + rate * dt, 0, duration);
  if (scratchVoice && platter.voiceReady) scratchVoice.post({ type:"rate", rate });
}

function finishScratch(immediate = false) {
  if (!platter.active) return;
  const tau = immediate ? .003 : .008;
  if (platter.voiceReady) {
    scratchGain(0, tau);
    // 정지 상태에서 흔든 경우 곡 위치는 바꾸지 않는다(PLAY를 누르면 원래 위치에서 시작)
    deckGain(1, tau);
    scratchVoice.post({ type:"rate", rate:0 });
  }
  spinSpeed = platter.vel;
  platter.active = false; platter.touching = false; platter.owner = null;
  scratching = false;
}
const cancelScratch = () => finishScratch(true);

/* ===== FLANGER (XY 패드) ===== */
const fx = { x:.5, y:.5, tx:.5, ty:.5, active:false, releaseTimer:0, applied:null };
let fxSource = null;
let fxHandHover = false;
let fxActive = false;

function flangerParams(x, y) {
  const deep = 1 - y;                                      // 위 = 깊게, 아래 = 가볍게
  const rate = .12 * Math.pow(4 / .12, x);                 // 왼쪽 0.12Hz → 오른쪽 4Hz
  const sweep = .0006 + deep * .0034;                      // LFO 진폭 ±0.6ms → ±4ms
  const center = .0032 + sweep;                            // 최소 지연 3.2ms 유지(feedback 루프 최소 지연보다 길게)
  const feedback = Math.min(.72, .18 + deep * .48 + x * .06);
  const mix = .32 + deep * .18;                            // wet 비율 0.32 → 0.5
  const dry = Math.cos(mix * Math.PI / 2);                 // equal-power + feedback 보정으로 전체 음량 유지
  const wet = Math.sin(mix * Math.PI / 2) * (1 - .45 * feedback);
  return { rate, sweep, center, feedback, mix, dry, wet, deep };
}

function applyFlanger(tau = .03) {
  const p = flangerParams(fx.x, fx.y);
  const now = AC.currentTime;
  flangerLFO.frequency.setTargetAtTime(p.rate, now, tau);
  flangerDelay.delayTime.setTargetAtTime(p.center, now, tau);
  flangerDepth.gain.setTargetAtTime(p.sweep, now, tau);
  flangerFeedback.gain.setTargetAtTime(p.feedback, now, tau);
  flangerWet.gain.setTargetAtTime(p.wet, now, tau);
  dryGain.gain.setTargetAtTime(p.dry, now, tau);
  fx.applied = p;
}

function setFlangerUI() {
  const x = fx.active ? fx.x : .5, y = fx.active ? fx.y : .5;
  fxCursor.style.left = (x * 100) + "%";
  fxCursor.style.top = (y * 100) + "%";
  fxPad.style.setProperty("--fx-x", (x * 100) + "%");
  fxPad.style.setProperty("--fx-y", (y * 100) + "%");
  fxPad.classList.toggle("active", fx.active);
  deck.classList.toggle("fx-on", fx.active);
}

function setFlanger(x, y, active) {
  fx.tx = clamp(x, 0, 1);
  fx.ty = clamp(y, 0, 1);
  if (active && !fx.active) {
    clearTimeout(fx.releaseTimer);
    fx.x = fx.tx; fx.y = fx.ty;                            // 누른 지점에서 바로 시작
    fx.active = fxActive = true;
    const now = AC.currentTime;
    flangerSend.gain.cancelScheduledValues(now);
    flangerSend.gain.setTargetAtTime(1, now, .01);
    applyFlanger(.04);                                     // 짧은 fade-in
    setFlangerUI();
  } else if (!active && fx.active) {
    fx.active = fxActive = false;
    const now = AC.currentTime;
    flangerWet.gain.setTargetAtTime(0, now, .07);          // 짧은 fade 후 bypass
    dryGain.gain.setTargetAtTime(1, now, .07);
    setFlangerUI();
    clearTimeout(fx.releaseTimer);
    fx.releaseTimer = setTimeout(() => {
      if (fx.active) return;
      const t = AC.currentTime;                            // 완전한 bypass: dry 100%, wet 0%
      for (const [param, value] of [[flangerWet.gain, 0], [dryGain.gain, 1], [flangerSend.gain, 0], [flangerFeedback.gain, 0], [flangerDepth.gain, 0]]) {
        param.cancelScheduledValues(t); param.setValueAtTime(value, t);
      }
    }, 600);
  }
}

function fxTick(dt) {
  if (!fx.active) return;
  const k = 1 - Math.exp(-dt / .06);                       // 손·마우스 이동 smoothing
  const nx = fx.x + (fx.tx - fx.x) * k, ny = fx.y + (fx.ty - fx.y) * k;
  if (Math.abs(nx - fx.x) + Math.abs(ny - fx.y) < 1e-4) return;
  fx.x = nx; fx.y = ny;
  applyFlanger(.03);
  setFlangerUI();
}

function releaseFlanger(source) {
  if (fxSource !== source) return;
  fxSource = null;
  setFlanger(.5, .5, false);
}

setFlangerUI();

function applyCtl(c) {
  const v = c.v, b = (v - .5) * 2;
  switch (c.fn) {
    case "high": setP(highEQ.gain, b * 12); break;
    case "mid": setP(midEQ.gain, b * 12); break;
    case "low": setP(lowEQ.gain, b * 12); break;
    case "filter":
      if (Math.abs(b) < .04) toneFilter.type = "allpass";
      else if (b < 0) { toneFilter.type = "lowpass"; setP(toneFilter.frequency, 20000 * Math.pow(.012, -b)); }
      else { toneFilter.type = "highpass"; setP(toneFilter.frequency, 20 * Math.pow(100, b)); }
      break;
    case "echo":
      setP(echoDelay.delayTime, .11 + v * .34);
      setP(echoWet.gain, v < .02 ? 0 : .06 + v * .58);
      setP(echoFeedback.gain, v * .68);
      break;
    case "pan": if (panNode.pan) setP(panNode.pan, b); break;
    case "vol":  setP(channelVolume.gain, v <= c.v0 ? Math.pow(v / c.v0, 1.6) : 1 + (v - c.v0) / (1 - c.v0) * .35); break; // 시안 위치 = 원음 크기
    case "space": {
      const s = v >= c.v0 ? (v - c.v0) / (1 - c.v0) : -(c.v0 - v) / c.v0;
      const amount = Math.abs(s) < .04 ? 0 : (Math.abs(s) - .04) / .96;
      if (amount > 0) {
        const type = s > 0 ? "highpass" : "lowpass";
        if (spaceFilter.type !== type) spaceFilter.type = type;
        setP(spaceFilter.frequency, s > 0 ? 450 + amount * 900 : 2400 - amount * 1500);
      }
      setP(spaceSend.gain, 1.15 * Math.pow(amount, 1.25));
      break;
    }
    case "pitch": { const d = v - c.v0; pitchRate = 1 + (d > 0 ? d / (1 - c.v0) : d / c.v0) * .08; audio.playbackRate = pitchRate; break; }
  }
}


/* ===== HOT CUE 1–4 ===== */
const HOT_CUE_KEY = `theDJHouse.hotCues.v1.${TRACK.index ?? "x"}.${TRACK.mp3}`; // 앨범마다 따로 저장
function loadHotCues() {
  try {
    const saved = JSON.parse(localStorage.getItem(HOT_CUE_KEY));
    if (Array.isArray(saved) && saved.length === 4) return saved.map(v => Number.isFinite(v) && v > 0 ? v : null);
  } catch (error) {}
  return [null, null, null, null];
}
const hotCues = loadHotCues();
function saveHotCues() {
  try { localStorage.setItem(HOT_CUE_KEY, JSON.stringify(hotCues)); } catch (error) {}
}

function pulseButton(element) {
  element.classList.remove("pulse");
  void element.offsetWidth;
  element.classList.add("pulse");
  setTimeout(() => element.classList.remove("pulse"), 130);
}

function cueTime(value) {
  const minute = Math.floor(value / 60);
  const second = (value % 60).toFixed(2).padStart(5, "0");
  return `${minute}:${second}`;
}

function showCueMessage(message) {
  cueMessage.textContent = message;
}

function updateHotCueButtons() {
  hotCueButtons.forEach((button, index) => {
    const t = hotCues[index];
    button.classList.toggle("saved", t !== null);
    if (t !== null) button.title = `HOT CUE ${index + 1} · ${cueTime(t)}`;
    else button.removeAttribute("title");
  });
}
updateHotCueButtons();

function currentDeckTime() {
  if (platter.active && !platter.wasPlaying && platter.voiceReady) return scratchVoiceState.pos;
  return audio.currentTime;
}

function isSeekable(t) {
  const ranges = audio.seekable;
  for (let i = 0; i < ranges.length; i++) if (t >= ranges.start(i) - .01 && t <= ranges.end(i) + .01) return true;
  return false;
}
function waitForAudio(eventName, ms) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; audio.removeEventListener(eventName, finish); resolve(); };
    audio.addEventListener(eventName, finish);
    setTimeout(finish, ms);
  });
}
async function useBlobSource() {
  // Range 요청을 지원하지 않는 서버에서도 탐색이 되도록, 이미 받아 둔 음원 사본으로 교체(같은 MP3)
  await prepareScratch();
  if (!trackBlobURL || audio.src === trackBlobURL) return false;
  audio.pause();
  audio.src = trackBlobURL;
  audio.load();
  await waitForAudio("loadedmetadata", 4000);
  return true;
}
let seekToken = 0;
async function seekDeck(t) {
  const token = ++seekToken;
  if (audio.readyState < 1) await waitForAudio("loadedmetadata", 4000);
  if (Number.isFinite(audio.duration)) t = Math.min(t, audio.duration - .05);
  if (!isSeekable(t)) await useBlobSource();
  if (token !== seekToken) return false;
  deckGain(0, .003);
  const landed = waitForAudio("seeked", 1500);
  audio.currentTime = t;
  await landed;
  if (token !== seekToken) return false;
  if (Math.abs(audio.currentTime - t) > .25 && await useBlobSource()) {
    const again = waitForAudio("seeked", 1500);
    audio.currentTime = t;
    await again;
  }
  deckGain(1, .006);
  return Math.abs(audio.currentTime - t) <= .25;
}

async function jumpToHotCue(index) {
  const t = hotCues[index];
  if (t === null) return;
  if (platter.active) cancelScratch();
  unlockAudio();
  showCueMessage(`CUE ${index + 1} · ${cueTime(t)}`);
  const landed = await seekDeck(t);
  if (!landed) {
    console.warn("HOT CUE 이동 실패", t, audio.currentTime);
    showCueMessage("CUE JUMP FAILED");
    return;
  }
  try {
    if (audio.paused) { await unlockAudio(); await audio.play(); }
    playing = true;
    if (audio.duration) glideTo(PLAY_START + (PLAY_END - PLAY_START) * (t / audio.duration), 260);
  } catch (error) {
    console.warn("HOT CUE 재생 실패", error);
  }
}

function triggerHotCue(index) {
  const button = hotCueButtons[index];
  if (!button) return;
  unlockAudio();
  pulseButton(button);
  if (hotCues[index] === null) {
    const t = currentDeckTime();              // 저장만 하고 재생 상태·위치는 그대로 둔다
    if (!Number.isFinite(t) || t < .05) { showCueMessage("PLAY TRACK FIRST"); return; }
    hotCues[index] = t;
    saveHotCues();
    updateHotCueButtons();
    showCueMessage(`CUE ${index + 1} SET · ${cueTime(t)}`);
    return;
  }
  jumpToHotCue(index);
}

function clearHotCue(index) {
  hotCues[index] = null;
  saveHotCues();
  hotCueButtons[index].classList.remove("pulse");
  updateHotCueButtons();
  showCueMessage(`CUE ${index + 1} CLEARED`);
}

function triggerAction(id) {
  if (id.startsWith("cue")) triggerHotCue(Number(id.slice(3)));
}

hotCueButtons.forEach((button, index) => {
  button.addEventListener("pointerdown", event => {
    if (event.button === 2) return;           // 우클릭은 삭제 전용
    event.preventDefault(); event.stopPropagation(); triggerHotCue(index);
  });
  button.addEventListener("contextmenu", event => {
    event.preventDefault(); event.stopPropagation(); clearHotCue(index);
  });
});

const ACTION_TARGETS = !HOT_CUE_ENABLED ? [] : [
  {id:"cue0", label:"HOT CUE 1", x1:531, y1:156.25, x2:583.6, y2:208.85},
  {id:"cue1", label:"HOT CUE 2", x1:531, y1:243.5, x2:583.6, y2:296.1},
  {id:"cue2", label:"HOT CUE 3", x1:531, y1:329.5, x2:583.6, y2:382.1},
  {id:"cue3", label:"HOT CUE 4", x1:531, y1:416.25, x2:583.6, y2:468.85}
];

const lpAngle = p => Math.atan2(p.y - LP_C.y, p.x - LP_C.x) * 180 / Math.PI;
const onLP = p => Math.hypot(p.x - LP_C.x, p.y - LP_C.y) < LP_R;
const onStartStop = p => p.x >= PLAY_BUTTON.x1 && p.x <= PLAY_BUTTON.x2 && p.y >= PLAY_BUTTON.y1 && p.y <= PLAY_BUTTON.y2;

function fourFingerCenter(points) {
  let x = 0, y = 0;
  for (const i of SCRATCH_TIPS) { x += points[i].x; y += points[i].y; }
  return { x:x / SCRATCH_TIPS.length, y:y / SCRATCH_TIPS.length };
}
function updateHandScratch(points) {
  const handOwns = platter.touching && platter.owner === "hand";
  if (!points) { if (handOwns) scratchRelease("hand"); return; }
  let contact = 0;
  for (const i of SCRATCH_TIPS) if (onLP(points[i])) contact++;
  if (contact < (handOwns ? 3 : 4)) { if (handOwns) scratchRelease("hand"); return; }
  const center = fourFingerCenter(points);
  if (handOwns) scratchMove("hand", center);
  else scratchGrab("hand", center);
}

/* ===== 믹서/피치 컨트롤 레이어 (원본 이미지에서 잘라낸 부품을 위에 얹어 직접 조작) ===== */
for (const c of CONTROLS) {
  c.cx = c.x; c.cy = c.y;
  if (c.kind === "vf" || c.kind === "pitch") c.v0 = (c.ybot - c.y) / (c.ybot - c.ytop);
  if (c.kind === "hf") c.v0 = (c.x - c.xl) / (c.xr - c.xl);
  c.v = c.v0;
  c.el = document.getElementById(c.id);       // 시안의 SVG 그래픽을 그대로 움직인다
  placeCtl(c); applyCtl(c);
}
function placeCtl(c) {
  if (c.kind === "knob") { c.el.setAttribute("transform", `translate(${c.cx} ${c.cy}) rotate(${(c.v - c.v0) * 270})`); return; }
  if (c.kind === "hf") c.cx = c.xl + c.v * (c.xr - c.xl);
  else c.cy = c.ybot - c.v * (c.ybot - c.ytop);
  c.el.setAttribute("transform", `translate(${c.cx} ${c.cy})`);
}

function controlLabel(c) {
  return c.label || c.fn.toUpperCase();
}
const handTargets = CONTROLS.map(c => ({
  id:c.id,
  label:controlLabel(c),
  kind:c.kind === "knob" ? "knob" : c.kind === "hf" ? "horizontal" : "vertical",
  c
}));

function applyHandTarget(target, value) {
  value = Math.max(0, Math.min(1, value));
  target.c.v = value;
  placeCtl(target.c);
  applyCtl(target.c);
}

function handTargetAt(p) {
  if (!p) return null;
  let best = null, bestDistance = Infinity;
  for (const target of handTargets) {
    const c = target.c;
    let d;
    if (target.kind === "knob") d = Math.hypot(p.x - c.cx, p.y - c.cy);
    else if (target.kind === "horizontal") d = p.x > c.xl - 18 && p.x < c.xr + 18 && Math.abs(p.y - c.cy) < 28 ? Math.abs(p.y - c.cy) : Infinity;
    else d = Math.abs(p.x - c.cx) < 30 && p.y > c.ytop - 20 && p.y < c.ybot + 20 ? Math.abs(p.x - c.cx) : Infinity;
    const limit = target.kind === "knob" ? Math.max(25, c.w * .7) : 30;
    if (d < limit && d < bestDistance) { best = target; bestDistance = d; }
  }
  return best;
}

function actionTargetAt(p) {
  if (!p) return null;
  return ACTION_TARGETS.find(target =>
    p.x >= target.x1 && p.x <= target.x2 && p.y >= target.y1 && p.y <= target.y2
  ) || null;
}

function updateHandActions(points) {
  const p = pinchPoint(points);
  hoveredHandAction = actionTargetAt(p);
  if (!p || !rightHand.pinching) {
    handActionLatch = null;
    return false;
  }
  if (hoveredHandAction && handActionLatch !== hoveredHandAction.id) {
    handActionLatch = hoveredHandAction.id;
    unlockAudio();
    triggerAction(hoveredHandAction.id);
  }
  return !!hoveredHandAction;
}

function normalizeTurn(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function updateHandControls(points) {
  if (!points) {
    hoveredHandControl = null;
    handControl = null;
    return;
  }
  const p = { x:(points[4].x + points[8].x) / 2, y:(points[4].y + points[8].y) / 2 };
  hoveredHandControl = handTargetAt(p);
  if (!rightHand.pinching) { handControl = null; return; }
  if (!handControl && hoveredHandControl) {
    const c = hoveredHandControl.c;
    handControl = {
      target:hoveredHandControl,
      angle:Math.atan2(p.y - c.cy, p.x - c.cx),
      radius:Math.hypot(p.x - c.cx, p.y - c.cy),
      y:p.y,
      value:c.v
    };
    unlockAudio();
  }
  if (!handControl) return;
  const target = handControl.target, c = target.c;
  if (target.kind === "knob") {
    const currentAngle = Math.atan2(p.y - c.cy, p.x - c.cx);
    const currentRadius = Math.hypot(p.x - c.cx, p.y - c.cy);
    if (currentRadius > 8 && handControl.radius > 8) {
      c.v += normalizeTurn(currentAngle - handControl.angle) / (Math.PI * 1.5);
    } else {
      c.v += (handControl.y - p.y) / 120;
    }
    handControl.angle = currentAngle;
    handControl.radius = currentRadius;
    handControl.y = p.y;
    applyHandTarget(target, c.v);
  } else if (target.kind === "horizontal") {
    const value = (p.x - c.xl) / (c.xr - c.xl);
    applyHandTarget(target, value);
  } else {
    const value = (c.ybot - p.y) / (c.ybot - c.ytop);
    applyHandTarget(target, value);
  }
}

// 타원 안의 위치 → 0~1 값. 타원 밖으로 나가면 가장자리에 붙인다(중앙 원 기준 사분면은 기존과 동일)
function fxValueFromUnit(u, v) {
  const r = Math.hypot(u, v);
  if (r > 1) { u /= r; v /= r; }
  return { x:(u + 1) / 2, y:(v + 1) / 2 };
}
function fxValueFromDeckPoint(p) {
  return fxValueFromUnit((p.x - FX_PAD.cx) / FX_PAD.rx, (p.y - FX_PAD.cy) / FX_PAD.ry);
}

function pointInsideFX(p) {
  return !!p && Math.hypot((p.x - FX_PAD.cx) / FX_PAD.rx, (p.y - FX_PAD.cy) / FX_PAD.ry) <= 1;
}

function updateHandFX(points) {
  const p = pinchPoint(points);
  fxHandHover = pointInsideFX(p);

  if (!p || !rightHand.pinching) {
    releaseFlanger("hand");
    return false;
  }

  if (!fxSource && fxHandHover) {
    fxSource = "hand";
    unlockAudio();
  }

  if (fxSource !== "hand") return false;
  const value = fxValueFromDeckPoint(p);
  setFlanger(value.x, value.y, true);
  return true;
}

let ctl = null, lastTap = { id: "", t: 0 };
function ctlDown(e, p) {
  for (const c of CONTROLS) {
    const hit = c.kind === "knob" ? Math.hypot(p.x - c.cx, p.y - c.cy) < c.w / 2 + 2
      : Math.abs(p.x - c.cx) < c.w / 2 + 4 && Math.abs(p.y - c.cy) < c.h / 2 + 4;
    if (!hit) continue;
    const now = performance.now();
    if (lastTap.id === c.id && now - lastTap.t < 350) { c.v = c.v0; placeCtl(c); applyCtl(c); lastTap = { id: "", t: 0 }; return true; } // 더블클릭 = 초기화
    lastTap = { id: c.id, t: now };
    ctl = { c, sy: e.clientY, v: c.v, off: c.kind === "hf" ? p.x - c.cx : p.y - c.cy };
    deck.setPointerCapture(e.pointerId); return true;
  } return false;
}
function ctlMove(e) {
  const c = ctl.c, p = toDeck(e);
  if (c.kind === "knob") c.v = Math.max(0, Math.min(1, ctl.v + (ctl.sy - e.clientY) / 160));
  else if (c.kind === "hf") c.v = Math.max(0, Math.min(1, (p.x - ctl.off - c.xl) / (c.xr - c.xl)));
  else c.v = Math.max(0, Math.min(1, (c.ybot - (p.y - ctl.off)) / (c.ybot - c.ytop)));
  placeCtl(c); applyCtl(c);
}

function fxValueFromClient(event) {
  const rect = fxPad.getBoundingClientRect();
  return fxValueFromUnit((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
}

fxPad.addEventListener("pointerdown", event => {
  event.preventDefault();
  event.stopPropagation();
  if (fxSource && fxSource !== "pointer") return;
  fxSource = "pointer";
  fxPad.setPointerCapture(event.pointerId);
  unlockAudio();
  const value = fxValueFromClient(event);
  setFlanger(value.x, value.y, true);
});

fxPad.addEventListener("pointermove", event => {
  if (fxSource !== "pointer") return;
  event.preventDefault();
  event.stopPropagation();
  const value = fxValueFromClient(event);
  setFlanger(value.x, value.y, true);
});

fxPad.addEventListener("pointerup", event => {
  event.preventDefault();
  event.stopPropagation();
  releaseFlanger("pointer");
});

fxPad.addEventListener("pointercancel", () => releaseFlanger("pointer"));

// 톤암 픽셀 히트 테스트 (알파 채널)
function toDeck(e) { const r = deck.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * DW, y: (e.clientY - r.top) / r.height * DH }; }
function segmentDistance(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], t = clamp(((p.x - a[0]) * vx + (p.y - a[1]) * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(p.x - a[0] - vx * t, p.y - a[1] - vy * t);
}
function onArm(p) {
  // 현재 각도만큼 되돌린 점이 톤암 선(빨간 원 · 세로선 · 사선 · 화살표) 근처인지 검사
  const a = -angle * Math.PI / 180, dx = p.x - PIVOT.x, dy = p.y - PIVOT.y;
  const u = { x:PIVOT.x + dx * Math.cos(a) - dy * Math.sin(a), y:PIVOT.y + dx * Math.sin(a) + dy * Math.cos(a) };
  if (Math.hypot(u.x - PIVOT.x, u.y - PIVOT.y) < 38) return true;
  if (Math.hypot(u.x - ARM_SHAPE[2][0], u.y - ARM_SHAPE[2][1]) < 46) return true;   // 헤드셸
  return segmentDistance(u, ARM_SHAPE[0], ARM_SHAPE[1]) < 14 || segmentDistance(u, ARM_SHAPE[1], ARM_SHAPE[2]) < 16;
}
const ang = p => Math.atan2(p.y - PIVOT.y, p.x - PIVOT.x) * 180 / Math.PI;
function pinchPoint(points) {
  return points ? { x:(points[4].x + points[8].x) / 2, y:(points[4].y + points[8].y) / 2 } : null;
}
function updateHandPlay(points, role) {
  const p = pinchPoint(points);
  const touching = p && onStartStop(p);
  if (touching && role.pinching && !role.playPressed) {
    role.playPressed = true;
    startButton.classList.add("pressed"); setTimeout(() => startButton.classList.remove("pressed"), 120);
    togglePlay();
  }
  if (!touching || !role.pinching) role.playPressed = false;
}
function finishHandArm() {
  if (!handArmGrab) return;
  handArmGrab = null;
  dragging = false;
  armReleased();
}
function updateHandArm(points) {
  const p = pinchPoint(points);
  if (!p) { finishHandArm(); return false; }
  if (!handArmGrab && leftHand.pinching && onArm(p)) {
    if (platter.owner === "hand") scratchRelease("hand");
    handArmGrab = { offset:angle - ang(p) };
    glideTo.id = (glideTo.id || 0) + 1;
    animating = false;
    dragging = true;
    unlockAudio();
  }
  if (!handArmGrab) return false;
  if (!leftHand.pinching) { finishHandArm(); return false; }
  setArm(Math.max(REST, Math.min(ARM_MAX, ang(p) + handArmGrab.offset)));
  return true;
}
let grab = null;
deck.addEventListener("pointerdown", e => {
  const p = toDeck(e); unlockAudio();
  if (ctlDown(e, p)) return;
  if (onStartStop(p)) { togglePlay(); return; } // START/STOP
  if (!onArm(p)) { if (onLP(p) && scratchGrab("pointer", p)) deck.setPointerCapture(e.pointerId); return; }
  grab = { offset: angle - ang(p), x: e.clientX, y: e.clientY, moved: false };
  deck.setPointerCapture(e.pointerId); glideTo.id++; animating = false;
});
deck.addEventListener("pointermove", e => {
  if (ctl) { ctlMove(e); return; }
  if (platter.owner === "pointer") { scratchMove("pointer", toDeck(e)); return; }
  if (!grab) return;
  if (Math.hypot(e.clientX - grab.x, e.clientY - grab.y) > 5) grab.moved = true;
  if (!grab.moved) return; dragging = true;
  setArm(Math.max(REST, Math.min(ARM_MAX, ang(toDeck(e)) + grab.offset)));
});
deck.addEventListener("pointerup", e => {
  if (ctl) { ctl = null; return; }
  if (platter.owner === "pointer") { scratchRelease("pointer"); return; }
  if (!grab) return; const g = grab; grab = null; dragging = false;
  if (!g.moved) return;                     // 톤암을 움직이지 않은 클릭은 무시
  armReleased();                            // LP 위에 올리면 재생, 내리면 정지
});
deck.addEventListener("pointercancel", () => {
  if (ctl) ctl = null;
  scratchRelease("pointer");
});
const startButton = document.getElementById("startstop");
startButton.style.pointerEvents = "auto";
startButton.addEventListener("pointerdown", event => {
  startButton.classList.add("pressed"); setTimeout(() => startButton.classList.remove("pressed"), 120);
  event.preventDefault();
  event.stopPropagation();
  unlockAudio();
  togglePlay();
});

const exitButton = document.getElementById("exitDJ");
function exitDJ() {
  if (exitButton.disabled) return;
  exitButton.disabled = true;
  cancelScratch();
  fxSource = null;
  setFlanger(.5, .5, false);
  audio.pause();
  const activeVideo = document.getElementById("video");
  if (activeVideo.srcObject) activeVideo.srcObject.getTracks().forEach(track => track.stop());
  document.getElementById("stage").style.opacity = "0";
  setTimeout(() => window.location.reload(), 260);
}
exitButton.addEventListener("click", exitDJ);

/* ===== 낮 / 밤 전환: 화면 아래 가운데를 축으로 세계가 180° 회전(동화책처럼, 살짝 튕기는 반동) ===== */
const world = document.getElementById("world");
const stageFace = document.getElementById("stage");
const themeToggle = document.getElementById("themeToggle");
let themeTurning = false, ghostCam = null;
function applyTheme(theme) {
  stageFace.dataset.theme = theme;
  document.documentElement.classList.toggle("theme-day", theme === "day");
  try { localStorage.setItem("theDJHouse.theme", theme); } catch (error) {}
}
try { const saved = localStorage.getItem("theDJHouse.theme"); if (saved === "day" || saved === "night") applyTheme(saved); } catch (error) {}
function toggleTheme() {
  if (themeTurning) return;
  const next = stageFace.dataset.theme === "day" ? "night" : "day";
  themeTurning = true;
  themeToggle.classList.add("pressed"); setTimeout(() => themeToggle.classList.remove("pressed"), 140);
  if (platter.touching) scratchRelease(platter.owner);
  if (fxSource) releaseFlanger(fxSource);
  // 반대편 면: 지금 화면을 복제해 다음 테마로 칠하고, 축을 기준으로 180° 뒤집어 아래쪽에 붙인다
  const ghost = stageFace.cloneNode(true);
  ghost.removeAttribute("id"); ghost.classList.add("ghost"); ghost.dataset.theme = next; ghost.style.opacity = "1";
  // id는 그대로 둔다(CSS 배치가 id 기준). 스크립트는 처음에 잡아 둔 실제 요소만 쓰므로 복제본과 섞이지 않는다.
  const camCanvas = ghost.querySelector("#fisheye");
  if (camCanvas) {
    const c2 = document.createElement("canvas"); c2.width = out.width; c2.height = out.height; c2.style.cssText = "width:100%;height:100%;display:block";
    camCanvas.replaceWith(c2); ghostCam = c2.getContext("2d");
  }
  world.appendChild(ghost);
  world.classList.add("turning");
  handLayer.style.visibility = "hidden";
  const finish = () => {
    applyTheme(next);
    world.style.transform = "";
    ghost.remove(); ghostCam = null;
    world.classList.remove("turning");
    handLayer.style.visibility = "";
    themeTurning = false;
  };
  if (world.animate) {
    const anim = world.animate([
      { transform:"rotate(0deg)" },
      { transform:"rotate(196deg)", offset:.72 },      // 살짝 지나쳤다가
      { transform:"rotate(176deg)", offset:.88 },      // 되돌아오며 튕기는 반동
      { transform:"rotate(180deg)" }
    ], { duration:1700, easing:"cubic-bezier(.55,0,.35,1)", fill:"forwards" });
    anim.onfinish = () => { finish(); anim.cancel(); };
  } else finish();
}
themeToggle.addEventListener("click", toggleTheme);

/* ===== 여백 손 효과 (effects/ 폴더). 주소 뒤에 ?lab 을 붙이면 실험 패널이 뜬다 ===== */
const fxLab = createFxLab({
  stage:stageFace, deck, cam:document.getElementById("cam"), buttons:[exitButton, themeToggle],
  AC, master, getTheme:() => stageFace.dataset.theme
});

// 손으로 나가기 / 해·달 누르기: 엄지와 검지를 붙이는 순간(pinch) 버튼 위에 있으면 실행
const screenButtons = [
  { el:exitButton, run:exitDJ },
  { el:themeToggle, run:toggleTheme }
];
const screenButtonPrev = { left:false, right:false };
let hoveredScreenButtons = new Set();
function updateHandScreenButtons(screenPoints, role, key) {
  if (themeTurning) { screenButtonPrev[key] = !!role.touching; return false; }
  const p = screenPoints ? { x:(screenPoints[4].x + screenPoints[8].x) / 2, y:(screenPoints[4].y + screenPoints[8].y) / 2 } : null;
  let hit = null;
  if (p) for (const b of screenButtons) {
    const r = b.el.getBoundingClientRect();
    if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) { hit = b; break; }
  }
  if (hit) hoveredScreenButtons.add(hit.el);
  const touching = !!(p && role.touching);
  // 버튼 위에서 엄지·검지 끝이 "새로" 맞닿는 순간에만 실행(이미 붙인 채 지나가면 실행 안 함)
  if (hit && touching && !screenButtonPrev[key]) { unlockAudio(); hit.run(); }
  screenButtonPrev[key] = touching;
  return !!hit;
}

/* ================= 2. 양손 트래킹 → 덱 좌표 ================= */
function handDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function smoothRole(role, landmarks) {
  const amount = .43;
  if (!role.smooth) role.smooth = landmarks.map(p => ({x:p.x,y:p.y,z:p.z}));
  else for (let i = 0; i < landmarks.length; i++) {
    role.smooth[i].x += (landmarks[i].x - role.smooth[i].x) * amount;
    role.smooth[i].y += (landmarks[i].y - role.smooth[i].y) * amount;
    role.smooth[i].z += (landmarks[i].z - role.smooth[i].z) * amount;
  }
  role.lostFrames = 0;
  const scale = Math.max(handDistance(role.smooth[0], role.smooth[9]), .001);
  const ratio = handDistance(role.smooth[4], role.smooth[8]) / scale;
  if (!role.pinching && ratio < .38) role.pinching = true;
  if (role.pinching && ratio > .52) role.pinching = false;
  // 나가기·해/달은 손가락 끝이 정확히 맞닿았을 때만(더 엄격한 기준)
  if (!role.touching && ratio < .2) role.touching = true;
  if (role.touching && ratio > .32) role.touching = false;
}
function loseRole(role) {
  role.lostFrames++;
  if (role.lostFrames > 7) { role.smooth = null; role.pinching = false; role.playPressed = false; }
}
function assignHands(result) {
  const detected = (result?.landmarks || []).map(landmarks => ({landmarks, screenX:1 - landmarks[0].x}));
  detected.sort((a,b) => a.screenX - b.screenX);
  let left = null, right = null;
  if (detected.length >= 2) { left = detected[0].landmarks; right = detected[detected.length - 1].landmarks; }
  else if (detected.length === 1) {
    if (detected[0].screenX < .5) left = detected[0].landmarks;
    else right = detected[0].landmarks;
  }
  left ? smoothRole(leftHand, left) : loseRole(leftHand);
  right ? smoothRole(rightHand, right) : loseRole(rightHand);
}
function screenHandPoints(role) {
  if (!role.smooth) return null;
  return role.smooth.map(p => ({
    x:Math.max(-.06, Math.min(1.06, 1 - p.x)) * window.innerWidth,
    y:Math.max(-.06, Math.min(1.06, p.y)) * window.innerHeight
  }));
}
function screenPointToDeck(p) {
  const r = deck.getBoundingClientRect();
  return { x:(p.x - r.left) / r.width * DW, y:(p.y - r.top) / r.height * DH };
}
function screenPointsToDeck(points) {
  return points ? points.map(screenPointToDeck) : null;
}
function deckPointToScreen(p) {
  const r = deck.getBoundingClientRect();
  return { x:r.left + p.x / DW * r.width, y:r.top + p.y / DH * r.height };
}
function drawDigitalHand(ctx, points, color, active, contactTips=[]) {
  if (!points) return;
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 1.45; ctx.strokeStyle = color;
  for (const [a,b] of HAND_CONNECTIONS) {
    ctx.beginPath(); ctx.moveTo(points[a].x, points[a].y); ctx.lineTo(points[b].x, points[b].y); ctx.stroke();
  }
  for (let i = 0; i < points.length; i++) {
    const tip = HAND_TIPS.includes(i), contact = contactTips.includes(i);
    ctx.beginPath(); ctx.arc(points[i].x, points[i].y, contact ? 4.2 : tip ? 2.8 : 1.7, 0, Math.PI * 2);
    ctx.fillStyle = contact ? ACTIVE_COLOR : color; ctx.fill();
  }
  if (active) {
    const p = {x:(points[4].x + points[8].x)/2, y:(points[4].y + points[8].y)/2};
    ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.strokeStyle = ACTIVE_COLOR; ctx.lineWidth = 1.5; ctx.stroke();
  }
}
function drawHandTargets(ctx) {
  const r = deck.getBoundingClientRect(), scale = r.width / DW;
  ctx.font = "9px Courier New"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const fxC = deckPointToScreen({x:FX_PAD.cx,y:FX_PAD.cy});
  const fxA = deckPointToScreen({x:FX_PAD.cx - FX_PAD.rx,y:FX_PAD.cy - FX_PAD.ry});
  const fxB = deckPointToScreen({x:FX_PAD.cx + FX_PAD.rx,y:FX_PAD.cy + FX_PAD.ry});
  ctx.strokeStyle = fxActive && fxSource === "hand" ? RING_ACTIVE : RIGHT_HAND_COLOR;
  ctx.globalAlpha = fxActive && fxSource === "hand" ? .95 : fxHandHover ? .7 : .12;
  ctx.lineWidth = fxActive && fxSource === "hand" ? 2 : 1;
  ctx.beginPath(); ctx.ellipse(fxC.x,fxC.y,(fxB.x-fxA.x)/2,(fxB.y-fxA.y)/2,0,0,Math.PI*2); ctx.stroke();
  for (const target of handTargets) {
    const c = target.c, active = handControl?.target === target, hover = hoveredHandControl === target;
    const center = deckPointToScreen({x:c.cx,y:c.cy});
    ctx.strokeStyle = active ? RING_ACTIVE : RIGHT_HAND_COLOR;
    ctx.fillStyle = active ? RING_ACTIVE : RIGHT_HAND_COLOR;
    ctx.globalAlpha = active ? 1 : hover ? .9 : .16;
    if (target.kind === "knob") {
      ctx.beginPath(); ctx.arc(center.x, center.y, Math.max(12,c.w*.62*scale), 0, Math.PI*2); ctx.lineWidth = active ? 2 : 1; ctx.stroke();
    } else if (target.kind === "horizontal") {
      const a=deckPointToScreen({x:c.xl,y:c.cy}), b=deckPointToScreen({x:c.xr,y:c.cy});
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineWidth=active?2:1; ctx.stroke();
      ctx.strokeRect(center.x-c.w*scale/2,center.y-c.h*scale/2,c.w*scale,c.h*scale);
    } else {
      const a=deckPointToScreen({x:c.cx,y:c.ytop}), b=deckPointToScreen({x:c.cx,y:c.ybot});
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineWidth=active?2:1; ctx.stroke();
      ctx.strokeRect(center.x-c.w*scale/2,center.y-c.h*scale/2,c.w*scale,c.h*scale);
    }
  }
  for (const target of ACTION_TARGETS) {
    const a = deckPointToScreen({x:target.x1,y:target.y1});
    const b = deckPointToScreen({x:target.x2,y:target.y2});
    const active = handActionLatch === target.id;
    const hover = hoveredHandAction === target;
    ctx.globalAlpha = active ? 1 : hover ? .82 : .13;
    ctx.strokeStyle = active ? RING_ACTIVE : RIGHT_HAND_COLOR;
    ctx.fillStyle = active ? RING_ACTIVE : RIGHT_HAND_COLOR;
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
  }
  // 조작 가이드에는 글자를 쓰지 않는다(덱에 이미 이름이 적혀 있음)
  const playA=deckPointToScreen({x:PLAY_BUTTON.x1,y:PLAY_BUTTON.y1}), playB=deckPointToScreen({x:PLAY_BUTTON.x2,y:PLAY_BUTTON.y2});
  ctx.globalAlpha=.42; ctx.strokeStyle=LEFT_HAND_COLOR; ctx.lineWidth=1;
  ctx.strokeRect(playA.x-3,playA.y-3,playB.x-playA.x+6,playB.y-playA.y+6);
  ctx.globalAlpha = 1;
}
function drawHandOverlay() {
  const leftScreen = screenHandPoints(leftHand);
  const rightScreen = screenHandPoints(rightHand);
  const leftPoints = screenPointsToDeck(leftScreen);
  const rightPoints = screenPointsToDeck(rightScreen);
  ({ left:LEFT_HAND_COLOR, right:RIGHT_HAND_COLOR } = handTheme());
  hoveredScreenButtons = new Set();
  updateHandScreenButtons(leftScreen, leftHand, "left");
  updateHandScreenButtons(rightScreen, rightHand, "right");
  for (const b of screenButtons) b.el.classList.toggle("handHover", hoveredScreenButtons.has(b.el)); // 손이 닿으면 색이 바뀜
  fxLab.frame({ hands:[{ id:"left", pts:leftScreen, pinching:leftHand.pinching }, { id:"right", pts:rightScreen, pinching:rightHand.pinching }], turning:themeTurning });
  updateHandPlay(leftPoints,leftHand);
  updateHandPlay(rightPoints,rightHand);
  const movingArm = updateHandArm(leftPoints);
  if (!movingArm) updateHandScratch(leftPoints);
  else scratchRelease("hand");
  const movingFX = updateHandFX(rightPoints);
  if (movingFX) {
    updateHandActions(null);
    hoveredHandControl = null;
    handControl = null;
  } else {
    const movingAction = updateHandActions(rightPoints);
    if (movingAction) {
      hoveredHandControl = null;
      handControl = null;
    } else {
      updateHandControls(rightPoints);
    }
  }

  handCtx.setTransform(1,0,0,1,0,0); handCtx.clearRect(0,0,handLayer.width,handLayer.height);
  const ratio = window.devicePixelRatio || 1;
  handCtx.setTransform(ratio,0,0,ratio,0,0);
  if (leftScreen || rightScreen) drawHandTargets(handCtx); // 손이 보일 때만 조작 가이드 표시(평소엔 시안 그대로)
  const contacts = leftPoints ? SCRATCH_TIPS.filter(i => onLP(leftPoints[i])) : [];
  drawDigitalHand(handCtx,leftScreen,LEFT_HAND_COLOR,handArmGrab || platter.owner === "hand",contacts);
  drawDigitalHand(handCtx,rightScreen,RIGHT_HAND_COLOR,rightHand.pinching);

  leftHandState.textContent = leftPoints ? (handArmGrab ? "LEFT HAND · TONEARM" : platter.owner === "hand" ? "LEFT HAND · SCRATCHING" : "LEFT HAND · TRACKED") : "LEFT HAND · SEARCHING";
  rightHandState.textContent = rightPoints ? (fxSource === "hand" ? "RIGHT HAND · FLANGER" : handActionLatch ? `RIGHT HAND · ${hoveredHandAction?.label || "BUTTON"}` : handControl ? `RIGHT HAND · ${handControl.target.label}` : fxHandHover ? "RIGHT HAND · PINCH FOR FLANGER" : hoveredHandAction ? `RIGHT HAND · ${hoveredHandAction.label}` : "RIGHT HAND · TRACKED") : "RIGHT HAND · SEARCHING";
}

if (/[?&]djtest\b/.test(location.search)) { // 자동 테스트 전용 훅 (일반 실행에는 영향 없음)
  window.DJ_TEST = { audio, AC, hotCues, platter, fx, master, flangerParams, assignHands, drawHandOverlay, scratchVoiceState,
    get scratchVoice() { return scratchVoice; }, get playing() { return playing; }, get spin() { return spin; }, deckPointToScreen, startPlay, prepareScratch,
    fxLab, toggleTheme, get themeTurning() { return themeTurning; }, get angle() { return angle; }, REST, PLAY_START, firstSound:() => firstSoundTime,
    spaceSend:spaceSend.gain, pan:panNode.pan, highGain:highEQ.gain, gains:{ dry:dryGain.gain, wet:flangerWet.gain, send:flangerSend.gain, fb:flangerFeedback.gain } };
}

/* ================= 3. 웹캠 + 피쉬아이 + 헤드폰 ================= */
const video = document.getElementById("video");
const out = document.getElementById("fisheye");
const SRC = document.createElement("canvas"); SRC.width = 960; SRC.height = 960;   // 정사각 합성 캔버스
const sctx = SRC.getContext("2d");
const hp = new Image(); hp.src = "assets/headphones2.png?v=20261020d";
const gl = out.getContext("webgl", { premultipliedAlpha: false });
const out2d = gl ? null : out.getContext("2d");
const vs = `attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const fs = `precision highp float;varying vec2 uv;uniform sampler2D t;
void main(){vec2 c=uv*2.-1.;float r=length(c);if(r>1.){gl_FragColor=vec4(0.,0.,0.,1.);return;}
 // 볼록렌즈(배럴) 피쉬아이: 중앙은 크게 확대, 가장자리는 압축
 float a=1.15;float src=tan(r*a)/tan(a);
 vec2 d=r>0.?c/r*src:vec2(0.);vec2 u=d*.5+.5;u.y=1.-u.y;gl_FragColor=texture2D(t,u);}`;
let tex = null;
if (gl) {
  const sh = (type,s) => { const o=gl.createShader(type); gl.shaderSource(o,s); gl.compileShader(o); return o; };
  const prog=gl.createProgram(); gl.attachShader(prog,sh(gl.VERTEX_SHADER,vs)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(prog,"p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex);
  [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER].forEach(f=>gl.texParameteri(gl.TEXTURE_2D,f,gl.LINEAR));
  [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T].forEach(f=>gl.texParameteri(gl.TEXTURE_2D,f,gl.CLAMP_TO_EDGE));
}
function fit() { const s = Math.round(out.clientWidth * devicePixelRatio) || 800; out.width = out.height = s; if (gl) gl.viewport(0, 0, s, s); }
fit(); addEventListener("resize", fit);

let landmarker = null, face = null; // face = 부드럽게 보정된 {x,y,w,roll}
try {
  const { FaceLandmarker, HandLandmarker, FilesetResolver } = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs");
  const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", delegate: "GPU" },
      runningMode: "VIDEO", numFaces: 1 });
  } catch (e) {
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", delegate: "CPU" },
      runningMode: "VIDEO", numFaces: 1 });
  }
  try {
    handLandmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" },
      runningMode: "VIDEO", numHands: 2, minHandDetectionConfidence:.55, minHandPresenceConfidence:.55, minTrackingConfidence:.55 });
  } catch (e) {
    handLandmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "CPU" },
      runningMode: "VIDEO", numHands: 2, minHandDetectionConfidence:.55, minHandPresenceConfidence:.55, minTrackingConfidence:.55 });
  }
} catch (e) { console.warn("MediaPipe 로드 실패 (헤드폰 추적 없이 피쉬아이만 동작):", e); }

const stream = navigator.mediaDevices?.getUserMedia
  ? await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" }, audio: false }).catch(e => { console.error("카메라 권한 필요", e); return null; })
  : null;
if (stream) { video.srcObject = stream; await video.play(); }

const lerp = (a, b, k) => a + (b - a) * k;
let lastTrackingTime = 0;
let trackingFrame = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!stream || video.readyState < 2) { drawHandOverlay(); return; }
  const vw = video.videoWidth, vh = video.videoHeight, side = Math.min(vw, vh), sx = (vw - side) / 2, sy = (vh - side) / 2, S = SRC.width / side;
  // 거울 모드 + 정사각 크롭
  sctx.save(); sctx.setTransform(-1, 0, 0, 1, SRC.width, 0); sctx.drawImage(video, sx, sy, side, side, 0, 0, SRC.width, SRC.height); sctx.restore();
  if (now - lastTrackingTime > 38) {
    lastTrackingTime = now;
    trackingFrame++;
    if (landmarker && trackingFrame % 2 === 0) {
      const r = landmarker.detectForVideo(video, now);
      if (r.faceLandmarks && r.faceLandmarks[0]) {
        const L = r.faceLandmarks[0], P = i => ({ x: SRC.width - ((L[i].x * vw - sx) * S), y: (L[i].y * vh - sy) * S });
        const a = P(234), b = P(454), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const left = a.x < b.x ? a : b, right = a.x < b.x ? b : a;
        const cur = { x: m.x, y: m.y, w: Math.hypot(b.x - a.x, b.y - a.y), roll: Math.atan2(right.y - left.y, right.x - left.x) };
        face = face ? { x: lerp(face.x, cur.x, .5), y: lerp(face.y, cur.y, .5), w: lerp(face.w, cur.w, .4), roll: lerp(face.roll, cur.roll, .5) } : cur;
      } else face = null;
    }
    if (handLandmarker) assignHands(handLandmarker.detectForVideo(video, now));
  }
  if (face && hp.complete) {
    // 이어컵 안쪽 가장자리(간격 327px)를 얼굴 외곽(234↔454)에 맞춰, 컵이 얼굴 바깥에 오도록 배치
    const scale = face.w * 1.03 / 327;
    sctx.save(); sctx.translate(face.x, face.y); sctx.rotate(face.roll); sctx.scale(scale, scale);
    sctx.drawImage(hp, -375.5, -506); sctx.restore();  // 컵 중심(375.5, 506)이 귀 높이
  }
  if (gl) {
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, SRC);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (ghostCam) ghostCam.drawImage(out, 0, 0, ghostCam.canvas.width, ghostCam.canvas.height); // 전환 중 반대편 면에도 카메라
  } else if (out2d) {
    out2d.clearRect(0,0,out.width,out.height);
    out2d.drawImage(SRC,0,0,out.width,out.height);
  }
  drawHandOverlay();
}
requestAnimationFrame(frame);
