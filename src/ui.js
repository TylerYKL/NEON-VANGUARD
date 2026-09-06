import { HERO_DEFS } from './heroes.js';

const $ = (s) => document.querySelector(s);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class UI {
  constructor() {
    this.hud = $('#hud');
    this.squadEl = $('#squad');
    this.skillsEl = $('#skills');
    this.feedEl = $('#feed');
    this.popsEl = $('#pops');
    this.cards = [];
    this.skills = [];
    this.pops = [];
    this.popPool = [];
    this.buildRoster();
  }

  buildRoster() {
    const r = $('#roster');
    r.innerHTML = HERO_DEFS.map((d) => `
      <div class="col" style="--c:${hex(d.color)}">
        <h3>${d.name} «${d.tag}»</h3>
        <div class="r">${d.role}</div>
        <p>${d.bio}</p>
        <ul>
          <li><b>KIT</b> ${d.weapon}</li>
          ${d.skills.map((s) => `<li><b>${s.key}</b> ${s.name}</li>`).join('')}
        </ul>
      </div>`).join('');
  }

  buildSquad(heroes) {
    this.squadEl.innerHTML = '';
    this.cards = heroes.map((h, i) => {
      const el = document.createElement('div');
      el.className = 'panel clip card';
      el.style.setProperty('--c', hex(h.def.color));
      el.innerHTML = `
        <div class="badge">${h.def.name[0]}</div>
        <div class="cinfo">
          <div class="cname"><span>${h.def.name}</span><em>${h.def.tag}</em></div>
          <div class="crole">${h.def.role}</div>
          <div class="bar hp"><i></i></div>
          <div class="bar sh hidden"><i></i></div>
          <div class="bar en"><i></i></div>
        </div>
        <div class="keyhint">${i + 1}</div>`;
      this.squadEl.appendChild(el);
      return {
        el, hp: el.querySelector('.hp > i'), shWrap: el.querySelector('.sh'),
        sh: el.querySelector('.sh > i'), en: el.querySelector('.en'), enI: el.querySelector('.en > i'),
      };
    });
  }

  buildSkills(hero) {
    const d = hero.def;
    const glyphs = { aegis: ['✊', '⛨', '⦿'], lyra: ['✿', '⚕', '✦'], nyx: ['⚡', '⁙', '◉'] };
    const items = [
      { kb: 'LMB', name: d.basic.name, glyph: '◈', basic: true },
      ...d.skills.map((s, i) => ({ kb: s.key, name: s.name, glyph: glyphs[d.id][i], ult: s.ult })),
    ];
    this.skillsEl.innerHTML = items.map((s) => `
      <div class="panel clip sk ${s.ult ? 'ult' : ''}" style="--c:${hex(d.color)}">
        <span class="kb">${s.kb}</span>
        <span class="glyph">${s.glyph}</span>
        <span class="lbl">${s.name}</span>
        <span class="cool"></span>
        <span class="cdnum"></span>
      </div>`).join('');
    this.skills = [...this.skillsEl.children].map((el) => ({
      el, cool: el.querySelector('.cool'), num: el.querySelector('.cdnum'),
    }));
  }

  fireSkill(i) {
    const s = this.skills[i + 1];
    if (!s) return;
    s.el.classList.remove('fire');
    void s.el.offsetWidth;
    s.el.classList.add('fire');
  }

  update(G) {
    const A = G.active;
    for (let i = 0; i < this.cards.length; i++) {
      const h = G.heroes[i], c = this.cards[i];
      c.el.classList.toggle('active', h === A);
      c.el.classList.toggle('down', h.downed);
      // teach the chain with the UI: light up whoever can extend the window
      c.el.classList.toggle('chainready',
        G.ultChainT > 0 && h !== A && !h.downed && h.energy >= h.maxEnergy);
      c.hp.style.transform = `scaleX(${Math.max(0, h.hp / h.maxHp)})`;
      const hasSh = h.shield > 0;
      c.shWrap.classList.toggle('hidden', !hasSh);
      if (hasSh) c.sh.style.transform = `scaleX(${h.shield / (h.maxShield || 1)})`;
      c.enI.style.transform = `scaleX(${h.energy / h.maxEnergy})`;
      c.en.classList.toggle('full', h.energy >= h.maxEnergy);
    }
    // skills of active hero
    const items = [{ cd: A.attackCd, max: A.def.basic.cd }, ...A.def.skills.map((s, i) => ({
      cd: s.ult ? (A.energy >= A.maxEnergy ? 0 : 1) : A.cds[i],
      max: s.ult ? 1 : s.cd, ult: s.ult, pct: s.ult ? A.energy / A.maxEnergy : 0,
    }))];
    for (let i = 0; i < this.skills.length; i++) {
      const s = this.skills[i], it = items[i];
      if (it.ult) {
        s.cool.style.transform = `scaleY(${1 - it.pct})`;
        s.num.style.opacity = 0;
        s.el.classList.toggle('charged', it.pct >= 1);
        s.el.classList.toggle('ready', it.pct >= 1);
      } else {
        const k = it.max > 0 ? it.cd / it.max : 0;
        s.cool.style.transform = `scaleY(${Math.max(0, k)})`;
        const show = it.cd > 0.15 && it.max > 1;
        s.num.style.opacity = show ? 0.9 : 0;
        if (show) s.num.textContent = it.cd.toFixed(1);
        s.el.classList.toggle('ready', it.cd <= 0);
      }
    }
    // overdrive meter + ult-chain readout
    const od = $('#v-core');
    if (od) {
      const pct = Math.min(1, G.corePoints / G.coreNeed);
      od.textContent = Math.round(pct * 100) + '%';
      od.parentElement.classList.toggle('hot', pct > 0.85);
    }
    const cross = $('#cross');
    if (cross) cross.classList.toggle('medic', !!(G.active && G.active.droneLock));
    const ch = $('#chain');
    if (ch) {
      const on = G.ultChain > 0 && G.ultChainT > 0;
      ch.classList.toggle('on', on);
      if (on) {
        const names = ['', 'CHAIN WINDOW', 'CHAIN \u00D72  \u00B7  +45% ULT DMG', 'TRINITY OVERDRIVE'];
        ch.innerHTML = `<b>\u26A1 ${names[G.ultChain]}</b><span>${G.ultChainT.toFixed(1)}s \u00B7 swap + ult to chain</span>`;
        ch.style.setProperty('--p', (G.ultChainT / 6.5));
      }
    }
    $('#v-wave').textContent = String(G.wave).padStart(2, '0');
    $('#v-enemies').textContent = G.enemies.filter((e) => !e.dead).length + (G.spawnQueue.length ? '+' + G.spawnQueue.length : '');
    $('#v-score').textContent = G.score.toLocaleString();
    const cb = $('#v-combo');
    cb.textContent = 'x' + G.combo.toFixed(1);
    cb.parentElement.classList.toggle('danger', G.combo >= 3);
    $('#fps').textContent = (G.frameMs ? G.frameMs.toFixed(1) + ' ms · ' + G.fps.toFixed(0) + ' fps' : '—') + ' · ' + G.enemies.length + ' units';
  }

  banner(a, b) {
    $('#b1').textContent = a; $('#b2').textContent = b;
    const el = $('#banner');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  skillCall(text, color) {
    const el = $('#skillcall');
    el.textContent = text;
    el.style.color = color;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  feed(text, color) {
    const d = document.createElement('div');
    d.className = 'fe'; d.style.setProperty('--c', color);
    d.textContent = text;
    this.feedEl.appendChild(d);
    setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 400); }, 2600);
    while (this.feedEl.children.length > 6) this.feedEl.firstChild.remove();
  }

  pop(x, y, text, color, scale) {
    let el = this.popPool.pop();
    if (!el) { el = document.createElement('div'); el.className = 'pop'; }
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = (13 * scale) + 'px';
    el.style.opacity = '1';
    el.style.transform = `translate(${x}px,${y}px)`;
    this.popsEl.appendChild(el);
    this.pops.push({ el, x, y, vy: -46 - Math.random() * 26, vx: (Math.random() - 0.5) * 40, t: 0, life: 0.95 });
  }

  updatePops(dt) {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      p.vy += 105 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.t / p.life;
      p.el.style.transform = `translate(${p.x}px,${p.y}px) scale(${1 + 0.25 * (1 - k)})`;
      p.el.style.opacity = String(Math.max(0, 1 - k * k));
      if (p.t >= p.life) { p.el.remove(); this.popPool.push(p.el); this.pops.splice(i, 1); }
    }
  }

  setCross(x, y, visible) {
    const c = $('#cross');
    c.style.transform = `translate(${x}px,${y}px)`;
    c.style.opacity = visible ? '0.85' : '0';
  }

  show() { this.hud.classList.remove('hidden'); }
}
