// Tiny WebAudio tones for task completion (no audio files shipped). Browsers only allow audio after a user gesture,
// which a tap on the checkbox or a swipe is, so this simply does nothing if the context cannot start.

type Tone = 'off' | 'chime' | 'pop' | 'ding';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const NOTES: Record<Exclude<Tone, 'off'>, { f: number; at: number; dur: number; type: OscillatorType; gain: number }[]> = {
  chime: [{ f: 880, at: 0, dur: 0.16, type: 'sine', gain: 0.12 }, { f: 1319, at: 0.09, dur: 0.28, type: 'sine', gain: 0.1 }],
  pop: [{ f: 520, at: 0, dur: 0.08, type: 'triangle', gain: 0.16 }],
  ding: [{ f: 1047, at: 0, dur: 0.18, type: 'sine', gain: 0.12 }, { f: 1568, at: 0.12, dur: 0.18, type: 'sine', gain: 0.1 }, { f: 2093, at: 0.24, dur: 0.4, type: 'sine', gain: 0.09 }],
};

export function playTone(tone: string | undefined): void {
  if (!tone || tone === 'off' || !(tone in NOTES)) return;
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime;
  for (const n of NOTES[tone as Exclude<Tone, 'off'>]) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = n.type;
    osc.frequency.value = n.f;
    g.gain.setValueAtTime(0.0001, t0 + n.at);
    g.gain.exponentialRampToValueAtTime(n.gain, t0 + n.at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.dur + 0.05);
  }
}
