/**
 * Small procedural phase bus for the reference lab. It intentionally owns no
 * sound files: charge, travel, impact, hold and fade are cheap Web Audio cues,
 * while the legacy studio remains the place for assigning uploaded clips.
 */
export class PhaseAudio {
  constructor(app) {
    this.app = app;
    this.context = null;
    this.charge = null;
    this.tracked = new Map();
    this.previousFrame = app.frame.bind(app);

    app.aim.on('arm', () => this.arm());
    app.aim.on('cancel', () => this.cancel());
    app.aim.on('cast', () => this.stopCharge());
    app.abilities.cast = this.wrapCast(app.abilities.cast.bind(app.abilities));
    app.frame = () => {
      this.previousFrame();
      this.observe();
    };
  }

  wrapCast(cast) {
    return (...args) => {
      const ability = cast(...args);
      if (ability) this.tracked.set(ability, ability.phase);
      this.travel(ability?.element);
      return ability;
    };
  }

  get audio() {
    if (this.context) return this.context;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    this.context = new AudioContext();
    return this.context;
  }

  wake() {
    const audio = this.audio;
    if (!audio) return null;
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }

  tone(frequency, duration, type = 'sine', gain = 0.035, delay = 0) {
    const audio = this.wake();
    if (!audio) return;
    const now = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  noise(duration = 0.16, gain = 0.035) {
    const audio = this.wake();
    if (!audio) return;
    const length = Math.max(1, Math.round(audio.sampleRate * duration));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const envelope = audio.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.7;
    envelope.gain.setValueAtTime(gain, audio.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter).connect(envelope).connect(audio.destination);
    source.start();
  }

  arm() {
    const audio = this.wake();
    if (!audio || this.charge) return;
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(110, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(220, audio.currentTime + 0.45);
    envelope.gain.setValueAtTime(0.0001, audio.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.025, audio.currentTime + 0.08);
    oscillator.connect(envelope).connect(audio.destination);
    oscillator.start();
    this.charge = { oscillator, envelope };
  }

  stopCharge() {
    if (!this.charge) return;
    const audio = this.context;
    const now = audio?.currentTime ?? 0;
    this.charge.envelope.gain.cancelScheduledValues(now);
    this.charge.envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
    this.charge.oscillator.stop(now + 0.04);
    this.charge = null;
  }

  cancel() {
    this.stopCharge();
    this.tone(80, 0.08, 'sine', 0.018);
  }

  travel(element) {
    const frequency = element === 'thunder' || element === 'snare' ? 320 : 180;
    this.tone(frequency, 0.18, 'sawtooth', 0.018);
  }

  impact(element) {
    const frequency = element === 'ice' ? 760 : element === 'meteor' ? 92 : 460;
    this.tone(frequency, 0.22, 'sine', 0.05);
    this.tone(frequency * 1.8, 0.12, 'triangle', 0.022, 0.015);
    this.noise(0.13, 0.028);
  }

  hold(element) {
    this.tone(element === 'beam' ? 520 : 250, 0.34, 'triangle', 0.018);
  }

  fade() {
    this.tone(150, 0.2, 'sine', 0.012);
  }

  observe() {
    for (const ability of this.app.abilities.active) {
      const phase = ability.phase;
      const previous = this.tracked.get(ability);
      if (previous !== phase) {
        if (phase === 'impact') this.impact(ability.element);
        else if (phase === 'fade') this.fade();
        this.tracked.set(ability, phase);
      }
    }
    for (const ability of this.tracked.keys()) {
      if (!this.app.abilities.active.includes(ability)) this.tracked.delete(ability);
    }
  }
}
