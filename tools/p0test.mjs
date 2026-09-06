import puppeteer from 'puppeteer';
import path from 'path';
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({width:1280,height:800});
const errs=[];
page.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
page.on('console', m=>{ if(m.type()==='error'){const t=m.text(); if(!/Driver|Context|WebGL/.test(t)) errs.push('ERR: '+t.slice(0,200));}});
await page.goto('file://'+path.resolve('neon-vanguard.html')+'?shot=1', {waitUntil:'load'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// settings persisted?
console.log('settings UI rows:', await page.evaluate(()=>document.querySelectorAll('#opts-menu .set').length));
await page.evaluate(()=>document.getElementById('start').click());
await page.evaluate(()=>{ window.G.waveTimer=0.15; });
await wait(6000);
// telegraphs firing?
console.log('telegraph pool free:', await page.evaluate(()=>window.G.fx.tellPool.length));
console.log('enemies winding up:', await page.evaluate(()=>window.G.enemies.filter(e=>e.windup>0).length));
await page.screenshot({path:'t1-telegraph.png'});
// dash i-frames
const dodge = await page.evaluate(async ()=>{
  const G=window.G, h=G.active; h.dash();
  const hp0=h.hp; h.takeDamage(50, {x:0,y:0,z:0});
  return { iframe:+h.iframe.toFixed(2), blocked: h.hp===hp0, dodges:G.dodges };
});
console.log('dash i-frames:', JSON.stringify(dodge));
// elites at later waves
await page.evaluate(()=>{ const G=window.G; G.wave=9; G.eliteChance=1; for(let i=0;i<6;i++) G.spawnQueue.push('brute'); G.waveActive=true; });
await wait(4000);
const el = await page.evaluate(()=>{ const G=window.G; return { elite:G.enemies.filter(e=>e.elite).map(e=>e.elite), pool:Object.entries(G.enemyPool).map(([k,v])=>k+':'+v.length).join(','), alive:G.enemies.length, hpScale:+G.hpScale.toFixed(2) }; });
console.log('elites:', JSON.stringify(el));
await page.screenshot({path:'t2-elites.png'});
// settings live-apply
const setres = await page.evaluate(()=>{
  const sel=[...document.querySelectorAll('#opts-pause [data-k]')];
  const fx=sel.find(e=>e.dataset.k==='fx'); fx.value='0.5'; fx.onchange();
  const sh=sel.find(e=>e.dataset.k==='shake'); sh.value='0'; sh.onchange();
  const pal=sel.find(e=>e.dataset.k==='palette'); pal.value='cb'; pal.onchange();
  window.G.fx.addShake(1);
  return { pMul:window.G.fx.pMul, shake:+window.G.fx.shake.toFixed(2), bloom:+window.bloomDbg?.strength || null,
           enemyColor:'#'+window.G.enemies[0]?.T.color.toString(16), saved: !!localStorage.getItem('nv.settings') };
});
console.log('settings:', JSON.stringify(setres));
await wait(1200);
await page.screenshot({path:'t3-colourblind.png'});
// game over summary
await page.evaluate(()=>{ const G=window.G; G.score=12345; G.kills=88; G.bestChain=3; for(const h of G.heroes){h.stats.dmg=1000+Math.random()*4000;} G.heroes.forEach(h=>h.down()); });
await wait(1500);
console.log('gameover shown:', await page.evaluate(()=>!document.getElementById('gameover').classList.contains('hidden')));
console.log('best saved:', await page.evaluate(()=>localStorage.getItem('nv.best')));
await page.screenshot({path:'t4-summary.png'});
console.log('ERRORS', errs.length? errs.join('\n'):'none');
await browser.close();
