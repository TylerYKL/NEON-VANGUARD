/* ============================================================
   AUDIO — procedural WebAudio with optional editor-assigned clips.
   · a small synth toolkit (tone / noise / sweep / chord)
   · ~30 gameplay SFX built from those primitives
   · optional OGG/WAV/MP3 cues decoded through the same WebAudio bus
   · an adaptive synthwave sequencer that layers up with the wave
   ============================================================ */

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);

class AudioEngine {
  constructor() {
    this.ready = false;
    this.muted = false;
    this.masterVol = 0.85;
    this.musicVol = 0.5;
    this.sfxVol = 0.9;
    this.lastPlay = Object.create(null);
    this.clipCache = new Map();
    this.clipLoading = new Map();
    this.lastClipPlay = Object.create(null);
    this.intensity = 0;
    this.playing = false;
  }

  /* ---------- setup (must run inside a user gesture) ---------- */
  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = this.masterVol;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -11;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 10;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.16;

    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxVol;
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0;
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);

    // --- reverb send (procedural impulse response) ---
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(2.1, 2.6);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.34;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);
    this.send = ctx.createGain(); this.send.gain.value = 1;
    this.send.connect(this.verb);

    // --- ping-pong-ish delay send (synthwave glue) ---
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = 60 / 124 * 0.75; // dotted 8th @124bpm
    this.fb = ctx.createGain(); this.fb.gain.value = 0.36;
    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = 'highpass'; this.delayFilter.frequency.value = 420;
    this.delayOut = ctx.createGain(); this.delayOut.gain.value = 0.4;
    this.delay.connect(this.delayFilter);
    this.delayFilter.connect(this.fb);
    this.fb.connect(this.delay);
    this.delay.connect(this.delayOut);
    this.delayOut.connect(this.master);
    this.echo = ctx.createGain(); this.echo.gain.value = 1;
    this.echo.connect(this.delay);

    this.noiseBuf = this._noise(2);
    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  /* External editor samples are additive: a missing, blocked, or still-loading
     clip is simply silent and the procedural cue continues to work. OGG/WAV/MP3
     are decoded by the same WebAudio context as the synth, so the editor and
     match share one playback path. */
  async preloadClip(url) {
    if (!this.ready || !url || this.clipCache.has(url)) return this.clipCache.get(url) || null;
    if (this.clipLoading.has(url)) return this.clipLoading.get(url);
    const pending = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`audio ${r.status}`);
      return r.arrayBuffer();
    }).then((data) => this.ctx.decodeAudioData(data)).then((buffer) => {
      this.clipCache.set(url, buffer);
      this.clipLoading.delete(url);
      return buffer;
    }).catch((err) => {
      this.clipLoading.delete(url);
      console.warn('[audio] could not decode external cue', url, err);
      return null;
    });
    this.clipLoading.set(url, pending);
    return pending;
  }

  playClip(url, opt = {}) {
    if (!this.ready || this.muted || !url) return;
    const gap = opt.gap ?? 0.025;
    const now = this.ctx.currentTime;
    if (this.lastClipPlay[url] && now - this.lastClipPlay[url] < gap) return;
    this.lastClipPlay[url] = now;
    const start = (buffer) => {
      if (!buffer || !this.ready || this.muted) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const rate = Number(opt.rate);
      const volume = Number(opt.volume);
      source.playbackRate.value = Math.max(0.25, Math.min(4, Number.isFinite(rate) ? rate : 1));
      const gain = this.ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(2, Number.isFinite(volume) ? volume : 1));
      source.connect(gain);
      this._route(gain, {
        pan: Number(opt.pan) || 0,
        verb: Number(opt.verb) || 0,
        echo: Number(opt.echo) || 0,
      });
      source.start(this.ctx.currentTime + 0.01, Math.max(0, Number(opt.offset) || 0));
    };
    const buffer = this.clipCache.get(url);
    if (buffer) start(buffer);
    else this.preloadClip(url).then(start);
  }

  _noise(sec) {
    const ctx = this.ctx, n = (ctx.sampleRate * sec) | 0;
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _impulse(sec, decay) {
    const ctx = this.ctx, n = (ctx.sampleRate * sec) | 0;
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.2);
      }
    }
    return b;
  }

  /* ---------- primitives ---------- */
  // one oscillator voice with an ADSR-ish envelope and optional filter sweep
  tone(o) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = o.t ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sawtooth';
    const f0 = o.f ?? 440, f1 = o.f2 ?? f0;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) {
      if (o.linear) osc.frequency.linearRampToValueAtTime(Math.max(1, f1), t + (o.sweep ?? o.d ?? 0.2));
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + (o.sweep ?? o.d ?? 0.2));
    }
    if (o.detune) osc.detune.value = o.detune;

    let node = osc;
    if (o.filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = o.filter;
      bq.Q.value = o.q ?? 1;
      const c0 = o.cutoff ?? 1200, c1 = o.cutoff2 ?? c0;
      bq.frequency.setValueAtTime(c0, t);
      if (c1 !== c0) bq.frequency.exponentialRampToValueAtTime(Math.max(20, c1), t + (o.d ?? 0.2));
      node.connect(bq); node = bq;
    }
    const g = ctx.createGain();
    const peak = (o.g ?? 0.3);
    const atk = o.a ?? 0.004, dur = o.d ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    if (o.hold) g.gain.setValueAtTime(peak, t + atk + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + (o.hold ?? 0) + dur);
    node.connect(g);

    this._route(g, o);
    osc.start(t);
    osc.stop(t + atk + (o.hold ?? 0) + dur + 0.05);
    return osc;
  }

  noise(o) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = o.t ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = o.rate ?? 1;
    src.loop = true;
    let node = src;
    if (o.filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = o.filter;
      bq.Q.value = o.q ?? 1;
      const c0 = o.cutoff ?? 2000, c1 = o.cutoff2 ?? c0;
      bq.frequency.setValueAtTime(c0, t);
      if (c1 !== c0) bq.frequency.exponentialRampToValueAtTime(Math.max(20, c1), t + (o.d ?? 0.2));
      node.connect(bq); node = bq;
    }
    const g = ctx.createGain();
    const peak = o.g ?? 0.25, atk = o.a ?? 0.002, dur = o.d ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    if (o.hold) g.gain.setValueAtTime(peak, t + atk + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + (o.hold ?? 0) + dur);
    node.connect(g);
    this._route(g, o);
    src.start(t, Math.random() * 1.5);
    src.stop(t + atk + (o.hold ?? 0) + dur + 0.05);
    return src;
  }

  _route(g, o) {
    const ctx = this.ctx;
    let out = g;
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      g.connect(p); out = p;
    }
    out.connect(o.bus ?? this.sfxBus);
    if (o.verb) { const s = ctx.createGain(); s.gain.value = o.verb; out.connect(s); s.connect(this.send); }
    if (o.echo) { const s = ctx.createGain(); s.gain.value = o.echo; out.connect(s); s.connect(this.echo); }
  }

  /* ---------- per-cue mix levels ----------
     Measured with an offline peak meter, then trimmed by ear-target:
     frequent cues sit low, ultimates own the top of the mix, nothing clips. */
  static LEVELS = {
    hit: 1.9, crit: 1.1, arc: 1.0, chain: 1.8, nanite: 1.0, fist: 1.0, fistHeavy: 0.8,
    slam: 0.77, bigBoom: 0.62, magnetCharge: 1.1, domeUp: 1.0, domeHit: 1.0,
    bloomField: 1.0, tether: 2.3, heal: 1.2, phoenix: 1.4,
    railCharge: 5.0, railFire: 0.71, missile: 2.0, explode: 0.76,
    singularity: 0.84, implode: 0.62,
    enemyShot: 2.2, bruteSlam: 0.76, enemyDie: 1.0, bossDie: 0.7,
    hurt: 1.0, down: 0.9, revive: 1.5, dash: 1.2, swap: 1.15, ultReady: 2.2,
    waveStart: 1.0, bossAlarm: 1.15, waveClear: 1.2, gameOver: 1.0,
    uiClick: 0.4, uiHover: 1.0,
    tell: 1.5, dodge: 1.2, shardGet: 1.0, coreDrop: 1.0, coreGet: 0.9, chainLink: 1.2, overdrive: 0.65,
  };

  /* ---------- SFX library ---------- */
  play(name, opt = {}) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, now = ctx.currentTime;
    // throttle machine-gun repeats of the same cue
    const gap = opt.gap ?? 0.035;
    if (this.lastPlay[name] && now - this.lastPlay[name] < gap) return;
    this.lastPlay[name] = now;
    // 20 ms of lookahead: scheduling into the current render quantum truncates
    // short envelopes (a 0.15 s punch would lose most of its body).
    const t = now + 0.02;
    const pan = opt.pan ?? 0;
    const v = (opt.v ?? 1) * (AudioEngine.LEVELS[name] ?? 1);
    const F = this.SFX[name];
    if (F) F.call(this, t, pan, v);
  }

  get SFX() {
    if (this._sfx) return this._sfx;
    const A = this;
    this._sfx = {
      /* ---- AEGIS ---- */
      fist(t, pan, v) {
        A.noise({ t, filter: 'bandpass', cutoff: 1400, cutoff2: 300, q: 1.2, g: 0.30 * v, d: 0.14, pan });
        A.tone({ t, type: 'triangle', f: 190, f2: 60, d: 0.16, g: 0.34 * v, pan, verb: 0.16 });
        A.tone({ t: t + 0.005, type: 'square', f: 720, f2: 180, d: 0.07, g: 0.1 * v, pan });
      },
      fistHeavy(t, pan, v) {
        A.noise({ t, filter: 'bandpass', cutoff: 2200, cutoff2: 240, q: 0.9, g: 0.42 * v, d: 0.34, pan, verb: 0.3 });
        A.tone({ t, type: 'sine', f: 150, f2: 38, d: 0.42, g: 0.6 * v, pan, verb: 0.35 });
        A.tone({ t, type: 'sawtooth', f: 420, f2: 90, d: 0.22, g: 0.2 * v, filter: 'lowpass', cutoff: 2600, cutoff2: 400, pan });
        A.tone({ t: t + 0.02, type: 'square', f: 1300, f2: 300, d: 0.1, g: 0.08 * v, pan, echo: 0.2 });
      },
      slam(t, pan, v) {
        A.tone({ t, type: 'sine', f: 180, f2: 28, d: 0.85, g: 0.95 * v, verb: 0.45 });
        A.tone({ t, type: 'sawtooth', f: 90, f2: 25, d: 0.6, g: 0.35 * v, filter: 'lowpass', cutoff: 900, cutoff2: 120 });
        A.noise({ t, filter: 'lowpass', cutoff: 5200, cutoff2: 200, g: 0.5 * v, d: 0.7, verb: 0.4 });
        A.noise({ t: t + 0.04, filter: 'highpass', cutoff: 3000, g: 0.16 * v, d: 0.3, echo: 0.25 });
      },
      domeUp(t, pan, v) {
        for (let i = 0; i < 3; i++)
          A.tone({ t: t + i * 0.045, type: 'triangle', f: midi(64 + i * 7), f2: midi(76 + i * 7), sweep: 0.4, d: 0.55, g: 0.16 * v, verb: 0.45, echo: 0.25 });
        A.noise({ t, filter: 'bandpass', cutoff: 500, cutoff2: 6000, q: 3, g: 0.2 * v, d: 0.5, verb: 0.4 });
      },
      domeHit(t, pan, v) {
        A.tone({ t, type: 'sine', f: 900, f2: 1500, d: 0.14, g: 0.14 * v, pan, verb: 0.3 });
        A.noise({ t, filter: 'bandpass', cutoff: 3200, q: 6, g: 0.1 * v, d: 0.12, pan });
      },
      magnetCharge(t, pan, v) {
        A.tone({ t, type: 'sawtooth', f: 55, f2: 320, sweep: 1.1, d: 1.15, g: 0.3 * v, filter: 'lowpass', cutoff: 300, cutoff2: 3600, q: 8, verb: 0.3 });
        A.tone({ t, type: 'square', f: 110, f2: 640, sweep: 1.1, d: 1.15, g: 0.08 * v, echo: 0.3 });
        A.noise({ t, filter: 'bandpass', cutoff: 300, cutoff2: 7000, q: 2, g: 0.16 * v, d: 1.1 });
      },
      bigBoom(t, pan, v) {
        A.tone({ t, type: 'sine', f: 220, f2: 22, d: 1.5, g: 1.0 * v, verb: 0.55 });
        A.tone({ t, type: 'sawtooth', f: 140, f2: 30, d: 0.9, g: 0.4 * v, filter: 'lowpass', cutoff: 1400, cutoff2: 90 });
        A.noise({ t, filter: 'lowpass', cutoff: 7000, cutoff2: 150, g: 0.6 * v, d: 1.3, verb: 0.5 });
        A.noise({ t: t + 0.06, filter: 'highpass', cutoff: 2600, g: 0.2 * v, d: 0.7, echo: 0.3 });
      },

      /* ---- LYRA ---- */
      nanite(t, pan, v) {
        A.tone({ t, type: 'triangle', f: midi(84), f2: midi(91), sweep: 0.09, d: 0.13, g: 0.12 * v, pan, echo: 0.14 });
        A.noise({ t, filter: 'highpass', cutoff: 4200, g: 0.05 * v, d: 0.08, pan });
      },
      heal(t, pan, v) {
        A.tone({ t, type: 'sine', f: midi(76), f2: midi(83), sweep: 0.25, d: 0.4, g: 0.09 * v, verb: 0.4, echo: 0.2 });
      },
      bloomField(t, pan, v) {
        [64, 68, 71, 76].forEach((n, i) =>
          A.tone({ t: t + i * 0.07, type: 'triangle', f: midi(n), d: 1.2, a: 0.06, g: 0.13 * v, verb: 0.55, echo: 0.3 }));
        A.noise({ t, filter: 'bandpass', cutoff: 900, cutoff2: 5000, q: 4, g: 0.12 * v, d: 0.9, verb: 0.5 });
      },
      tether(t, pan, v) {
        A.tone({ t, type: 'sawtooth', f: midi(52), f2: midi(64), sweep: 0.3, d: 0.55, g: 0.12 * v, filter: 'bandpass', cutoff: 700, cutoff2: 2600, q: 7, echo: 0.3 });
        A.tone({ t: t + 0.06, type: 'sine', f: midi(79), d: 0.5, g: 0.08 * v, verb: 0.4 });
      },
      phoenix(t, pan, v) {
        // rising choir-ish stack + impact
        [52, 59, 64, 68, 71, 76].forEach((n, i) => {
          A.tone({ t: t + i * 0.035, type: 'sawtooth', f: midi(n) * 0.5, f2: midi(n), sweep: 0.5, d: 1.9, a: 0.08, g: 0.11 * v, filter: 'lowpass', cutoff: 500, cutoff2: 5200, verb: 0.6, echo: 0.25 });
        });
        A.noise({ t, filter: 'bandpass', cutoff: 400, cutoff2: 8000, q: 1.5, g: 0.24 * v, d: 1.1, verb: 0.6 });
        A.tone({ t: t + 0.5, type: 'sine', f: 120, f2: 40, d: 1.0, g: 0.5 * v, verb: 0.5 });
      },

      /* ---- NYX ---- */
      arc(t, pan, v) {
        A.tone({ t, type: 'sawtooth', f: 1500, f2: 260, sweep: 0.07, d: 0.11, g: 0.18 * v, filter: 'bandpass', cutoff: 2600, q: 3, pan, echo: 0.16 });
        A.noise({ t, filter: 'highpass', cutoff: 3400, g: 0.13 * v, d: 0.06, pan });
        A.tone({ t, type: 'square', f: 90, f2: 55, d: 0.09, g: 0.14 * v, pan });
      },
      chain(t, pan, v) {
        A.noise({ t, filter: 'bandpass', cutoff: 5200, q: 9, g: 0.14 * v, d: 0.15, pan, echo: 0.3 });
        A.tone({ t, type: 'square', f: 2400, f2: 900, d: 0.1, g: 0.05 * v, pan });
      },
      railCharge(t, pan, v) {
        A.tone({ t, type: 'sawtooth', f: 200, f2: 2400, sweep: 0.3, d: 0.32, g: 0.16 * v, filter: 'bandpass', cutoff: 900, cutoff2: 5000, q: 9 });
      },
      railFire(t, pan, v) {
        A.tone({ t, type: 'sawtooth', f: 3000, f2: 120, sweep: 0.35, d: 0.5, g: 0.42 * v, filter: 'lowpass', cutoff: 7000, cutoff2: 700, verb: 0.35, echo: 0.3 });
        A.tone({ t, type: 'sine', f: 260, f2: 42, d: 0.6, g: 0.55 * v, verb: 0.3 });
        A.noise({ t, filter: 'bandpass', cutoff: 6000, cutoff2: 700, q: 1.6, g: 0.4 * v, d: 0.45, verb: 0.4 });
      },
      missile(t, pan, v) {
        A.noise({ t, filter: 'bandpass', cutoff: 700, cutoff2: 3400, q: 2.5, g: 0.10 * v, d: 0.34, pan, echo: 0.15 });
        A.tone({ t, type: 'triangle', f: 320, f2: 900, sweep: 0.3, d: 0.3, g: 0.05 * v, pan });
      },
      explode(t, pan, v) {
        A.noise({ t, filter: 'lowpass', cutoff: 4200, cutoff2: 220, g: 0.3 * v, d: 0.34, pan, verb: 0.3 });
        A.tone({ t, type: 'sine', f: 200, f2: 44, d: 0.32, g: 0.3 * v, pan });
      },
      singularity(t, pan, v) {
        A.tone({ t, type: 'sine', f: 40, f2: 26, d: 3.0, a: 0.3, g: 0.7 * v, verb: 0.5 });
        A.tone({ t, type: 'sawtooth', f: 1800, f2: 90, sweep: 2.6, d: 2.9, g: 0.14 * v, filter: 'lowpass', cutoff: 4000, cutoff2: 300, q: 6, echo: 0.3 });
        A.noise({ t, filter: 'bandpass', cutoff: 240, cutoff2: 2600, q: 3, g: 0.2 * v, d: 2.8, verb: 0.55 });
      },
      implode(t, pan, v) {
        A.tone({ t, type: 'sine', f: 320, f2: 20, d: 1.7, g: 1.0 * v, verb: 0.6 });
        A.noise({ t, filter: 'lowpass', cutoff: 9000, cutoff2: 120, g: 0.65 * v, d: 1.5, verb: 0.55 });
        A.tone({ t, type: 'sawtooth', f: 900, f2: 40, sweep: 0.5, d: 1.0, g: 0.3 * v, filter: 'lowpass', cutoff: 3000, cutoff2: 150, echo: 0.35 });
      },

      /* ---- shared / combat ---- */
      hit(t, pan, v) {
        A.noise({ t, filter: 'bandpass', cutoff: 2600, q: 2.2, g: 0.09 * v, d: 0.06, pan });
        A.tone({ t, type: 'square', f: 420, f2: 160, d: 0.05, g: 0.05 * v, pan });
      },
      crit(t, pan, v) {
        A.tone({ t, type: 'square', f: midi(88), f2: midi(95), sweep: 0.05, d: 0.14, g: 0.13 * v, pan, echo: 0.25 });
        A.noise({ t, filter: 'highpass', cutoff: 5000, g: 0.1 * v, d: 0.09, pan });
      },
      enemyDie(t, pan, v) {
        A.noise({ t, filter: 'lowpass', cutoff: 3200, cutoff2: 180, g: 0.26 * v, d: 0.36, pan, verb: 0.25 });
        A.tone({ t, type: 'sawtooth', f: 260, f2: 40, d: 0.3, g: 0.16 * v, filter: 'lowpass', cutoff: 1800, cutoff2: 200, pan });
      },
      bossDie(t, pan, v) {
        A.tone({ t, type: 'sine', f: 260, f2: 18, d: 2.4, g: 1.0 * v, verb: 0.6 });
        A.noise({ t, filter: 'lowpass', cutoff: 8000, cutoff2: 120, g: 0.7 * v, d: 2.2, verb: 0.6 });
        for (let i = 0; i < 5; i++)
          A.noise({ t: t + 0.12 * i, filter: 'lowpass', cutoff: 3000, cutoff2: 200, g: 0.3 * v, d: 0.4, pan: rnd(-0.7, 0.7) });
      },
      enemyShot(t, pan, v) {
        A.tone({ t, type: 'square', f: 900, f2: 240, sweep: 0.1, d: 0.13, g: 0.09 * v, filter: 'bandpass', cutoff: 1400, q: 3, pan });
      },
      bruteSlam(t, pan, v) {
        A.tone({ t, type: 'sine', f: 140, f2: 34, d: 0.5, g: 0.5 * v, pan, verb: 0.3 });
        A.noise({ t, filter: 'lowpass', cutoff: 2600, cutoff2: 160, g: 0.3 * v, d: 0.42, pan });
      },
      hurt(t, pan, v) {
        A.tone({ t, type: 'sawtooth', f: 180, f2: 70, d: 0.24, g: 0.3 * v, filter: 'lowpass', cutoff: 900, cutoff2: 220 });
        A.noise({ t, filter: 'bandpass', cutoff: 700, q: 1.4, g: 0.16 * v, d: 0.2 });
      },
      down(t, pan, v) {
        [60, 55, 48, 43].forEach((n, i) =>
          A.tone({ t: t + i * 0.09, type: 'sawtooth', f: midi(n), d: 0.4, g: 0.16 * v, filter: 'lowpass', cutoff: 1600, cutoff2: 300, verb: 0.4 }));
        A.tone({ t, type: 'sine', f: 90, f2: 30, d: 0.9, g: 0.45 * v, verb: 0.4 });
      },
      revive(t, pan, v) {
        [48, 55, 60, 67, 72].forEach((n, i) =>
          A.tone({ t: t + i * 0.06, type: 'triangle', f: midi(n), d: 0.5, g: 0.13 * v, verb: 0.5, echo: 0.25 }));
      },
      dash(t, pan, v) {
        A.noise({ t, filter: 'bandpass', cutoff: 3600, cutoff2: 600, q: 1.6, g: 0.2 * v, d: 0.24, pan, echo: 0.15 });
        A.tone({ t, type: 'sine', f: 520, f2: 140, d: 0.18, g: 0.08 * v, pan });
      },
      swap(t, pan, v) {
        A.noise({ t, filter: 'bandpass', cutoff: 6000, cutoff2: 500, q: 2.2, g: 0.22 * v, d: 0.34, verb: 0.35 });
        A.tone({ t, type: 'triangle', f: midi(72), f2: midi(84), sweep: 0.16, d: 0.3, g: 0.14 * v, echo: 0.3 });
        A.tone({ t: t + 0.02, type: 'sine', f: 140, f2: 60, d: 0.22, g: 0.2 * v });
      },
      ultReady(t, pan, v) {
        [72, 76, 79, 84].forEach((n, i) =>
          A.tone({ t: t + i * 0.055, type: 'square', f: midi(n), d: 0.3, g: 0.07 * v, echo: 0.35, verb: 0.35 }));
      },

      /* ---- flow / UI ---- */
      waveStart(t, pan, v) {
        for (let i = 0; i < 2; i++) {
          A.tone({ t: t + i * 0.34, type: 'sawtooth', f: midi(69), f2: midi(76), sweep: 0.18, d: 0.3, g: 0.16 * v, filter: 'bandpass', cutoff: 1400, q: 4, verb: 0.4, echo: 0.3 });
        }
        A.tone({ t, type: 'sine', f: 70, f2: 40, d: 0.8, g: 0.35 * v });
      },
      bossAlarm(t, pan, v) {
        for (let i = 0; i < 4; i++)
          A.tone({ t: t + i * 0.28, type: 'sawtooth', f: midi(58), f2: midi(65), sweep: 0.14, d: 0.26, g: 0.2 * v, filter: 'bandpass', cutoff: 900, q: 5, verb: 0.4 });
        A.tone({ t, type: 'sine', f: 55, f2: 30, d: 1.6, g: 0.5 * v, verb: 0.5 });
      },
      waveClear(t, pan, v) {
        [72, 76, 79, 84, 88].forEach((n, i) =>
          A.tone({ t: t + i * 0.07, type: 'triangle', f: midi(n), d: 0.55, g: 0.13 * v, verb: 0.5, echo: 0.3 }));
      },
      gameOver(t, pan, v) {
        [57, 53, 48, 41].forEach((n, i) =>
          A.tone({ t: t + i * 0.24, type: 'sawtooth', f: midi(n), d: 1.1, g: 0.2 * v, filter: 'lowpass', cutoff: 1400, cutoff2: 200, verb: 0.55 }));
      },
      /* ---- readability cues ---- */
      tell(t, pan, v) {
        // two rising ticks: "something is about to land here"
        A.tone({ t, type: 'square', f: midi(69), d: 0.07, g: 0.05 * v, pan, filter: 'bandpass', cutoff: 1500, q: 4 });
        A.tone({ t: t + 0.09, type: 'square', f: midi(76), d: 0.09, g: 0.06 * v, pan, filter: 'bandpass', cutoff: 2000, q: 4 });
        A.noise({ t, filter: 'highpass', cutoff: 5200, g: 0.03 * v, d: 0.05, pan });
      },
      dodge(t, pan, v) {
        A.noise({ t, filter: 'bandpass', cutoff: 5200, cutoff2: 900, q: 2.4, g: 0.2 * v, d: 0.26, pan, echo: 0.25 });
        A.tone({ t, type: 'triangle', f: midi(88), f2: midi(79), sweep: 0.12, d: 0.2, g: 0.11 * v, pan, verb: 0.3 });
      },

      /* ---- charge cores & ultimate chain ---- */
      shardGet(t, pan, v) {
        A.tone({ t, type: 'triangle', f: midi(81), f2: midi(88), sweep: 0.06, d: 0.16, g: 0.11 * v, pan, echo: 0.2 });
      },
      coreDrop(t, pan, v) {
        A.tone({ t, type: 'sine', f: midi(48), f2: midi(60), sweep: 0.4, d: 0.7, g: 0.22 * v, pan, verb: 0.4 });
        A.noise({ t, filter: 'bandpass', cutoff: 600, cutoff2: 5200, q: 3, g: 0.14 * v, d: 0.6, pan });
      },
      coreGet(t, pan, v) {
        [60, 64, 67, 72, 76, 79, 84].forEach((n, i) =>
          A.tone({ t: t + i * 0.045, type: 'square', f: midi(n), d: 0.4, g: 0.08 * v, echo: 0.4, verb: 0.4 }));
        A.tone({ t, type: 'sine', f: 110, f2: 45, d: 0.8, g: 0.4 * v, verb: 0.4 });
        A.noise({ t, filter: 'bandpass', cutoff: 800, cutoff2: 9000, q: 1.6, g: 0.2 * v, d: 0.8, verb: 0.5 });
      },
      chainLink(t, pan, v) {
        [72, 79, 84].forEach((n, i) =>
          A.tone({ t: t + i * 0.05, type: 'square', f: midi(n), f2: midi(n + 7), sweep: 0.1, d: 0.3, g: 0.1 * v, echo: 0.45, verb: 0.35 }));
        A.noise({ t, filter: 'highpass', cutoff: 5000, g: 0.14 * v, d: 0.25, echo: 0.3 });
      },
      overdrive(t, pan, v) {
        // reverse-riser into a monster impact
        A.tone({ t, type: 'sawtooth', f: 60, f2: 2600, sweep: 1.05, d: 1.1, g: 0.28 * v, filter: 'lowpass', cutoff: 400, cutoff2: 6000, q: 7, verb: 0.4 });
        A.noise({ t, filter: 'bandpass', cutoff: 300, cutoff2: 9000, q: 1.4, g: 0.3 * v, d: 1.1, verb: 0.5 });
        [40, 52, 59, 64].forEach((n, i) =>
          A.tone({ t: t + 1.0, type: 'sawtooth', f: midi(n), d: 2.0, a: 0.01, g: 0.16 * v, filter: 'lowpass', cutoff: 4000, cutoff2: 500, verb: 0.55 }));
        A.tone({ t: t + 1.0, type: 'sine', f: 280, f2: 20, d: 2.2, g: 0.85 * v, verb: 0.6 });
        A.noise({ t: t + 1.0, filter: 'lowpass', cutoff: 9000, cutoff2: 130, g: 0.6 * v, d: 1.9, verb: 0.55 });
      },

      uiHover(t, pan, v) { A.tone({ t, type: 'triangle', f: midi(84), d: 0.06, g: 0.05 * v }); },
      uiClick(t, pan, v) {
        A.tone({ t, type: 'square', f: midi(79), f2: midi(86), sweep: 0.04, d: 0.12, g: 0.1 * v, echo: 0.2 });
        A.noise({ t, filter: 'highpass', cutoff: 4000, g: 0.06 * v, d: 0.05 });
      },
    };
    return this._sfx;
  }

  /* ---------- adaptive music ---------- */
  // 4-bar loop in A minor: Am – F – C – G. Layers switch in with `intensity`.
  startMusic(intensity = 1) {
    if (!this.ready) return;
    this.intensity = intensity;
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.bpm = 124;
    this.nextTime = this.ctx.currentTime + 0.12;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.musicBus.gain.linearRampToValueAtTime(this.musicVol, this.ctx.currentTime + 1.6);
    this._timer = setInterval(() => this._schedule(), 25);
  }

  stopMusic(fade = 1.2) {
    if (!this.ready || !this.playing) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(0.0001, t + fade);
    clearInterval(this._timer);
    this._timer = null;
    this.playing = false;
  }

  setIntensity(i) { this.intensity = Math.max(0, Math.min(4, i)); }

  /** slow the sequencer for bullet-time (the score drags with the world) */
  setTempo(bpm) { this.bpm = bpm; if (this.delay) this.delay.delayTime.setTargetAtTime(60 / bpm * 0.75, this.ctx.currentTime, 0.2); }

  // duck the music under an ultimate
  duck(amount = 0.35, hold = 0.5) {
    if (!this.ready || !this.playing) return;
    const g = this.musicBus.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.musicVol * amount, t + 0.05);
    g.linearRampToValueAtTime(this.musicVol, t + 0.05 + hold);
  }

  _schedule() {
    if (!this.playing) return;
    const spb = 60 / this.bpm, s16 = spb / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this._playStep(this.step, this.nextTime);
      this.step = (this.step + 1) % 64;   // 4 bars of 16 steps
      this.nextTime += s16;
    }
  }

  _playStep(s, t) {
    const I = this.intensity;
    const bus = this.musicBus;
    const bar = (s / 16) | 0, b = s % 16;
    // Am – F – C – G
    const ROOT = [45, 41, 48, 43][bar];
    const ARP = [
      [57, 60, 64, 69], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67],
    ][bar];
    const TRIAD = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [50, 55, 59]][bar];

    /* --- pad (always) --- */
    if (b === 0) {
      TRIAD.forEach((n, i) => {
        this.tone({
          t, type: 'sawtooth', f: midi(n - 12), d: 1.9, a: 0.5, g: 0.05 + I * 0.006,
          detune: (i - 1) * 9, filter: 'lowpass', cutoff: 380 + I * 260, cutoff2: 700 + I * 500,
          bus, verb: 0.5,
        });
      });
    }

    /* --- bass (I>=1) --- */
    if (I >= 1) {
      const pat = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
      if (pat[b]) {
        this.tone({
          t, type: 'sawtooth', f: midi(ROOT - 12), d: 0.22, g: 0.20,
          filter: 'lowpass', cutoff: 260 + I * 90, q: 6, bus,
        });
        this.tone({ t, type: 'square', f: midi(ROOT - 24), d: 0.2, g: 0.09, bus });
      }
    }

    /* --- drums (I>=1) --- */
    if (I >= 1) {
      if (b % 4 === 0) { // kick
        this.tone({ t, type: 'sine', f: 130, f2: 44, d: 0.26, g: 0.5, bus });
        this.noise({ t, filter: 'lowpass', cutoff: 1400, cutoff2: 200, g: 0.08, d: 0.05, bus });
      }
      if (I >= 2 && (b === 4 || b === 12)) { // snare
        this.noise({ t, filter: 'bandpass', cutoff: 1900, q: 1.1, g: 0.20, d: 0.16, bus, verb: 0.28 });
        this.tone({ t, type: 'triangle', f: 190, f2: 130, d: 0.12, g: 0.10, bus });
      }
      if (I >= 2 && b % 2 === 0) { // closed hats
        this.noise({ t, filter: 'highpass', cutoff: 7600, g: b % 4 === 2 ? 0.055 : 0.035, d: 0.035, bus });
      }
      if (I >= 3 && b % 2 === 1) {
        this.noise({ t, filter: 'highpass', cutoff: 9000, g: 0.022, d: 0.025, bus });
      }
      if (I >= 3 && b === 14) { // open hat
        this.noise({ t, filter: 'highpass', cutoff: 6800, g: 0.05, d: 0.22, bus });
      }
    }

    /* --- arpeggio (I>=2) --- */
    if (I >= 2) {
      const seq = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 3, 0, 1, 2, 3];
      const n = ARP[seq[b]] + (I >= 3 ? 12 : 0);
      this.tone({
        t, type: 'square', f: midi(n), d: 0.13, g: 0.055,
        filter: 'bandpass', cutoff: 1500 + I * 400, q: 2.5, bus, echo: 0.5, verb: 0.2,
      });
    }

    /* --- lead motif (I>=4, boss/late waves) --- */
    if (I >= 4) {
      const lead = [null, null, null, null, 69, null, 72, null, 71, null, null, 67, null, 69, null, null];
      const n = lead[b];
      if (n != null) {
        this.tone({
          t, type: 'sawtooth', f: midi(n + (bar === 3 ? 2 : 0)), d: 0.34, g: 0.085,
          filter: 'lowpass', cutoff: 2600, cutoff2: 900, q: 4, bus, echo: 0.55, verb: 0.35,
        });
      }
    }
  }

  /* ---------- master controls ---------- */
  setMuted(m) {
    this.muted = m;
    if (this.ready) this.master.gain.setTargetAtTime(m ? 0 : this.masterVol, this.ctx.currentTime, 0.02);
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }
  setVolume(v) {
    this.masterVol = v;
    if (this.ready && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
}

export const SFX = new AudioEngine();
