import puppeteer from 'puppeteer';
import path from 'path';
const W=1440,H=900;
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({width:W,height:H});
const errs=[];
page.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
page.on('console', m=>{ if(m.type()==='error'){const t=m.text(); if(!/Driver|Context/.test(t)) errs.push('ERR: '+t.slice(0,200));}});
await page.goto('file://'+path.resolve('character-bay.html')+'?shot=1', {waitUntil:'load'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(2500);
const names=['aegis','lyra','nyx'];
for (let i=0;i<3;i++){
  await page.evaluate((i)=>{ window.BAY.select(i,true); window.BAY.S.spin=false; window.BAY.S.yaw=0.62; window.BAY.S.pitch=0.20; window.BAY.S.dist=7.5; window.BAY.S.targetY=1.78; }, i);
  await wait(2200);
  await page.screenshot({path:`screenshots/bay-${names[i]}.png`});
  // signature move
  await page.evaluate(()=>window.BAY.signature());
  await wait(500);
  await page.screenshot({path:`screenshots/bay-${names[i]}-signature.png`});
  await wait(800);
}
// weapon detail on aegis
await page.evaluate(()=>{ window.BAY.select(0,true); window.BAY.S.detail=true; window.BAY.S.dist=2.7; window.BAY.S.yaw=0.95; window.BAY.S.pitch=0.10; });
await wait(3000);
await page.screenshot({path:'screenshots/bay-weapon-detail.png'});
console.log('ERRORS', errs.length? errs.join('\n'):'none');
await browser.close();
