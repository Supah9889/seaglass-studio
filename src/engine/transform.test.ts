import {afterEach,describe,expect,it,vi} from 'vitest';
import {snapshot,type DocumentModel,type Layer} from './document';
import {HistoryManager} from './history';
import {point} from './paint';
import {canTransformLayer,commitTransform,constrainTransform,flipTransform,hitTestTransformHandle,rasterizeTransform,renderTransformPreview,resizeTransform,rotateTransform,transformFromSelection,transformHandles,transformSelectionPoints,transformedBounds} from './transform';

afterEach(()=>vi.unstubAllGlobals());

function recordingCanvas(width:number,height:number){
  const context={imageSmoothingEnabled:true,imageSmoothingQuality:'low',globalAlpha:1,clearRect:vi.fn(),getImageData:vi.fn((_x:number,_y:number,w:number,h:number)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)} as ImageData)),putImageData:vi.fn(),drawImage:vi.fn(),save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),translate:vi.fn(),rotate:vi.fn(),scale:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),stroke:vi.fn(),fill:vi.fn(),arc:vi.fn(),setLineDash:vi.fn(),strokeRect:vi.fn()};
  return{context,element:{width,height,getContext:()=>context} as unknown as HTMLCanvasElement};
}
function pixelCanvas(width:number,height:number){
  const pixels=new Uint8ClampedArray(width*height*4),context={globalAlpha:1,clearRect:(x:number,y:number,w:number,h:number)=>{for(let py=Math.max(0,y);py<Math.min(height,y+h);py++)for(let px=Math.max(0,x);px<Math.min(width,x+w);px++)pixels.fill(0,(py*width+px)*4,(py*width+px)*4+4);},getImageData:(x:number,y:number,w:number,h:number)=>{const data=new Uint8ClampedArray(w*h*4);for(let py=0;py<h;py++)for(let px=0;px<w;px++){const sx=x+px,sy=y+py;if(sx>=0&&sy>=0&&sx<width&&sy<height)data.set(pixels.subarray((sy*width+sx)*4,(sy*width+sx)*4+4),(py*w+px)*4);}return{data,width:w,height:h} as ImageData;},putImageData:(image:ImageData,x:number,y:number)=>{for(let py=0;py<image.height;py++)for(let px=0;px<image.width;px++){const dx=x+px,dy=y+py;if(dx>=0&&dy>=0&&dx<width&&dy<height)pixels.set(image.data.subarray((py*image.width+px)*4,(py*image.width+px)*4+4),(dy*width+dx)*4);}}};
  return{pixels,element:{width,height,getContext:()=>context} as unknown as HTMLCanvasElement};
}
const base={x:10,y:10,width:20,height:10,rotation:0,flipX:false,flipY:false};

describe('selection transforms',()=>{
  it('enlarges and shrinks corner and side handles',()=>{
    const enlarged=resizeTransform(base,'se',{x:40,y:25},{shift:false,alt:false});expect(enlarged).toMatchObject({x:10,y:10,width:30,height:15});
    const shrunk=resizeTransform(base,'se',{x:15,y:18},{shift:false,alt:false});expect(shrunk.width).toBe(5);expect(shrunk.height).toBe(8);
    const side=resizeTransform(base,'e',{x:40,y:15},{shift:false,alt:false});expect(side).toMatchObject({x:10,y:10,width:30,height:10});
  });

  it('preserves aspect ratio with Shift and keeps the center fixed with Alt',()=>{
    const proportional=resizeTransform(base,'se',{x:40,y:20},{shift:true,alt:false});expect(proportional.width/proportional.height).toBeCloseTo(2);expect(proportional.x).toBe(10);expect(proportional.y).toBe(10);
    const centered=resizeTransform(base,'se',{x:25,y:25},{shift:false,alt:true});expect(centered).toMatchObject({x:15,y:5,width:10,height:20});expect(centered.x+centered.width/2).toBe(20);expect(centered.y+centered.height/2).toBe(15);
    const centeredRatio=resizeTransform(base,'se',{x:30,y:25},{shift:true,alt:true});expect(centeredRatio.width/centeredRatio.height).toBeCloseTo(2);expect(centeredRatio.x+centeredRatio.width/2).toBe(20);expect(centeredRatio.y+centeredRatio.height/2).toBe(15);
  });

  it('rotates around the selection center and snaps to 15 degree increments',()=>{
    const center={x:20,y:15},top={x:20,y:5},diagonal={x:25,y:6.34};
    expect(rotateTransform(base,top,{x:30,y:15},false).rotation).toBe(90);
    expect(rotateTransform(base,top,diagonal,true).rotation).toBe(30);
    expect(transformFromSelection({x:10,y:10,width:20,height:10})).toMatchObject({x:center.x-10,y:center.y-5,rotation:0});
    const bounds=transformedBounds({...base,rotation:90});expect(bounds.x).toBeCloseTo(15);expect(bounds.y).toBeCloseTo(5);expect(bounds.width).toBeCloseTo(10);expect(bounds.height).toBeCloseTo(20);
  });

  it('toggles horizontal and vertical flips independently',()=>{
    const horizontal=flipTransform(base,'horizontal');expect(horizontal.flipX).toBe(true);expect(horizontal.flipY).toBe(false);expect(flipTransform(horizontal,'horizontal').flipX).toBe(false);expect(flipTransform(base,'vertical').flipY).toBe(true);
  });

  it('maps lasso vertices through the same resize, flip, and rotation transform',()=>{
    const region={x:10,y:10,width:20,height:10,points:[{x:10,y:10},{x:30,y:10},{x:20,y:20}]},spec={...transformFromSelection(region),x:20,y:15,width:40,height:20,rotation:90,flipX:true},points=transformSelectionPoints(region,spec);
    expect(points[0].x).toBeCloseTo(50);expect(points[0].y).toBeCloseTo(45);expect(points[1].x).toBeCloseTo(50);expect(points[1].y).toBeCloseTo(5);
  });

  it('keeps transformed bounds inside the document, including near edges and large rotations',()=>{
    const nearEdge=constrainTransform({...base,x:95,y:90,width:20,height:10},100,100),bounds=transformedBounds(nearEdge);expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(100);expect(bounds.y+bounds.height).toBeLessThanOrEqual(100);
    const rotated=constrainTransform({x:0,y:0,width:100,height:100,rotation:45,flipX:false,flipY:false},100,100),fitted=transformedBounds(rotated);expect(fitted.width).toBeLessThanOrEqual(100);expect(fitted.height).toBeLessThanOrEqual(100);expect(rotated.width).toBeLessThan(100);
  });

  it('keeps resize and rotation handles aligned across supported zoom levels',()=>{
    const spec=transformFromSelection({x:12,y:20,width:80,height:40});
    for(const zoom of [.25,.5,1,2,4]){const point=transformHandles(spec,zoom).se;expect(hitTestTransformHandle(spec,{x:point.x+5/zoom,y:point.y},zoom)).toBe('se');}
  });

  it('maps pointer coordinates to the same document pixel after zooming and panning',()=>{
    for(const zoom of [.25,.5,1,2,4]){const pan={x:37,y:-19},left=200+pan.x,top=140+pan.y,canvas={getBoundingClientRect:()=>({left,top,width:400*zoom,height:300*zoom})} as unknown as HTMLCanvasElement,event={clientX:left+67*zoom,clientY:top+42*zoom} as PointerEvent;expect(point(event,canvas,zoom,pan,{width:400,height:300,layers:[],activeId:''})).toEqual({x:67,y:42});}
  });

  it('rasterizes with smooth or nearest-neighbor sampling and applies flips/rotation',()=>{
    const source=recordingCanvas(20,10),target=recordingCanvas(10,20);
    const raster=rasterizeTransform(source.element,{...base,rotation:90,flipX:true},100,100,false,target.element);
    expect(raster.rect.width).toBe(10);expect(raster.rect.height).toBe(20);expect(target.context.rotate).toHaveBeenCalledWith(Math.PI/2);expect(target.context.scale).toHaveBeenCalledWith(-1,1);expect(target.context.imageSmoothingEnabled).toBe(false);
    rasterizeTransform(source.element,{...base,rotation:90,flipY:true},100,100,true,target.element);
    expect(target.context.scale).toHaveBeenLastCalledWith(1,-1);
    expect(target.context.imageSmoothingEnabled).toBe(true);
    expect(target.context.clearRect.mock.calls).toEqual([[0,0,10,20],[0,0,10,20]]);
    expect(target.context.save).toHaveBeenCalledTimes(2);
    expect(target.context.restore).toHaveBeenCalledTimes(2);
  });

  it('previews transformations without modifying the source layer and honors its stack position',()=>{
    const lower=recordingCanvas(100,100),active=recordingCanvas(100,100),upper=recordingCanvas(100,100),out=recordingCanvas(100,100),source=recordingCanvas(20,10),layerScratch=recordingCanvas(100,100),rasterScratch=recordingCanvas(10,20),order:unknown[]=[];
    out.context.drawImage.mockImplementation((item)=>order.push(item));const layers=[{id:'lower',name:'lower',visible:true,locked:false,opacity:1,canvas:lower.element},{id:'active',name:'active',visible:true,locked:false,opacity:.5,canvas:active.element},{id:'upper',name:'upper',visible:true,locked:false,opacity:1,canvas:upper.element}] as Layer[],doc:DocumentModel={width:100,height:100,layers,activeId:'active'};
    renderTransformPreview(doc,out.element,'active',source.element,{x:10,y:10,width:20,height:10},{...base,rotation:90},true,layerScratch.element,rasterScratch.element);
    expect(order).toEqual([lower.element,layerScratch.element,upper.element]);
    expect(layerScratch.context.drawImage).toHaveBeenCalledWith(active.element,0,0);
    expect(rasterScratch.context.drawImage).toHaveBeenCalledWith(source.element,-10,-5,20,10);
    expect(active.context.clearRect).not.toHaveBeenCalled();
    expect(active.context.putImageData).not.toHaveBeenCalled();
  });

  it('composites transformed alpha over destination pixels and leaves transparent pixels unchanged',()=>{
    const f=pixelCanvas(3,1),layer={id:'active',name:'active',visible:true,locked:false,opacity:1,canvas:f.element} as Layer;f.pixels.set([0,0,255,255],4);
    const pixels={width:2,height:1,data:new Uint8ClampedArray([255,0,0,128,0,255,0,0])} as ImageData;commitTransform(layer,{x:0,y:0,width:1,height:1},{pixels,rect:{x:1,y:0,width:2,height:1}});
    expect(Array.from(f.pixels.slice(4,8))).toEqual([128,0,127,255]);expect(Array.from(f.pixels.slice(8,12))).toEqual([0,0,0,0]);
  });

  it('commits a lasso transform without clearing pixels outside its mask',()=>{
    const f=pixelCanvas(3,1),layer={id:'active',name:'active',visible:true,locked:false,opacity:1,canvas:f.element} as Layer;f.pixels.set([10,20,30,255],0);f.pixels.set([40,50,60,255],4);const region={x:0,y:0,width:2,height:1,mask:new Uint8Array([255,0]),points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]};
    commitTransform(layer,region,{pixels:{width:1,height:1,data:new Uint8ClampedArray([200,100,50,255])} as ImageData,rect:{x:2,y:0,width:1,height:1}});
    expect(Array.from(f.pixels.slice(0,4))).toEqual([0,0,0,0]);expect(Array.from(f.pixels.slice(4,8))).toEqual([40,50,60,255]);expect(Array.from(f.pixels.slice(8,12))).toEqual([200,100,50,255]);
  });

  it('supports transform commit undo/redo and leaves the source unchanged for a canceled preview',()=>{
    const f=pixelCanvas(3,1),layer={id:'active',name:'active',visible:true,locked:false,opacity:1,canvas:f.element} as Layer,doc:DocumentModel={width:3,height:1,layers:[layer],activeId:layer.id};f.pixels.set([200,40,20,255],0);
    const source=recordingCanvas(1,1),preview=recordingCanvas(3,1),layerScratch=recordingCanvas(3,1),rasterScratch=recordingCanvas(1,1);renderTransformPreview(doc,preview.element,layer.id,source.element,{x:0,y:0,width:1,height:1},{...base,x:2,y:0,width:1,height:1},true,layerScratch.element,rasterScratch.element);expect(Array.from(f.pixels.slice(0,4))).toEqual([200,40,20,255]);
    vi.stubGlobal('crypto',{randomUUID:()=> 'restored'});vi.stubGlobal('document',{createElement:()=>pixelCanvas(3,1).element});const history=new HistoryManager(),before=snapshot(doc);commitTransform(layer,{x:0,y:0,width:1,height:1},{pixels:{width:1,height:1,data:new Uint8ClampedArray([200,40,20,255])} as ImageData,rect:{x:2,y:0,width:1,height:1}});history.pushPixels(before,doc);
    expect(Array.from(f.pixels.slice(8,12))).toEqual([200,40,20,255]);expect(history.undo(doc)).toBe(true);expect(doc.layers[0].canvas.getContext('2d')!.getImageData(0,0,3,1).data[0]).toBe(200);expect(history.redo(doc)).toBe(true);expect(Array.from(doc.layers[0].canvas.getContext('2d')!.getImageData(0,0,3,1).data.slice(8,12))).toEqual([200,40,20,255]);
  });

  it('blocks transforms on hidden or locked layers',()=>{expect(canTransformLayer({visible:true,locked:false})).toBe(true);expect(canTransformLayer({visible:false,locked:false})).toBe(false);expect(canTransformLayer({visible:true,locked:true})).toBe(false);});
});
