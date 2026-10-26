/* 덱 좌표계: 1736 × 647 (디자인 시안에서 덱(집 모양) 영역 기준)
   knob  : x,y = 그래픽 중심, 드래그로 회전
   pitch/vf : 세로 페이더 (x = 레일, y = 캡 기본 위치, ytop~ybot = 캡 중심이 움직일 수 있는 범위)
   hf : 가로 페이더 (x = 캡 기본 위치, xl~xr = 캡 중심이 움직일 수 있는 범위)
   페이더 범위는 "레일 끝 − 캡 크기"로 정해서 캡이 레일 밖으로 나가거나 라벨을 가리지 않는다.
   레일: TEMPO·VOLUME y 427.75~584.75, R / L x 1088.75~1232.5 */
export const CONTROLS = [
  { id:"ctlHigh",   kind:"knob",  fn:"high",   label:"HIGH",   x:802.9,  y:152.6, w:76, h:76, v0:0.5 },
  { id:"ctlMid",    kind:"knob",  fn:"mid",    label:"MIDDLE", x:987.8,  y:152.6, w:76, h:76, v0:0.5 },
  { id:"ctlLow",    kind:"knob",  fn:"low",    label:"LOW",    x:1160.6, y:152.6, w:76, h:76, v0:0.5 },
  { id:"ctlFilter", kind:"knob",  fn:"filter", label:"FILTER", x:803,    y:319.1, w:78, h:78, v0:0.5 },
  { id:"ctlEcho",   kind:"knob",  fn:"echo",   label:"ECHO",   x:987.8,  y:320.6, w:82, h:82, v0:0 },
  { id:"ctlSpace",  kind:"knob",  fn:"space",  label:"SPACE",  x:1160.75,y:318.75,w:78, h:78, v0:0.5 },
  { id:"ctlPitch",  kind:"pitch", fn:"pitch",  label:"TEMPO",  x:803.1,  y:506.25, w:66, h:72, ytop:462.75, ybot:549.75 },
  { id:"ctlVol",    kind:"vf",    fn:"vol",    label:"VOLUME", x:987.75, y:506.5,  w:72, h:40, ytop:446.45, ybot:566.25 },
  { id:"ctlPan",    kind:"hf",    fn:"pan",    label:"R / L",  x:1160.6, y:506.4,  w:66, h:60, xl:1121.25, xr:1200 }
];
