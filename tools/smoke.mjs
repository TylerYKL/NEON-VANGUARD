import puppeteer from 'puppeteer';
import path from 'path';
const W=1280,H=800;
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader',`--window-size=${W},${H}`] });
const page = await browser.newPage();
await page.setViewport({width:W,height:H});
const errs=[];
page.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
page.on('console', m => { const t=m.text(); if(m.type()==='error' && !/Driver|Context/.test(t)) errs.push('ERR: '+t.slice(0,200)); });
await page.goto('file://'+path.resolve('neon-vanguard.html')+'?shot=1', { waitUntil:'load' });
await new Promise(r=>setTimeout(r,700));
await page.evaluate(()=>document.getElementById('start').click());
await page.evaluate(()=>{ window.G.waveTimer=0.2; });
const wait = ms => new Promise(r=>setTimeout(r,ms));
async function aimAtEnemy(){
  const pt = await page.evaluate(()=>{
    const G=window.G; const e=G.enemies.find(x=>!x.dead); if(!e) return null;
    const v=e.center().project(G.camera);
    return {x:(v.x*0.5+0.5)*innerWidth, y:(-v.y*0.5+0.5)*innerHeight};
  });
  if(pt) await page.mouse.move(pt.x, pt.y);
  return !!pt;
}
await wait(4000);
for(let i=0;i<8;i++){ await aimAtEnemy(); await wait(500); }
await page.mouse.down();
await wait(2000);
await page.screenshot({path:'s1-aegis-basic.png'});
await page.keyboard.press('q'); await wait(280); await page.screenshot({path:'s2-aegis-slam.png'});
await wait(700); await page.keyboard.press('e'); await wait(700); await page.screenshot({path:'s3-aegis-bastion.png'});
await page.evaluate(()=>{ window.G.active.energy=100; });
await page.keyboard.press('r'); await wait(700); await page.screenshot({path:'s4-aegis-ult-pull.png'});
await wait(800); await page.screenshot({path:'s5-aegis-ult-boom.png'});
// nyx
await page.keyboard.press('3'); await wait(600); await aimAtEnemy();
await page.keyboard.press('q'); await wait(420); await page.screenshot({path:'s6-nyx-rail.png'});
await wait(600); await page.keyboard.press('e'); await wait(700); await page.screenshot({path:'s7-nyx-swarm.png'});
await page.evaluate(()=>{ window.G.active.energy=100; });
await aimAtEnemy(); await page.keyboard.press('r'); await wait(1200); await page.screenshot({path:'s8-nyx-singularity.png'});
await wait(2200); await page.screenshot({path:'s9-nyx-implode.png'});
// lyra
await page.keyboard.press('2'); await wait(600); await aimAtEnemy();
await page.keyboard.press('q'); await wait(900); await page.screenshot({path:'s10-lyra-bloom.png'});
await page.keyboard.press('e'); await wait(700); await page.screenshot({path:'s11-lyra-tether.png'});
await page.evaluate(()=>{ window.G.active.energy=100; window.G.heroes[0].hp=40; });
await page.keyboard.press('r'); await wait(600); await page.screenshot({path:'s12-lyra-phoenix.png'});
await page.mouse.up();
// boss
await page.evaluate(()=>{ const G=window.G; G.spawnQueue.length=0; for(const e of G.enemies) e.dead=true; G.waveActive=false; G.waveTimer=0.1; G.wave=4; });
await wait(6000);
await aimAtEnemy(); await page.mouse.down(); await wait(2500);
await page.screenshot({path:'s13-boss.png'});
await page.mouse.up();
console.log('STATE', await page.evaluate(()=>JSON.stringify({fps:+window.G.fps.toFixed(0),wave:window.G.wave,score:window.G.score,enemies:window.G.enemies.length,hp:window.G.heroes.map(h=>Math.round(h.hp))})));
console.log('ERRORS', errs.length? errs.slice(0,20).join('\n'):'none');
await browser.close();
