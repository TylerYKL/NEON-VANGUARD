import puppeteer from 'puppeteer';
import path from 'path';
const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--mute-audio'] });
const p = await b.newPage(); await p.setViewport({width:1400,height:900});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error'){const t=m.text(); if(!/Driver|Context|WebGL|clipboard/.test(t)) errs.push(t.slice(0,150));}});
await p.goto('file://'+path.resolve('neon-vanguard.html')+'?shot=1',{waitUntil:'load'});
await p.evaluate(()=>{ try{localStorage.setItem('nv.trained','1'); localStorage.removeItem('nv.balance.session');}catch(e){} document.getElementById('start').click(); });
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(2000);
await p.keyboard.press('`'); await wait(600);
console.log('overlay open:', await p.evaluate(()=>!document.getElementById('dev').classList.contains('hidden')));
console.log('tabs:', await p.evaluate(()=>[...document.querySelectorAll('.dvtab')].map(t=>t.textContent).join(',')));
console.log('rows in combat tab:', await p.evaluate(()=>document.querySelectorAll('#dvbody .dvrow').length));
await p.screenshot({path:'dev1.png'});
// live-edit a value and confirm it reaches gameplay
const edit = await p.evaluate(()=>{
  const el=[...document.querySelectorAll('#dvbody input[type=range]')].find(e=>e.dataset.p==='combat.critChance');
  el.value='0.9'; el.oninput();
  return { balance: window.G ? null : null };
});
console.log('critChance now:', await p.evaluate(()=>document.querySelector('[data-p="combat.critChance"]').value));
// enemy tab -> change skitter hp and verify ENEMY_TYPES updated via a fresh spawn
await p.evaluate(()=>{ [...document.querySelectorAll('.dvtab')].find(t=>t.dataset.g==='enemies').click(); });
await wait(400);
await p.evaluate(()=>{
  const el=[...document.querySelectorAll('#dvbody input[type=range]')].find(e=>e.dataset.p==='enemies.skitter.hp');
  el.value='500'; el.oninput();
});
await p.evaluate(()=>{ const G=window.G; G.waveTimer=0.1; });
await wait(4000);
console.log('new skitter maxHp:', await p.evaluate(()=>{ const e=window.G.enemies.find(x=>x.type==='skitter'); return e? Math.round(e.maxHp):'none'; }));
// actions
await p.evaluate(()=>{ document.querySelector('[data-a="charge"]').click(); });
console.log('full charge:', await p.evaluate(()=>window.G.heroes.map(h=>Math.round(h.energy)).join('/')));
await p.evaluate(()=>{ document.querySelector('[data-a="god"]').click(); });
await p.evaluate(()=>{ const h=window.G.active; h.hp=100; h.takeDamage(999,{x:0,y:0,z:0}); });
console.log('god mode blocks damage:', await p.evaluate(()=>window.G.active.hp===100), '| label:', await p.evaluate(()=>document.getElementById('dvgod').textContent));
await p.evaluate(()=>{ document.querySelector('[data-a="boss"]').click(); });
await wait(1200);
console.log('boss spawned:', await p.evaluate(()=>window.G.enemies.some(e=>e.T.boss)));
// export + reset
const json = await p.evaluate(()=>{ document.querySelector('[data-a="export"]').click(); return document.getElementById('dvio').value.length; });
console.log('exported JSON chars:', json);
await p.evaluate(()=>{ document.querySelector('[data-a="reset"]').click(); });
console.log('after reset critChance:', await p.evaluate(()=>{ [...document.querySelectorAll('.dvtab')].find(t=>t.dataset.g==='combat').click(); return document.querySelector('[data-p="combat.critChance"]').value; }));
await p.screenshot({path:'dev2.png'});
console.log('ERRORS', errs.length?errs.join('; '):'none');
await b.close();
