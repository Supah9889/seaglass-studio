import {afterEach,describe,expect,it,vi} from 'vitest';
import {snapshot,type DocumentModel,type Layer} from './document';
import {HistoryManager} from './history';
import {blendStroke} from './blend';

afterEach(()=>vi.unstubAllGlobals());
function pixelLayer(width:number,height:number){
 const pixels=new Uint8ClampedArray(width*height*4),reads:Array<[number,number,number,number]>=[],writes:Array<[number,number,number,number]>=[];
 const context={getImageData:(x:number,y:number,w:number,h:number)=>{reads.push([x,y,w,h]);const data=new Uint8ClampedArray(w*h*4);for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){const sx=x+xx,sy=y+yy;if(sx>=0&&sy>=0&&sx<width&&sy<height)data.set(pixels.subarray((sy*width+sx)*4,(sy*width+sx)*4+4),(yy*w+xx)*4);}return{data,width:w,height:h} as ImageData;},putImageData:(image:ImageData,x:number,y:number)=>{writes.push([x,y,image.width,image.height]);for(let yy=0;yy<image.height;yy++)for(let xx=0;xx<image.width;xx++){const dx=x+xx,dy=y+yy;if(dx>=0&&dy>=0&&dx<width&&dy<height)pixels.set(image.data.subarray((yy*image.width+xx)*4,(yy*image.width+xx)*4+4),(dy*width+dx)*4);}}};
 return{pixels,reads,writes,layer:{id:'blend',name:'Blend',visible:true,locked:false,opacity:1,canvas:{width,height,getContext:()=>context}} as unknown as Layer};
}
const at=(pixels:Uint8ClampedArray,width:number,x:number,y:number)=>Array.from(pixels.slice((y*width+x)*4,(y*width+x)*4+4));

describe('localized blend engine',()=>{
 it('smudges existing paint in the drag direction',()=>{const f=pixelLayer(6,3);f.pixels.set([255,20,10,255],(1*6+1)*4);f.pixels.set([0,0,255,255],(1*6+2)*4);blendStroke(f.layer,{x:1.5,y:1.5},{x:2.5,y:1.5},4,100,0,'smudge');expect(at(f.pixels,6,2,1)[0]).toBeGreaterThan(200);expect(at(f.pixels,6,2,1)[2]).toBeLessThan(60);});
 it('mixes nearby colors while retaining the center pixel alpha',()=>{const f=pixelLayer(5,3);f.pixels.set([255,0,0,180],(1*5+1)*4);f.pixels.set([0,0,255,90],(1*5+2)*4);blendStroke(f.layer,null,{x:1.5,y:1.5},6,100,0,'blend');const mixed=at(f.pixels,5,1,1);expect(mixed[2]).toBeGreaterThan(0);expect(mixed[3]).toBe(180);});
 it('softens a sharp transition only beneath the brush',()=>{const f=pixelLayer(9,5);f.pixels.set([255,255,255,255],(2*9+4)*4);blendStroke(f.layer,null,{x:4.5,y:2.5},5,100,100,'soften');expect(at(f.pixels,9,4,2)[3]).toBeLessThan(255);expect(at(f.pixels,9,3,2)[3]).toBeGreaterThan(0);expect(at(f.pixels,9,0,0)).toEqual([0,0,0,0]);});
 it('scales effect strength continuously and leaves zero strength unchanged',()=>{const run=(strength:number)=>{const f=pixelLayer(5,3);f.pixels.set([255,0,0,255],(1*5+1)*4);f.pixels.set([0,0,255,255],(1*5+2)*4);blendStroke(f.layer,null,{x:1.5,y:1.5},6,strength,0,'blend');return at(f.pixels,5,1,1);};expect(run(0)).toEqual([255,0,0,255]);expect(run(25)[2]).toBeGreaterThan(0);expect(run(25)[2]).toBeLessThan(run(100)[2]);});
 it('uses alpha-correct blur at transparent edges without a dark color halo',()=>{const f=pixelLayer(4,4);f.pixels.set([240,20,10,255],(1*4+1)*4);blendStroke(f.layer,null,{x:1.5,y:1.5},4,100,100,'soften');const edge=at(f.pixels,4,2,1);expect(edge[3]).toBeGreaterThan(0);expect(edge[0]).toBeGreaterThan(200);expect(edge[1]).toBeLessThan(40);expect(edge[2]).toBeLessThan(30);});
 it('Alpha Lock keeps transparent pixels clear and preserves opaque and partial alpha during blend modes',()=>{const f=pixelLayer(3,1);f.layer.alphaLocked=true;f.pixels.set([255,0,0,255],0);f.pixels.set([0,0,255,128],4);blendStroke(f.layer,null,{x:1.5,y:.5},6,100,100,'soften');expect(at(f.pixels,3,0,0)[3]).toBe(255);expect(at(f.pixels,3,1,0)[3]).toBe(128);expect(at(f.pixels,3,2,0)[3]).toBe(0);});
 it('does not read or write locked or hidden layers',()=>{for(const props of [{locked:true,visible:true},{locked:false,visible:false}]){const f=pixelLayer(8,8);Object.assign(f.layer,props);expect(blendStroke(f.layer,null,{x:4,y:4},6,100,50,'soften')).toBe(0);expect(f.reads).toHaveLength(0);expect(f.writes).toHaveLength(0);}});
 it('records and restores a completed blend stroke as one undoable pixel action',()=>{const f=pixelLayer(5,3),layer=f.layer,doc:DocumentModel={width:5,height:3,layers:[layer],activeId:layer.id},history=new HistoryManager();f.pixels.set([255,0,0,255],(1*5+1)*4);const before=snapshot(doc);blendStroke(layer,null,{x:1.5,y:1.5},6,100,0,'blend');history.pushPixels(before,doc);const changed=at(f.pixels,5,1,1);vi.stubGlobal('crypto',{randomUUID:()=> 'blend-restore'});vi.stubGlobal('document',{createElement:()=>pixelLayer(5,3).layer.canvas});expect(history.undo(doc)).toBe(true);expect(at(doc.layers[0].canvas.getContext('2d')!.getImageData(0,0,5,3).data,5,1,1)).toEqual([255,0,0,255]);expect(history.redo(doc)).toBe(true);expect(at(doc.layers[0].canvas.getContext('2d')!.getImageData(0,0,5,3).data,5,1,1)).toEqual(changed);});
 it('limits each operation to a small brush neighborhood on a 3840×2160 canvas',()=>{const f=pixelLayer(3840,2160);blendStroke(f.layer,{x:1918,y:1080},{x:1920,y:1080},120,70,50,'smudge');expect(f.reads.length).toBeGreaterThan(0);expect(f.reads.every(([, ,w,h])=>w*h<=120_000)).toBe(true);expect(f.reads.every(([, ,w,h])=>w<3840&&h<2160)).toBe(true);});
});

describe('SG-16 long blend segments',()=>{
 it('keeps continuous coverage along a long sparse segment instead of gapping at 64 dabs',()=>{
  const width=1200,f=pixelLayer(width,9);
  for(let x=0;x<width;x++)for(let y=0;y<9;y++)f.pixels.set(x%2?[255,255,255,255]:[0,0,0,255],(y*width+x)*4);
  const steps=blendStroke(f.layer,{x:10,y:4},{x:1110,y:4},8,100,0,'blend');
  expect(steps).toBeGreaterThan(64);
  // Every column the brush passed over was mixed (no untouched black/white stripes).
  let untouched=0;
  for(let x=14;x<1106;x++){const p=at(f.pixels,width,x,4);if(p[0]===0||p[0]===255)untouched++;}
  expect(untouched).toBe(0);
 });

 it('keeps ordinary short segments on their original pacing',()=>{
  const f=pixelLayer(64,9);
  expect(blendStroke(f.layer,{x:4,y:4},{x:40,y:4},8,50,0,'blend')).toBe(Math.ceil(36/Math.max(1,4*.22)));
 });

 it('bounds work for the largest brush on a very long segment',async()=>{
  const {maxBlendSteps}=await import('./blend');
  expect(maxBlendSteps(60)*(121*121)).toBeLessThanOrEqual(4_000_000+121*121);
  expect(maxBlendSteps(0.5)).toBeGreaterThan(64);
 });
});
