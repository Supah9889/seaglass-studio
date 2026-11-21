import {describe,expect,it} from 'vitest';
import {analyzeFill,bucketFill,commitFill} from './fill';
import type {Layer} from './document';

/** A canvas mock that honors putImageData's dirty-rectangle arguments, like a real canvas. */
function layerWith(width:number,height:number,paint:(set:(x:number,y:number,rgba:number[])=>void)=>void,extra:Partial<Layer>={}){
 const pixels=new Uint8ClampedArray(width*height*4);
 const set=(x:number,y:number,rgba:number[])=>pixels.set(rgba,(y*width+x)*4);
 paint(set);
 let reads=0,writes:number[][]=[];
 const ctx={
  getImageData:(x:number,y:number,w:number,h:number)=>{reads++;const data=new Uint8ClampedArray(w*h*4);for(let row=0;row<h;row++)data.set(pixels.subarray(((y+row)*width+x)*4,((y+row)*width+x+w)*4),row*w*4);return {data,width:w,height:h} as ImageData;},
  putImageData:(image:ImageData,dx:number,dy:number,sx=0,sy=0,sw=image.width,sh=image.height)=>{
   writes.push([sx,sy,sw,sh]);
   for(let y=sy;y<sy+sh;y++)for(let x=sx;x<sx+sw;x++)pixels.set(image.data.subarray((y*image.width+x)*4,(y*image.width+x)*4+4),((dy+y)*width+dx+x)*4);
  },
 };
 const layer={id:'l',name:'L',visible:true,locked:false,opacity:1,canvas:{width,height,getContext:()=>ctx},...extra} as unknown as Layer;
 return {layer,pixels,reads:()=>reads,writes:()=>writes};
}

/** A ring of opaque ink with antialiased (semi-transparent) inner edge, on transparency. */
function ringScene(set:(x:number,y:number,rgba:number[])=>void){
 for(let y=10;y<30;y++)for(let x=10;x<30;x++){
  const edge=x===10||x===29||y===10||y===29,inner=x===11||x===28||y===11||y===28;
  if(edge)set(x,y,[0,0,0,255]);else if(inner)set(x,y,[0,0,0,120]);
 }
 set(40,5,[200,10,10,255]); // a separate island the fill must not reach
}

describe('single-pass bounded fill',()=>{
 it('writes only the region bounds and matches the full-buffer result exactly',async()=>{
  const bounded=layerWith(64,48,ringScene),reference=layerWith(64,48,ringScene);
  const analysis=await analyzeFill(bounded.layer,20,20,[0,180,200,255],0,{expansion:1,confirmRatio:1});
  expect(analysis.status).toBe('ready');
  if(analysis.status!=='ready')return;
  expect(analysis.plan.bounds).toEqual({x0:11,y0:11,x1:29,y1:29});
  await commitFill(analysis.plan);
  expect(bounded.writes()).toEqual([[11,11,18,18]]);
  // Reference: apply the same plan math to a full-buffer write.
  const full=await analyzeFill(reference.layer,20,20,[0,180,200,255],0,{expansion:1,confirmRatio:1});
  if(full.status!=='ready')throw new Error('reference');
  full.plan.bounds={x0:0,y0:0,x1:64,y1:48};
  await commitFill(full.plan);
  expect(bounded.pixels).toEqual(reference.pixels);
  expect([...bounded.pixels.slice((5*64+40)*4,(5*64+40)*4+4)]).toEqual([200,10,10,255]);
 });

 it('commits a confirmed large fill from its single analysis',async()=>{
  const f=layerWith(32,32,()=>{});
  const analysis=await analyzeFill(f.layer,1,1,[9,9,9,255],0);
  expect(analysis.status==='ready'&&analysis.needsConfirmation).toBe(true);
  const readsAfterAnalysis=f.reads();
  if(analysis.status!=='ready')return;
  const result=await commitFill(analysis.plan);
  expect(result).toMatchObject({status:'filled',pixels:1024});
  expect(f.reads()).toBe(readsAfterAnalysis); // no second read or traversal
  expect([...f.pixels.slice(0,4)]).toEqual([9,9,9,255]);
 });

 it('changes no pixels when a large fill is declined',async()=>{
  const f=layerWith(32,32,()=>{}),before=f.pixels.slice();
  const out=await bucketFill(f.layer,1,1,[9,9,9,255],0);
  expect(out.status).toBe('confirmation-required');
  expect(f.writes()).toEqual([]);
  expect(f.pixels).toEqual(before);
 });

 it('grows its queue past the initial capacity and still enforces the hard limit',async()=>{
  const big=layerWith(400,400,()=>{});
  const filled=await bucketFill(big.layer,0,0,[1,2,3,255],0,{allowLarge:true});
  expect(filled).toMatchObject({status:'filled',pixels:160000});
  const capped=layerWith(400,400,()=>{});
  expect(await bucketFill(capped.layer,0,0,[1,2,3,255],0,{allowLarge:true,maxPixels:100000})).toMatchObject({status:'too-large'});
  expect(capped.writes()).toEqual([]);
 });

 it('keeps transparency under Alpha Lock and refuses a transparent seed',async()=>{
  const f=layerWith(16,16,set=>{for(let x=0;x<8;x++)set(x,0,[50,50,50,128]);},{alphaLocked:true});
  expect((await analyzeFill(f.layer,10,10,[255,0,0,255],0)).status).toBe('unchanged');
  await bucketFill(f.layer,0,0,[255,0,0,255],0,{confirmRatio:1});
  expect([...f.pixels.slice(0,4)]).toEqual([255,0,0,128]);
  expect(f.pixels[(1*16+0)*4+3]).toBe(0);
 });
});
