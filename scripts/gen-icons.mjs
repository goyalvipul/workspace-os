#!/usr/bin/env node
/**
 * Workspace OS brand icon generator. No third-party or native image dependencies.
 * Rebuilds all favicon, Apple touch and PWA assets from the approved
 * warm-gradient checkbox, leaf and checkmark illustration.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/web/public/icons');
mkdirSync(out, { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Workspace OS app icon">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf8"/><stop offset="1" stop-color="#fff0e6"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffce75"/><stop offset=".46" stop-color="#ff9133"/><stop offset="1" stop-color="#f35b50"/></linearGradient>
    <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc35d"/><stop offset="1" stop-color="#ff761c"/></linearGradient>
    <linearGradient id="check" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#984413"/><stop offset="1" stop-color="#55260f"/></linearGradient>
  </defs>
  <rect x="4" y="4" width="504" height="504" rx="108" fill="url(#tile)"/>
  <path d="M278 148H194c-48 0-68 25-68 73v120c0 55 24 76 72 76h136c53 0 72-25 72-76V218" fill="none" stroke="url(#rim)" stroke-width="45" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M309 192C312 127 360 85 422 86c13 59-30 103-113 106Z" fill="url(#leaf)"/>
  <path d="M205 283l48 44 87-87" fill="none" stroke="url(#check)" stroke-width="43" stroke-linecap="round" stroke-linejoin="round"/>
</svg>\n`;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, bytes) {
  const typeBuf = Buffer.from(type);
  let crc = 0xffffffff;
  for (const b of typeBuf) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  const data = Buffer.alloc(12 + bytes.length);
  data.writeUInt32BE(bytes.length, 0);
  typeBuf.copy(data, 4);
  bytes.copy(data, 8);
  data.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + bytes.length);
  return data;
}
function encodePng(size, rgba) {
  const scan = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    rgba.copy(scan, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(size, 0); hdr.writeUInt32BE(size, 4); hdr[8] = 8; hdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', hdr), chunk('IDAT', deflateSync(scan, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a,b,t) => a + (b-a)*Math.max(0,Math.min(1,t));
const col = (a,b,t) => [0,1,2].map(i => mix(a[i],b[i],t));
const distSeg = (x,y,ax,ay,bx,by) => {
  const dx=bx-ax,dy=by-ay;
  const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(x-ax-t*dx,y-ay-t*dy);
};
const path = [[278,148],[194,148]];
const curve = (a,b,c,d) => {
  for(let i=1;i<=12;i++) {
    const t=i/12,u=1-t;
    path.push([u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]]);
  }
};
curve([194,148],[146,148],[126,173],[126,221]);
path.push([126,341]);
curve([126,341],[126,396],[150,417],[198,417]);
path.push([334,417]);
curve([334,417],[387,417],[406,392],[406,341]);
path.push([406,218]);
const leaf = [];
const leafCurve = (a,b,c,d) => {
  for(let i=0;i<25;i++) {
    const t=i/24,u=1-t;
    leaf.push([u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]]);
  }
};
leafCurve([309,192],[312,127],[360,85],[422,86]);
leafCurve([422,86],[435,145],[392,189],[309,192]);
function inPolygon(x,y,poly) {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const [a,b]=poly[i], [c,d]=poly[j];
    if ((b>y)!==(d>y) && x < (c-a)*(y-b)/(d-b)+a) inside=!inside;
  }
  return inside;
}
function roundedBox(x,y,half=252,radius=108) {
  const ax=Math.abs(x-256)-(half-radius), ay=Math.abs(y-256)-(half-radius);
  return Math.hypot(Math.max(ax,0),Math.max(ay,0))+Math.min(Math.max(ax,ay),0)<=radius;
}
function pointColor(x,y,maskable) {
  // Keep artwork inside Android's central safe zone.
  const scale=maskable?0.73:1;
  const px=(x-256)/scale+256, py=(y-256)/scale+256;
  if (!maskable && !roundedBox(x,y)) return [0,0,0,0];
  let color=col([255,253,248],[255,240,230],(x+y)/1024);
  let d=1e5;
  if (px>90&&px<446&&py>108&&py<455) {
    for(let i=1;i<path.length;i++) d=Math.min(d,distSeg(px,py,...path[i-1],...path[i]));
  }
  if (d<=22.5) {
    const k=(px+py)/1024;
    color=k<0.46?col([255,206,117],[255,145,51],k/0.46):col([255,145,51],[243,91,80],(k-0.46)/0.54);
  }
  if(px>300&&px<440&&py>75&&py<202 && inPolygon(px,py,leaf))
    color=col([255,195,93],[255,118,28],(px+py-380)/200);
  if(px>174&&px<372&&py>207&&py<363 &&
     Math.min(distSeg(px,py,205,283,253,327),distSeg(px,py,253,327,340,240))<=21.5)
    color=col([152,68,19],[85,38,15],(px+py)/1024);
  return [...color,255];
}
function render(size, { maskable = false } = {}) {
  const rgba=Buffer.alloc(size*size*4);
  const S=size<=32?4:size<=192?3:2;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let r=0,g=0,b=0,a=0;
    for(let sy=0;sy<S;sy++)for(let sx=0;sx<S;sx++){
      const c=pointColor((x+(sx+0.5)/S)*512/size,(y+(sy+0.5)/S)*512/size,maskable);
      r+=c[0]*c[3]/255;g+=c[1]*c[3]/255;b+=c[2]*c[3]/255;a+=c[3]/255;
    }
    const coverage=a/(S*S),i=(y*size+x)*4;
    rgba[i]=a?Math.round(r/a):0;
    rgba[i+1]=a?Math.round(g/a):0;
    rgba[i+2]=a?Math.round(b/a):0;
    rgba[i+3]=Math.round(coverage*255);
  }
  return encodePng(size,rgba);
}
for(const [filename,size,maskable] of [
  ['icon-192.png',192,false], ['icon-512.png',512,false],
  ['icon-maskable-512.png',512,true], ['apple-touch-icon.png',180,true],
  ['favicon-32.png',32,false], ['favicon-16.png',16,false],
]) writeFileSync(resolve(out,filename),render(size,{maskable}));
writeFileSync(resolve(out,'icon.svg'),svg);
console.log('Generated Workspace OS branding:', out);
