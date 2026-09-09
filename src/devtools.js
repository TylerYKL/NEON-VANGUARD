import { BALANCE, RANGES, resetBalance, exportBalance, importBalance, applyBalance } from './balance.js';

/* ============================================================
   DEV OVERLAY — backtick toggles. Live balance sliders, a perf
   readout and cheats. Hidden unless you open it; not linked
   from any UI, so players never see it.
   ============================================================ */

const LS_KEY = 'nv.balance.session';

export function initDevTools(G, hooks) {
  const root = document.createElement('div');
  root.id = 'dev';
  root.className = 'hidden';
  document.body.appendChild(root);

  // restore a tuning session if one was left open
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { importBalance(raw); hooks.apply(); }
  } catch (e) { /* ignore */ }

  const groups = Object.keys(BALANCE);
  root.innerHTML = `
    <div class="dvhead">
      <b>DEV \u00B7 BALANCE</b>
      <span class="dvperf" id="dvperf"></span>
      <span class="dvx" id="dvclose">\u2715</span>
    </div>
    <div class="dvtabs">${groups.map((g, i) => `<button class="dvtab${i ? '' : ' on'}" data-g="${g}">${g}</button>`).join('')}</div>
    <div class="dvbody" id="dvbody"></div>
    <div class="dvacts">
      <button data-a="wave">skip wave</button>
      <button data-a="boss">spawn boss</button>
      <button data-a="kill">kill all</button>
      <button data-a="draft">force draft</button>
      <button data-a="charge">full charge</button>
      <button data-a="god" id="dvgod">god: off</button>
      <button data-a="slow">slow-mo</button>
    </div>
    <div class="dvacts">
      <button data-a="export">copy JSON</button>
      <button data-a="paste">paste JSON</button>
      <button data-a="reset">reset</button>
      <span class="dvmsg" id="dvmsg"></span>
    </div>
    <textarea id="dvio" spellcheck="false" placeholder="paste balance JSON here, then press paste JSON"></textarea>`;

  const body = root.querySelector('#dvbody');
  const msg = root.querySelector('#dvmsg');

  function fields(group) {
    const g = BALANCE[group];
    let html = '';
    for (const [k, v] of Object.entries(g)) {
      if (typeof v === 'object') {
        html += `<div class="dvsub">${k}</div>`;
        for (const [k2, v2] of Object.entries(v)) html += row(group + '.' + k + '.' + k2, k2, v2);
      } else {
        html += row(group + '.' + k, k, v);
      }
    }
    return html;
  }
  function row(path, label, value) {
    const r = RANGES[label] || [0, Math.max(1, value * 3), value > 4 ? 1 : 0.01];
    return `<label class="dvrow"><span>${label}</span>
      <input type="range" data-p="${path}" min="${r[0]}" max="${r[1]}" step="${r[2]}" value="${value}">
      <input type="number" class="dvnum" data-p="${path}" step="${r[2]}" value="${value}"></label>`;
  }
  function get(path) {
    return path.split('.').reduce((o, k) => o[k], BALANCE);
  }
  function set(path, val) {
    const parts = path.split('.');
    const last = parts.pop();
    parts.reduce((o, k) => o[k], BALANCE)[last] = val;
  }
  function bind() {
    for (const el of body.querySelectorAll('[data-p]')) {
      el.oninput = () => {
        const v = parseFloat(el.value);
        if (Number.isNaN(v)) return;
        set(el.dataset.p, v);
        for (const other of body.querySelectorAll(`[data-p="${el.dataset.p}"]`)) if (other !== el) other.value = v;
        hooks.apply();
        try { localStorage.setItem(LS_KEY, exportBalance()); } catch (e) {}
      };
    }
  }
  function show(group) {
    body.innerHTML = fields(group);
    bind();
  }
  show(groups[0]);

  for (const t of root.querySelectorAll('.dvtab')) {
    t.onclick = () => {
      root.querySelectorAll('.dvtab').forEach((x) => x.classList.toggle('on', x === t));
      show(t.dataset.g);
    };
  }
  root.querySelector('#dvclose').onclick = () => root.classList.add('hidden');

  const io = root.querySelector('#dvio');
  function flash(t) { msg.textContent = t; setTimeout(() => { msg.textContent = ''; }, 1800); }

  for (const b of root.querySelectorAll('.dvacts button')) {
    b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'export') {
        io.value = exportBalance();
        io.select();
        try { navigator.clipboard.writeText(io.value); flash('copied'); } catch (e) { flash('select + copy'); }
      } else if (a === 'paste') {
        try { importBalance(io.value); hooks.apply(); show(root.querySelector('.dvtab.on').dataset.g); flash('applied'); }
        catch (e) { flash('bad JSON'); }
      } else if (a === 'reset') {
        resetBalance(); hooks.apply(); show(root.querySelector('.dvtab.on').dataset.g);
        try { localStorage.removeItem(LS_KEY); } catch (e) {}
        flash('reset to defaults');
      } else if (a === 'god') {
        G.god = !G.god;
        document.getElementById('dvgod').textContent = 'god: ' + (G.god ? 'ON' : 'off');
      } else {
        hooks.action(a);
      }
    };
  }

  addEventListener('keydown', (e) => {
    if (e.key === '`' || e.key === '~' || e.key === 'F2') {
      e.preventDefault();
      root.classList.toggle('hidden');
      if (!root.classList.contains('hidden')) show(root.querySelector('.dvtab.on').dataset.g);
    }
  });

  // perf readout
  const perf = root.querySelector('#dvperf');
  setInterval(() => {
    if (root.classList.contains('hidden')) return;
    const r = hooks.stats();
    perf.textContent = `${r.ms} ms · ${r.fps} fps · ${r.enemies} enemies · ${r.calls} calls · ${r.tris} tris · ${r.lights ?? '-'} lts`;
  }, 400);

  return { root, refresh: () => show(root.querySelector('.dvtab.on').dataset.g) };
}

export const DEV_CSS = `
#dev{position:fixed;right:14px;top:14px;width:390px;max-height:calc(100vh - 28px);overflow:auto;z-index:99;
     background:rgba(4,8,16,.96);border:1px solid rgba(24,224,255,.35);font-size:10px;color:#cff;
     font-family:'Rajdhani','Segoe UI',system-ui,sans-serif;letter-spacing:.06em;padding:0 0 10px}
#dev.hidden{display:none}
#dev .dvhead{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(24,224,255,.2);
             position:sticky;top:0;background:rgba(4,8,16,.99);z-index:2}
#dev .dvhead b{letter-spacing:.22em;color:#18e0ff}
#dev .dvperf{flex:1;font-size:8.5px;opacity:.5;text-align:right}
#dev .dvx{cursor:pointer;opacity:.5;padding:0 3px}
#dev .dvx:hover{opacity:1;color:#fff}
#dev .dvtabs{display:flex;flex-wrap:wrap;gap:3px;padding:8px 10px 4px}
#dev .dvtab{cursor:pointer;font-family:inherit;font-size:8px;letter-spacing:.14em;text-transform:uppercase;
            padding:4px 8px;background:rgba(255,255,255,.05);border:1px solid transparent;color:#9cf}
#dev .dvtab.on{background:#18e0ff;color:#04121c;font-weight:700}
#dev .dvbody{padding:6px 12px 10px}
#dev .dvsub{margin:8px 0 4px;font-size:8px;letter-spacing:.2em;opacity:.45;color:#ffb14a}
#dev .dvrow{display:flex;align-items:center;gap:7px;margin-bottom:4px}
#dev .dvrow>span{flex:0 0 118px;opacity:.62;font-size:9px}
#dev .dvrow input[type=range]{flex:1;height:3px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,.14);outline:none}
#dev .dvrow input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;background:#18e0ff;cursor:pointer}
#dev .dvnum{width:62px;background:rgba(255,255,255,.06);border:1px solid rgba(24,224,255,.2);color:#cff;
            font-family:inherit;font-size:9px;padding:2px 4px}
#dev .dvacts{display:flex;flex-wrap:wrap;gap:4px;padding:6px 12px 0;align-items:center}
#dev .dvacts button{cursor:pointer;font-family:inherit;font-size:8px;letter-spacing:.12em;text-transform:uppercase;
            padding:5px 8px;background:rgba(255,255,255,.06);border:1px solid rgba(24,224,255,.25);color:#9ff}
#dev .dvacts button:hover{background:rgba(24,224,255,.2);color:#fff}
#dev .dvmsg{font-size:8px;opacity:.6;color:#3dffb0}
#dev textarea{width:calc(100% - 24px);margin:8px 12px 0;height:70px;background:rgba(0,0,0,.4);
              border:1px solid rgba(24,224,255,.2);color:#9fd;font-family:ui-monospace,monospace;font-size:9px;padding:6px}
`;
