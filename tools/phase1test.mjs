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

// ---- TUTORIAL ----
await page.evaluate(()=>{ try{localStorage.removeItem('nv.trained');}catch(e){} document.getElementById('start').click(); });
await wait(2500);
console.log('tut visible:', await page.evaluate(()=>document.getElementById('tut').classList.contains('on')),
            '| step:', await page.evaluate(()=>window.G.tut.step),
            '| title:', await page.evaluate(()=>document.querySelector('#tut .ttitle')?.textContent));
await page.screenshot({path:'p1-tutorial.png'});
// complete step 1 (movement)
await page.evaluate(()=>{ window.G.tut.travel = 20; });
await wait(1500);
const st2 = await page.evaluate(()=>({step:window.G.tut.step, title:document.querySelector('#tut .ttitle')?.textContent, dummies:window.G.enemies.filter(e=>e.dummy).length}));
console.log('after move step:', JSON.stringify(st2));
// kill the dummies
await page.evaluate(()=>{ for(const e of window.G.enemies) e.die(window.G, window.G.active); });
await wait(1600);
console.log('after fire step:', await page.evaluate(()=>document.querySelector('#tut .ttitle')?.textContent));
// skip the rest
await page.keyboard.press('k'); await wait(900);
console.log('skipped, tut active:', await page.evaluate(()=>window.G.tut.active), '| trained flag:', await page.evaluate(()=>localStorage.getItem('nv.trained')));

// ---- HIT-STOP ----
await page.evaluate(()=>{ window.G.waveTimer=0.15; });
await wait(3500);
const hs = await page.evaluate(()=>{ const G=window.G; const e=G.enemies.find(x=>!x.dead); if(!e) return 'no enemy';
  G.hitStop=0; G.damageEnemy(e, 300, G.active.pos, {source:G.active}); return +G.hitStop.toFixed(3); });
console.log('hit-stop on 300 dmg:', hs);

// ---- OCCLUSION FADE ----
const occ = await page.evaluate(async ()=>{ const G=window.G;
  // park a hero directly behind a pylon relative to the camera
  const o=G.world.obstacles[0];
  const cam=G.camera.position;
  const dir={x:o.x-cam.x, z:o.z-cam.z};
  const l=Math.hypot(dir.x,dir.z);
  G.active.pos.set(o.x+dir.x/l*4, 0, o.z+dir.z/l*4);
  await new Promise(r=>setTimeout(r,1200));
  return { fade:+((o.fade??1).toFixed(2)), others:G.world.obstacles.slice(1,4).map(x=>+((x.fade??1).toFixed(2))) };
});
console.log('occlusion:', JSON.stringify(occ));
await page.screenshot({path:'p1-occlusion.png'});

// ---- LYRA DRONE LOCK ----
const lyra = await page.evaluate(async ()=>{ const G=window.G;
  G.heroes[0].hp = 100;                       // wound Aegis
  const idx=G.heroes.findIndex(h=>h.def.id==='lyra');
  G.switchTo ? G.switchTo(idx) : null;
  return idx;
});
await page.evaluate(()=>{ const G=window.G; const l=G.heroes.find(h=>h.def.id==='lyra'); G.active.controlled=false; l.controlled=true; G.active=l; });
const lock = await page.evaluate(async ()=>{ const G=window.G, a=G.heroes[0];
  a.hp=100; const hp0=a.hp;
  G.aimPoint.set(a.pos.x, 0, a.pos.z);        // aim at the wounded tank
  await new Promise(r=>setTimeout(r,1500));
  return { locked: !!G.active.droneLock, healed: +(a.hp-hp0).toFixed(1), shield: Math.round(a.shield||0) };
});
console.log('lyra drone lock:', JSON.stringify(lock));

// ---- BALANCE ----
console.log('balance:', await page.evaluate(()=>JSON.stringify({
  bastionCd: window.G.heroes[0].def.skills[1].cd,
  comboWindow: 2.5,
})));
console.log('ERRORS', errs.length? errs.join('\n'):'none');
await browser.close();
