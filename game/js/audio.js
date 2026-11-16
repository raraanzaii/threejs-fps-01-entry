// EMBERLINE — audio.js: every sound is synthesized with WebAudio — short
// oscillator blips and filtered noise bursts. No audio files, no network.
// The context is created lazily on the first user gesture; before that (and in
// ?shot= mode, where there is no gesture) every call is a silent no-op.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise(dur, freq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    shot(kind) {
      if (kind === 'rifle') { noise(0.09, 2400, 0.5); tone(150, 0.08, 0.4, 'square', 60); }
      else if (kind === 'smg') { noise(0.06, 3200, 0.38); tone(190, 0.05, 0.3, 'square', 80); }
      else { noise(0.08, 2000, 0.42); tone(120, 0.07, 0.35, 'square', 55); }
    },
    distantShot() { noise(0.12, 900, 0.12); },
    reload() { tone(900, 0.05, 0.16, 'square'); setTimeout(() => tone(650, 0.05, 0.16, 'square'), 160); },
    dryClick() { tone(1400, 0.03, 0.12, 'square'); },
    hit(headshot) { tone(headshot ? 2100 : 1500, 0.05, 0.2, 'sine'); },
    kill() { tone(520, 0.12, 0.22, 'sine', 780); },
    hurt() { tone(220, 0.14, 0.25, 'sawtooth', 120); },
    beep(final) { tone(final ? 1500 : 950, final ? 0.16 : 0.09, 0.22, 'sine'); },
    plant() { tone(700, 0.1, 0.2, 'sine'); setTimeout(() => tone(1050, 0.14, 0.2, 'sine'), 120); },
    explosion() { noise(0.9, 500, 0.9); tone(70, 0.8, 0.6, 'sine', 30); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.18, 'triangle'), i * 110)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.2, 0.16, 'triangle'), i * 130)); },
    step() { noise(0.04, 500, 0.05); },
  };
}
