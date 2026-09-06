import puppeteer from 'puppeteer';
import path from 'path';
const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--mute-audio'] });
const p = await b.newPage(); await p.setViewport({width:1280,height:800});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error'){const t=m.text(); if(!/Driver|Context|WebGL/.test(t)) errs.push(t.slice(0,150));}});
await p.goto('file://'+path.resolve('neon-vanguard.html')+'?shot=1',{waitUntil:'load'});
await p.evaluate(()=>{ try{localStorage.setItem('nv.trained','1');}catch(e){} document.getElementById('start').click(); });
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(1500);
// clear wave 1 instantly
await p.evaluate(()=>{ const G=window.G; G.waveTimer=0.1; });
await wait(2500);
await p.evaluate(()=>{ const G=window.G; G.spawnQueue.length=0; for(const e of G.enemies) e.die(G,G.active); });
await wait(4000);
const d = await p.evaluate(()=>({ drafting:window.G.drafting, cards:[...document.querySelectorAll('.dcard .dname')].map(e=>e.textContent) }));
console.log('draft open:', JSON.stringify(d));
await p.screenshot({path:'d1-draft.png'});
// pick card 1 and verify mods changed
const before = await p.evaluate(()=>JSON.stringify(window.G.mods));
await p.keyboard.press('1'); await wait(1200);
const after = await p.evaluate(()=>({ mods:window.G.mods, taken:window.G.taken, drafting:window.G.drafting,
  chips:[...document.querySelectorAll('.bchip')].map(e=>e.textContent.trim()) }));
const bm=JSON.parse(before);
const changed = Object.keys(after.mods).filter(k=>after.mods[k]!==bm[k]).map(k=>k+': '+bm[k]+'->'+after.mods[k]);
console.log('picked ->', JSON.stringify(after.taken), '| changed:', changed.join(', ')||'NONE', '| chips:', after.chips.join(' / '));
console.log('sim resumed:', !after.drafting);
// verify a stacked pick and the skip path
await p.evaluate(()=>{ const G=window.G; G.waveActive=false; G.waveTimer=0.05; });
await wait(3000);
await p.evaluate(()=>{ const G=window.G; G.spawnQueue.length=0; for(const e of G.enemies) e.die(G,G.active); });
await wait(4500);
console.log('second draft:', await p.evaluate(()=>window.G.drafting));
await p.keyboard.press('Escape'); await wait(800);
console.log('after skip -> drafting:', await p.evaluate(()=>window.G.drafting), 'score:', await p.evaluate(()=>window.G.score));
console.log('ERRORS', errs.length?errs.join('; '):'none');
await b.close();
