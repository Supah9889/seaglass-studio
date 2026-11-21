// SG-08: deterministic scenes and input paths shared by the benchmark runner.
import {deflateSync} from 'node:zlib';
import {strToU8,zipSync} from 'fflate';

const CRC_TABLE=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
function chunk(type,data){
 const out=Buffer.alloc(12+data.length);
 out.writeUInt32BE(data.length,0);out.write(type,4,'ascii');Buffer.from(data).copy(out,8);
 out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);
 return out;
}
/** Minimal RGBA PNG encoder (filter 0 on every row). */
export function encodePng(width,height,rgba){
 const raw=Buffer.alloc((width*4+1)*height);
 for(let y=0;y<height;y++)Buffer.from(rgba.buffer,rgba.byteOffset+y*width*4,width*4).copy(raw,y*(width*4+1)+1);
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:1})),chunk('IEND',Buffer.alloc(0))]);
}

function fillRect(rgba,width,x0,y0,x1,y1,[r,g,b,a]){
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*width+x)*4;rgba[i]=r;rgba[i+1]=g;rgba[i+2]=b;rgba[i+3]=a;}
}
function fillCircle(rgba,width,height,cx,cy,radius,[r,g,b,a]){
 const r2=radius*radius;
 for(let y=Math.max(0,cy-radius);y<Math.min(height,cy+radius);y++)for(let x=Math.max(0,cx-radius);x<Math.min(width,cx+radius);x++){
  if((x-cx)**2+(y-cy)**2>r2)continue;const i=(y*width+x)*4;rgba[i]=r;rgba[i+1]=g;rgba[i+2]=b;rgba[i+3]=a;
 }
}

/**
 * The saveable 4K grouped workload: eight layers with a partially opaque group, hidden
 * layers and clipping. Returns the .seaglass archive bytes.
 */
export function layeredProject(width=3840,height=2160){
 const W=width,H=height,u=Math.round(Math.min(W,H)/12);
 const layers=[
  {id:'paper',name:'Paper',paint:p=>fillRect(p,W,0,0,W,H,[236,248,250,255])},
  {id:'wash',name:'Translucent wash',opacity:.7,paint:p=>fillRect(p,W,u,u,W-u,H-u,[120,200,220,140])},
  {id:'base',name:'Clipping base',groupId:'glass',paint:p=>fillCircle(p,W,H,Math.round(W*.35),Math.round(H*.5),u*3,[40,130,190,255])},
  {id:'child',name:'Clipped highlight',groupId:'glass',clipped:true,opacity:.65,paint:p=>fillRect(p,W,Math.round(W*.25),0,Math.round(W*.45),H,[255,255,255,220])},
  {id:'ink',name:'Ink',groupId:'glass',paint:p=>{for(let i=0;i<12;i++)fillRect(p,W,u+i*u*2,Math.round(H*.8),u+i*u*2+u,Math.round(H*.8)+u/2,[20,40,60,255]);}},
  {id:'hidden-sketch',name:'Hidden sketch',visible:false,paint:p=>fillRect(p,W,0,0,W,Math.round(H/3),[200,60,60,255])},
  {id:'reflections',name:'Reflections',groupId:'hidden-group',paint:p=>fillCircle(p,W,H,Math.round(W*.7),Math.round(H*.4),u*2,[255,255,255,180])},
  {id:'top',name:'Paint here',paint:()=>{}},
 ];
 const groups=[
  {id:'glass',name:'Glass group',visible:true,locked:false,opacity:.6},
  {id:'hidden-group',name:'Hidden group',visible:false,locked:false,opacity:1},
 ];
 const entries={};
 const manifestLayers=layers.map((layer,index)=>{
  const rgba=new Uint8Array(W*H*4);layer.paint(rgba);
  const path=`layers/${index}.png`;entries[path]=encodePng(W,H,rgba);
  return {id:layer.id,name:layer.name,visible:layer.visible??true,locked:false,opacity:layer.opacity??1,alphaLocked:false,clipped:layer.clipped??false,...(layer.groupId?{groupId:layer.groupId}:{}),path};
 });
 entries['manifest.json']=strToU8(JSON.stringify({version:2,width:W,height:H,activeId:'ink',groups,layers:manifestLayers}));
 return zipSync(entries,{level:1});
}

/** A deterministic zigzag across the middle of the canvas, in canvas pixel coordinates. */
export function zigzagPath(width,height,points=40){
 const path=[];
 for(let i=0;i<points;i++){
  const t=i/(points-1);
  path.push({x:Math.round(width*(.2+.6*t)),y:Math.round(height*(.45+(i%2?.06:-.06)))});
 }
 return path;
}
