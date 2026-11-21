import {afterEach,describe,expect,it,vi} from 'vitest';
import {snapshot,type DocumentModel,type Layer} from './document';
import {HistoryManager} from './history';
import {point} from './paint';
import {clearSelection,containsPoint,copySelection,createLassoSelection,drawSelectionBorder,moveSelection,pasteClipboard,renderMovePreview,selectionRect,translateSelection} from './selection';

afterEach(()=>vi.unstubAllGlobals());

function canvas(width:number,height:number){
  const pixels=new Uint8ClampedArray(width*height*4);
  const context={globalAlpha:1,clearRect:(x:number,y:number,w:number,h:number)=>{for(let py=Math.max(0,y);py<Math.min(height,y+h);py++)for(let px=Math.max(0,x);px<Math.min(width,x+w);px++)pixels.fill(0,(py*width+px)*4,(py*width+px)*4+4);},getImageData:(x:number,y:number,w:number,h:number)=>{const data=new Uint8ClampedArray(w*h*4);for(let py=0;py<h;py++)for(let px=0;px<w;px++){const sx=x+px,sy=y+py;if(sx>=0&&sy>=0&&sx<width&&sy<height)data.set(pixels.subarray((sy*width+sx)*4,(sy*width+sx)*4+4),(py*w+px)*4);}return{data,width:w,height:h} as ImageData;},putImageData:(image:ImageData,x:number,y:number)=>{for(let py=0;py<image.height;py++)for(let px=0;px<image.width;px++){const dx=x+px,dy=y+py;if(dx>=0&&dy>=0&&dx<width&&dy<height)pixels.set(image.data.subarray((py*image.width+px)*4,(py*image.width+px)*4+4),(dy*width+dx)*4);}},drawImage:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),save:vi.fn(),restore:vi.fn(),strokeRect:vi.fn(),setLineDash:vi.fn()};
  return{width,height,pixels,context,element:{width,height,getContext:()=>context} as unknown as HTMLCanvasElement};
}

describe('rectangular selection engine',()=>{
  it('normalizes pointer drags and clips selections to the document',()=>{
    expect(selectionRect({x:7.8,y:5.2},{x:-3,y:2.1},8,6)).toEqual({x:0,y:2,width:8,height:4});
    expect(selectionRect({x:2,y:2},{x:2,y:7},8,6)).toBeNull();
    const rect={x:2,y:1,width:3,height:2};expect(containsPoint(rect,{x:2,y:1})).toBe(true);expect(containsPoint(rect,{x:5,y:1})).toBe(false);
  });

  it('copies and clears only the selected pixels while preserving transparency outside it',()=>{
    const f=canvas(4,3),layer={id:'active',name:'Active',visible:true,locked:false,opacity:1,canvas:f.element} as Layer;
    f.pixels.set([12,34,56,255],(1*4+1)*4);f.pixels.set([90,80,70,0],(1*4+2)*4);f.pixels.set([1,2,3,255],(2*4+3)*4);
    const rect={x:1,y:1,width:2,height:1},clipboard=copySelection(layer,rect);expect(Array.from(clipboard.image.data)).toEqual([12,34,56,255,90,80,70,0]);
    clearSelection(layer,rect);expect(Array.from(f.pixels.slice((1*4+1)*4,(1*4+3)*4))).toEqual([0,0,0,0,0,0,0,0]);expect(f.pixels[(2*4+3)*4]).toBe(1);
  });

  it('moves the selected pixel block, preserves alpha, and clips movement beyond canvas bounds',()=>{
    const f=canvas(4,2),layer={id:'active',name:'Active',visible:true,locked:false,opacity:1,canvas:f.element} as Layer;
    f.pixels.set([255,10,20,128],0);f.pixels.set([30,40,50,0],4);f.pixels.set([20,40,60,255],(1*4+3)*4);const clip=copySelection(layer,{x:0,y:0,width:2,height:1});
    moveSelection(layer,clip,3,1);expect(Array.from(f.pixels.slice((1*4+3)*4,(1*4+4)*4))).toEqual([138,25,40,255]);expect(Array.from(f.pixels.slice(0,8))).toEqual([0,0,0,0,0,0,0,0]);
  });

  it('previews a move without mutating artwork and keeps the layer compositing order',()=>{
    const lower=canvas(3,2),selected=canvas(3,2),upper=canvas(3,2),out=canvas(3,2),scratch=canvas(3,2);
    const draws:unknown[]=[];
    out.context.drawImage.mockImplementation(source=>draws.push([source,out.context.globalAlpha]));
    scratch.context.drawImage.mockImplementation(()=>scratch.pixels.set(selected.pixels));
    const a={id:'lower',name:'lower',visible:true,locked:false,opacity:1,canvas:lower.element};
    const b={id:'selected',name:'selected',visible:true,locked:false,opacity:.5,canvas:selected.element};
    const c={id:'upper',name:'upper',visible:true,locked:false,opacity:1,canvas:upper.element};
    selected.pixels.set([240,0,0,255,0,0,200,255]);
    selected.pixels.set([20,23,26,24],20);
    const original=selected.pixels.slice();
    const doc:DocumentModel={width:3,height:2,layers:[a,b,c],activeId:b.id};
    const clipboard=copySelection(b,{x:0,y:0,width:1,height:1,mask:new Uint8Array([128])});
    renderMovePreview(doc,out.element,b.id,clipboard,1,0,scratch.element);
    expect(draws).toEqual([[a.canvas,1],[scratch.element,.5],[c.canvas,1]]);
    expect(Array.from(scratch.pixels.slice(0,8))).toEqual([240,0,0,127,120,0,100,255]);
    expect(scratch.pixels.slice(20)).toEqual(original.slice(20));
    expect(selected.pixels).toEqual(original);
    expect(doc.layers[1].canvas).toBe(selected.element);

    draws.length=0;
    renderMovePreview(doc,out.element,b.id,clipboard,0,0,scratch.element);
    expect(draws).toEqual([[a.canvas,1],[selected.element,.5],[c.canvas,1]]);
    expect(scratch.context.drawImage).toHaveBeenCalledTimes(1);
  });

  it('draws selection boundaries only on the dedicated overlay canvas',()=>{
    const overlay=canvas(8,6),art=canvas(8,6);drawSelectionBorder(overlay.element,{x:1,y:2,width:4,height:3},4);
    expect(overlay.context.strokeRect).toHaveBeenCalledTimes(2);expect(art.pixels.every(value=>value===0)).toBe(true);
  });

  it('supports undo and redo of a committed move using the existing pixel history',()=>{
    const f=canvas(3,2),layer={id:'active',name:'Active',visible:true,locked:false,opacity:1,canvas:f.element} as Layer,doc:DocumentModel={width:3,height:2,layers:[layer],activeId:layer.id};
    f.pixels.set([200,100,50,255],0);const history=new HistoryManager();vi.stubGlobal('crypto',{randomUUID:()=> 'restored'});vi.stubGlobal('document',{createElement:()=>canvas(3,2).element});
    const before=doc.layers.map(item=>({id:item.id,name:item.name,visible:item.visible,locked:item.locked,opacity:item.opacity,activeDocumentLayerId:doc.activeId,data:item.canvas.getContext('2d')!.getImageData(0,0,3,2)}));
    const clip=copySelection(layer,{x:0,y:0,width:1,height:1});moveSelection(layer,clip,2,1);history.pushPixels(before,doc);
    expect(f.pixels.slice((1*3+2)*4,(1*3+3)*4)).toEqual(new Uint8ClampedArray([200,100,50,255]));expect(history.undo(doc)).toBe(true);expect(doc.layers[0].canvas.getContext('2d')!.getImageData(0,0,3,2).data[0]).toBe(200);expect(history.redo(doc)).toBe(true);expect(doc.layers[0].canvas.getContext('2d')!.getImageData(0,0,3,2).data.slice((1*3+2)*4,(1*3+3)*4)).toEqual(new Uint8ClampedArray([200,100,50,255]));
  });
});

describe('freehand lasso selection engine',()=>{
  it('rasterizes and closes an irregular concave path into a bounded antialiased mask',()=>{
    const alpha=new Uint8ClampedArray(3*3*4);alpha[3]=255;alpha[7]=128;alpha[(1*3+1)*4+3]=255;const ctx={clearRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),fill:vi.fn(),getImageData:()=>({data:alpha,width:3,height:3})};vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>ctx})});
    const points=[{x:1,y:1},{x:4,y:1},{x:2,y:2},{x:4,y:4},{x:1,y:4}],region=createLassoSelection(points,10,8);expect(region).toMatchObject({x:1,y:1,width:3,height:3,points});expect(Array.from(region!.mask!)).toContain(128);expect(ctx.closePath).toHaveBeenCalledOnce();expect(containsPoint(region!,{x:1.5,y:1.5})).toBe(true);expect(containsPoint(region!,{x:3.5,y:3.5})).toBe(false);
  });
  it('copies, clears, moves, and clips only mask coverage while retaining outside pixels',()=>{
    const f=canvas(4,3),layer={id:'active',name:'Active',visible:true,locked:false,opacity:1,canvas:f.element} as Layer;
    f.pixels.set([10,20,30,200],(1*4+1)*4);f.pixels.set([40,50,60,200],(1*4+2)*4);f.pixels.set([90,80,70,255],(1*4+3)*4);
    const region={x:1,y:1,width:2,height:1,mask:new Uint8Array([255,0]),points:[{x:1,y:1},{x:2,y:1},{x:2,y:2}]},clip=copySelection(layer,region);expect(clip.image.data[3]).toBe(200);expect(clip.image.data[7]).toBe(0);clearSelection(layer,region);expect(f.pixels[(1*4+1)*4+3]).toBe(0);expect(f.pixels[(1*4+2)*4+3]).toBe(200);expect(f.pixels[(1*4+3)*4+3]).toBe(255);
    f.pixels.set([10,20,30,200],(1*4+1)*4);moveSelection(layer,clip,1,1);expect(f.pixels[(2*4+2)*4+3]).toBe(200);expect(f.pixels[(1*4+2)*4+3]).toBe(200);expect(f.pixels[(1*4+3)*4+3]).toBe(255);
  });
  it('pastes the masked clipboard pixels with transparency and restores the lasso region',()=>{
    const from=canvas(3,2),to=canvas(3,2),source={id:'from',name:'From',visible:true,locked:false,opacity:1,canvas:from.element} as Layer,target={id:'to',name:'To',visible:true,locked:false,opacity:1,canvas:to.element} as Layer;from.pixels.set([60,120,180,255],0);const points=[{x:0,y:0},{x:1,y:0},{x:1,y:1}],region={x:0,y:0,width:2,height:1,mask:new Uint8Array([128,0]),points},clipboard=copySelection(source,region),pasted=pasteClipboard(target,clipboard);expect(Array.from(to.pixels.slice(0,8))).toEqual([60,120,180,128,0,0,0,0]);expect(pasted).toMatchObject({x:0,y:0,width:2,height:1,points});expect(Array.from(pasted.mask!)).toEqual([128,0]);
  });
  it('preserves partial edge alpha and translates a clipped lasso mask with its artwork',()=>{
    const f=canvas(3,2),layer={id:'active',name:'Active',visible:true,locked:false,opacity:1,canvas:f.element} as Layer;f.pixels.set([25,50,75,200],0);const region={x:0,y:0,width:2,height:1,mask:new Uint8Array([128,0])};const clip=copySelection(layer,region);expect(clip.image.data[3]).toBe(100);clearSelection(layer,region);expect(f.pixels[3]).toBe(100);const moved=translateSelection({...region,points:[{x:0,y:0},{x:2,y:0},{x:1,y:1}]},2,1,3,2);expect(moved).toMatchObject({x:2,y:1,width:1,height:1});expect(Array.from(moved!.mask!)).toEqual([128]);expect(moved!.points![0]).toEqual({x:2,y:1});
  });
  it('keeps lasso hit testing in document coordinates at every supported zoom and pan',()=>{
    const region={x:12,y:8,width:20,height:18,mask:new Uint8Array(20*18).fill(255)},doc:DocumentModel={width:100,height:80,layers:[],activeId:''};
    for(const zoom of [.25,.5,1,2,4,8]){const pan={x:53.25,y:-29.5},left=300+pan.x,top=140+pan.y,canvasElement={getBoundingClientRect:()=>({left,top,width:100*zoom,height:80*zoom})} as HTMLCanvasElement,e={clientX:left+16*zoom,clientY:top+12*zoom} as PointerEvent,docPoint=point(e,canvasElement,zoom,pan,doc);expect(containsPoint(region,docPoint)).toBe(true);}
  });
  it('keeps lasso processing bounded to a small region on a 4K document',()=>{
    let allocated:{width:number;height:number}|undefined;const alpha=new Uint8ClampedArray(12*9*4);alpha[3]=255;const ctx={clearRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),fill:vi.fn(),getImageData:()=>({data:alpha,width:12,height:9})};vi.stubGlobal('document',{createElement:()=>{const c={width:0,height:0,getContext:()=>ctx};allocated=c;return c;}});
    const region=createLassoSelection([{x:3800,y:2100},{x:3812,y:2100},{x:3812,y:2109},{x:3800,y:2109}],3840,2160);expect(region).toMatchObject({x:3800,y:2100,width:12,height:9});expect([allocated?.width,allocated?.height]).toEqual([12,9]);expect(region!.mask).toHaveLength(108);
  });
  it('supports undo and redo for lasso movement while preserving unselected source pixels',()=>{
    const f=canvas(4,2),layer={id:'lasso',name:'Lasso',visible:true,locked:false,opacity:1,canvas:f.element} as Layer,doc:DocumentModel={width:4,height:2,layers:[layer],activeId:layer.id},region={x:0,y:0,width:2,height:1,mask:new Uint8Array([255,0]),points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]};f.pixels.set([200,40,20,255],0);f.pixels.set([10,20,30,255],4);const history=new HistoryManager(),before=snapshot(doc),clip=copySelection(layer,region);moveSelection(layer,clip,1,1);history.pushPixels(before,doc);expect(Array.from(f.pixels.slice((1*4+1)*4,(1*4+2)*4))).toEqual([200,40,20,255]);expect(Array.from(f.pixels.slice(4,8))).toEqual([10,20,30,255]);vi.stubGlobal('crypto',{randomUUID:()=> 'lasso-restore'});vi.stubGlobal('document',{createElement:()=>canvas(4,2).element});expect(history.undo(doc)).toBe(true);expect(history.redo(doc)).toBe(true);expect(Array.from(doc.layers[0].canvas.getContext('2d')!.getImageData(0,0,4,2).data.slice((1*4+1)*4,(1*4+2)*4))).toEqual([200,40,20,255]);
  });
});
