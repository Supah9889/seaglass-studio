import {describe,expect,it} from 'vitest';
import {HistoryManager,HISTORY_MAX_BYTES} from './history';
import {StrokeTileRecorder} from './pixelHistoryTiles';
import {captureLayerStructure,renameLayer} from './layers';
import type {DocumentModel,Layer} from './document';

function pixelCanvas(width:number,height:number){
 const pixels=new Uint8ClampedArray(width*height*4);
 const ctx={
  getImageData:(x:number,y:number,w:number,h:number)=>{const data=new Uint8ClampedArray(w*h*4);for(let row=0;row<h;row++)data.set(pixels.subarray(((y+row)*width+x)*4,((y+row)*width+x+w)*4),row*w*4);return {data,width:w,height:h} as ImageData;},
  putImageData:(image:ImageData,x:number,y:number)=>{for(let row=0;row<image.height;row++)pixels.set(image.data.subarray(row*image.width*4,(row+1)*image.width*4),((y+row)*width+x)*4);},
 };
 return {canvas:{width,height,getContext:()=>ctx} as unknown as HTMLCanvasElement,pixels};
}

function fixture(width=300,height=300){
 const surface=pixelCanvas(width,height);
 for(let i=0;i<surface.pixels.length;i++)surface.pixels[i]=(i*13)&255;
 const layer={id:'layer-a',name:'Layer A',visible:true,locked:false,opacity:1,canvas:surface.canvas} as unknown as Layer;
 const doc:DocumentModel={width,height,layers:[layer],activeId:layer.id,groups:[]};
 return {doc,layer,pixels:surface.pixels,history:new HistoryManager()};
}

/** Simulate a sparse stroke: capture, write, finish, push. */
function stroke(f:ReturnType<typeof fixture>,x:number,y:number,value:number){
 const recorder=new StrokeTileRecorder(f.layer.id,f.layer.canvas);
 recorder.touch({x0:x-2,y0:y-2,x1:x+3,y1:y+3});
 for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)f.pixels.fill(value,((y+dy)*f.doc.width+(x+dx))*4,((y+dy)*f.doc.width+(x+dx))*4+4);
 const entry=recorder.finish();
 if(entry)f.history.pushTiles(entry,f.doc);
 return entry;
}

describe('sparse stroke entries in history',()=>{
 it('undoes and redoes consecutive strokes exactly and in order',()=>{
  const f=fixture(),original=f.pixels.slice();
  stroke(f,20,20,200);const afterFirst=f.pixels.slice();
  stroke(f,280,280,90);const afterSecond=f.pixels.slice();
  expect(f.history.undo(f.doc)).toBe(true);expect(f.pixels).toEqual(afterFirst);
  expect(f.history.undo(f.doc)).toBe(true);expect(f.pixels).toEqual(original);
  expect(f.history.redo(f.doc)).toBe(true);expect(f.pixels).toEqual(afterFirst);
  expect(f.history.redo(f.doc)).toBe(true);expect(f.pixels).toEqual(afterSecond);
 });

 it('stores only the changed tiles and counts them in history memory',()=>{
  const f=fixture(600,600);
  stroke(f,10,10,1);
  expect(f.history.pixelBytes).toBe(256*256*4);
 });

 it('interleaves with layer metadata entries',()=>{
  const f=fixture(),original=f.pixels.slice();
  stroke(f,40,40,5);
  const before=captureLayerStructure(f.doc);renameLayer(f.doc,f.layer.id,'Renamed');f.history.pushLayerState(before,f.doc);
  stroke(f,60,60,9);
  f.history.undo(f.doc);f.history.undo(f.doc);
  expect(f.layer.name).toBe('Layer A');
  f.history.undo(f.doc);
  expect(f.pixels).toEqual(original);
  f.history.redo(f.doc);f.history.redo(f.doc);
  expect(f.layer.name).toBe('Renamed');
 });

 it('skips a stroke whose layer is no longer in the document and undoes the entry before it',()=>{
  const f=fixture();
  const before=captureLayerStructure(f.doc);renameLayer(f.doc,f.layer.id,'Renamed');f.history.pushLayerState(before,f.doc);
  stroke(f,30,30,7);
  const detached=f.doc.layers;f.doc.layers=[];
  expect(f.history.undo(f.doc)).toBe(true); // drops the orphaned stroke, then undoes the rename
  f.doc.layers=detached;
  expect(f.history.redoCount).toBe(1);
  expect(f.history.undoCount).toBe(0);
 });

 it('trims tile entries under the shared byte budget',()=>{
  const f=fixture();
  const huge={kind:'tiles' as const,layerId:f.layer.id,tiles:[{x:0,y:0,width:1,height:1,data:{data:new Uint8ClampedArray(4),width:1,height:1} as unknown as ImageData}]};
  // A tile entry whose declared size exceeds the budget is trimmed like an oversized snapshot.
  huge.tiles[0].width=HISTORY_MAX_BYTES;huge.tiles[0].height=1;
  f.history.pushTiles(huge,f.doc);
  expect(f.history.undoCount).toBe(0);
 });
});
