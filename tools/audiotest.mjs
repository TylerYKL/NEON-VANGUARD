import puppeteer from 'puppeteer';
import path from 'path';
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({width:1000,height:640});
const errs=[];
page.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
page.on('console', m=>{ if(m.type()==='error'){const t=m.text(); if(!/Driver|Context/.test(t)) errs.push('ERR: '+t.slice(0,200));} });
await page.goto('file://'+path.resolve('..','neon-vanguard','neon-vanguard.html'), { waitUntil:'load' });
await page.evaluate(()=>document.getElementById('start').click());
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(600);
// attach analyser to master bus and measure peak while the game plays
await page.evaluate(()=>{
  const S=window.SFX;
  const an=S.ctx.createAnalyser(); an.fftSize=2048;
  S.master.connect(an);
  window.__an=an; window.__buf=new Uint8Array(an.fftSize); window.__peak=0;
  window.__poll=setInterval(()=>{ an.getByteTimeDomainData(window.__buf);
    let p=0; for(const v of window.__buf){ const d=Math.abs(v-128); if(d>p)p=d; }
    if(p>window.__peak) window.__peak=p; }, 16);
});
await page.evaluate(()=>{ window.G.waveTimer=0.2; });
await wait(3000);
console.log('music peak (0-127):', await page.evaluate(()=>window.__peak));
// fire every SFX cue and count synth voices
const res = await page.evaluate(async ()=>{
  const S=window.SFX; let voices=0;
  const ot=S.tone.bind(S), on=S.noise.bind(S);
  S.tone=(o)=>{voices++; return ot(o);}; S.noise=(o)=>{voices++; return on(o);};
  const names=Object.keys(S.SFX); const out={};
  for(const n of names){ const before=voices; S.lastPlay[n]=0; S.play(n,{gap:0}); out[n]=voices-before; await new Promise(r=>setTimeout(r,40)); }
  return {count:names.length, voices, out, ctx:S.ctx.state, playing:S.playing, intensity:S.intensity};
});
await wait(800);
console.log('ctx', res.ctx, 'music playing', res.playing, 'intensity', res.intensity);
console.log('cues', res.count, 'total voices spawned', res.voices);
const zero = Object.entries(res.out).filter(([k,v])=>v===0).map(([k])=>k);
console.log('silent cues:', zero.length? zero.join(','):'none');
console.log('overall peak after sfx:', await page.evaluate(()=>window.__peak));
console.log('ERRORS', errs.length? errs.join('\n') : 'none');
await browser.close();
