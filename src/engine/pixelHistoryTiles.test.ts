import {describe,expect,it} from 'vitest';
import {HISTORY_TILE_SIZE,StrokeTileRecorder,segmentBounds,swapTiles,tileBytes} from './pixelHistoryTiles';

/** A pixel-accurate canvas stand-in with getImageData/putImageData and a test-only writer. */
function pixelCanvas(width:number,height:number){
 const pixels=new Uint8ClampedArray(width*height*4);
 let reads=0;
 const ctx={
  getImageData:(x:number,y:number,w:number,h:number)=>{
   reads++;
   const data=new Uint8ClampedArray(w*h*4);
   for(let row=0;row<h;row++)data.set(pixels.subarray(((y+row)*width+x)*4,((y+row)*width+x+w)*4),row*w*4);
   return {data,width:w,height:h} as ImageData;
  },
  putImageData:(image:ImageData,x:number,y:number)=>{
   for(let row=0;row<image.height;row++)pixels.set(image.data.subarray(row*image.width*4,(row+1)*image.width*4),((y+row)*width+x)*4);
  },
 };
 const paint=(x:number,y:number,rgba:[number,number,number,number])=>pixels.set(rgba,(y*width+x)*4);
 const dab=(cx:number,cy:number,r:number,rgba:[number,number,number,number])=>{
  for(let y=Math.max(0,cy-r);y<=Math.min(height-1,cy+r);y++)for(let x=Math.max(0,cx-r);x<=Math.min(width-1,cx+r);x++)paint(x,y,rgba);
 };
 return {canvas:{width,height,getContext:()=>ctx} as unknown as HTMLCanvasElement,pixels,paint,dab,reads:()=>reads};
}

/** Seeded deterministic background so restores are checked against non-trivial bytes. */
function seed(target:ReturnType<typeof pixelCanvas>,salt=7){
 for(let i=0;i<target.pixels.length;i++)target.pixels[i]=(i*salt+(i>>4))&255;
}

describe('sparse stroke history tiles',()=>{
 it('restores the exact bytes of a cross-tile stroke and redoes it exactly',()=>{
  const c=pixelCanvas(700,600);seed(c);
  const before=c.pixels.slice();
  const recorder=new StrokeTileRecorder('layer',c.canvas);
  const points=[{x:200,y:140},{x:260,y:160},{x:300,y:150}];
  for(let i=1;i<points.length;i++){
   recorder.touch(segmentBounds(points[i-1],points[i],20));
   for(let t=0;t<=10;t++){const x=Math.round(points[i-1].x+(points[i].x-points[i-1].x)*t/10),y=Math.round(points[i-1].y+(points[i].y-points[i-1].y)*t/10);c.dab(x,y,10,[10,20,30,255]);}
  }
  const after=c.pixels.slice();
  const entry=recorder.finish()!;
  expect(entry.tiles.length).toBe(2); // the stroke crosses x=256
  const redo=swapTiles(c.canvas,entry.tiles);
  expect(c.pixels).toEqual(before);
  swapTiles(c.canvas,redo);
  expect(c.pixels).toEqual(after);
 });

 it('handles dabs at the document edge and partial edge tiles',()=>{
  const c=pixelCanvas(300,270);seed(c,11);
  const before=c.pixels.slice();
  const recorder=new StrokeTileRecorder('layer',c.canvas);
  recorder.touch(segmentBounds({x:299,y:269},{x:299,y:269},12));
  c.dab(299,269,6,[255,0,0,128]);
  recorder.touch(segmentBounds({x:0,y:0},{x:0,y:0},12));
  c.dab(0,0,6,[0,0,255,0]); // erased alpha
  const entry=recorder.finish()!;
  expect(entry.tiles.map(t=>[t.x,t.y,t.width,t.height]).sort()).toEqual([[0,0,256,256],[256,256,44,14]]);
  swapTiles(c.canvas,entry.tiles);
  expect(c.pixels).toEqual(before);
 });

 it('discards tiles the stroke did not change and returns null for a no-op stroke',()=>{
  const c=pixelCanvas(600,300);seed(c);
  const recorder=new StrokeTileRecorder('layer',c.canvas);
  recorder.touch({x0:0,y0:0,x1:600,y1:300});
  expect(recorder.finish()).toBeNull();
  const second=new StrokeTileRecorder('layer',c.canvas);
  second.touch({x0:0,y0:0,x1:600,y1:300});
  c.paint(10,10,[1,2,3,4]);
  expect(second.finish()!.tiles.map(t=>[t.x,t.y])).toEqual([[0,0]]);
 });

 it('captures each tile once, before the first write',()=>{
  const c=pixelCanvas(512,512);seed(c);
  const original=c.pixels.slice(0,4);
  const recorder=new StrokeTileRecorder('layer',c.canvas);
  recorder.touch({x0:0,y0:0,x1:10,y1:10});
  c.paint(0,0,[9,9,9,9]);
  recorder.touch({x0:0,y0:0,x1:10,y1:10}); // already captured; must keep the original bytes
  const entry=recorder.finish()!;
  swapTiles(c.canvas,entry.tiles);
  expect(c.pixels.slice(0,4)).toEqual(original);
 });

 it('rolls a failed stroke back to the original pixels',()=>{
  const c=pixelCanvas(300,300);seed(c);
  const before=c.pixels.slice();
  const recorder=new StrokeTileRecorder('layer',c.canvas);
  recorder.touch(segmentBounds({x:100,y:100},{x:280,y:280},8));
  c.dab(150,150,4,[0,0,0,255]);c.dab(280,280,4,[0,0,0,255]);
  recorder.rollback();
  expect(c.pixels).toEqual(before);
 });

 it('keeps one small centered stroke on a 4K layer under 2 MiB',()=>{
  // Only size and bookkeeping matter here, so the mock reads zero-filled tiles.
  const width=4096,height=4096,canvas={width,height,getContext:()=>({getImageData:(_x:number,_y:number,w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h})})} as unknown as HTMLCanvasElement;
  const recorder=new StrokeTileRecorder('layer',canvas);
  recorder.touch(segmentBounds({x:2000,y:2040},{x:2090,y:2060},24));
  expect(recorder.capturedBytes).toBeLessThan(2*1024*1024);
  // This stroke sits on the corner where four tiles meet, the worst case for a small stroke.
  expect(recorder.capturedBytes).toBe(HISTORY_TILE_SIZE*HISTORY_TILE_SIZE*4*4);
 });

 it('reports stored bytes for history accounting',()=>{
  expect(tileBytes([{x:0,y:0,width:256,height:256,data:{} as ImageData},{x:256,y:0,width:10,height:20,data:{} as ImageData}])).toBe(256*256*4+10*20*4);
 });
});
