import { spawn, spawnSync } from 'node:child_process';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const renderDir = path.join(here, 'render');
const frameDir = path.join(renderDir, 'frames');
const stillDir = path.join(renderDir, 'screenshots');
const DEBUG_PORT = 9333;
const FPS = Number(process.env.FPS || 30);
const DURATION = 12;
const indexHtml = await readFile(path.join(here,'index.html'),'utf8');
const sceneCss = await readFile(path.join(here,'scene.css'),'utf8');
const sceneJs = await readFile(path.join(here,'scene.js'),'utf8');
const html = indexHtml
  .replace('<link rel="stylesheet" href="scene.css" />', `<style>${sceneCss}</style>`)
  .replace('<script src="scene.js"></script>', `<script>${sceneJs}</script>`);

await mkdir(frameDir, { recursive: true });
await mkdir(stillDir, { recursive: true });
await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });

const chrome = spawn('chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${DEBUG_PORT}`, '--remote-debugging-address=127.0.0.1',
  '--window-size=1920,1080', '--force-device-scale-factor=1', '--disable-dev-shm-usage',
  'about:blank'
], { stdio: ['ignore','ignore','ignore'] });

const sleep = ms => new Promise(r=>setTimeout(r,ms));
let pages;
for (let i=0;i<80;i++) {
  try { const r=await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`); pages=await r.json(); if(pages?.length) break; } catch {}
  await sleep(100);
}
if(!pages?.length) throw new Error('Chromium DevTools endpoint did not start.');
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ ws.onopen=resolve; ws.onerror=reject; });
let seq=0; const pending=new Map();
ws.onmessage = event => { const msg=JSON.parse(event.data); if(msg.id && pending.has(msg.id)){ const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id); msg.error?reject(new Error(msg.error.message)):resolve(msg.result); } };
const send = (method, params={}) => new Promise((resolve,reject)=>{ const id=++seq; pending.set(id,{resolve,reject}); ws.send(JSON.stringify({id,method,params})); });
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false,screenWidth:1920,screenHeight:1080});
await send('Runtime.evaluate',{expression:'window.__NORTHSTAR_CAPTURE__=true'});
const ft=await send('Page.getFrameTree');
await send('Page.setDocumentContent',{frameId:ft.frameTree.frame.id,html});
await sleep(350);

const exists=await send('Runtime.evaluate',{expression:'typeof window.__northstarRender',returnByValue:true});
if(exists.result?.value!=='function') throw new Error('Prototype did not initialise in Chromium.');
async function render(t) { await send('Runtime.evaluate',{expression:`window.__northstarRender(${t.toFixed(6)})`,awaitPromise:true,returnByValue:true}); }
async function shot(file, format='png') { const params={format,fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true}; if(format==='jpeg') params.quality=94; const r=await send('Page.captureScreenshot',params); await writeFile(file, Buffer.from(r.data,'base64')); }

const stills = [
  ['01-close-journey.png',1.95],
  ['02-cascade.png',4.58],
  ['03-maximum-pullout.png',8.72],
  ['04-blast-radius.png',11.22]
];
for(const [name,t] of stills){ await render(t); await shot(path.join(stillDir,name)); }

const total = Math.round(DURATION * FPS);
for(let i=0;i<total;i++){
  const t=i/FPS;
  await render(t);
  await shot(path.join(frameDir,`frame-${String(i).padStart(4,'0')}.jpg`),'jpeg');
  if(i % Math.max(1,FPS*2) === 0) process.stdout.write(`captured ${i}/${total}\n`);
}
ws.close(); chrome.kill('SIGTERM');

const out=path.join(renderDir,'benchmark.mp4');
const ff=spawnSync('ffmpeg',['-y','-loglevel','error','-framerate',String(FPS),'-i',path.join(frameDir,'frame-%04d.jpg'),'-vf','minterpolate=fps=30:mi_mode=blend','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',out],{stdio:'inherit'});
if(ff.status!==0) throw new Error('ffmpeg failed');
console.log(`rendered ${out}`);
