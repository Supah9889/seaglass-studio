import type {DocumentModel,Layer} from './document';
import {composite} from './paint';
import {clearSelection,copyLayerToPreview,type SelectionRect} from './selection';

export type TransformSpec={x:number;y:number;width:number;height:number;rotation:number;flipX:boolean;flipY:boolean};
export type TransformHandle='nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'rotate'|'move';
export type TransformModifiers={shift:boolean;alt:boolean};
export type TransformRaster={pixels:ImageData;rect:SelectionRect};
export const transformFromSelection=(rect:SelectionRect):TransformSpec=>({x:rect.x,y:rect.y,width:rect.width,height:rect.height,rotation:0,flipX:false,flipY:false});
export function sameTransform(a:TransformSpec,b:TransformSpec){
  return a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height&&a.rotation===b.rotation&&a.flipX===b.flipX&&a.flipY===b.flipY;
}
export function transformSelectionPoints(region:SelectionRect,spec:TransformSpec){const center=transformCenter(spec),angle=radians(spec.rotation);return(region.points??[]).map(p=>{let x=(p.x-region.x)/region.width-.5,y=(p.y-region.y)/region.height-.5;if(spec.flipX)x=-x;if(spec.flipY)y=-y;const sx=x*spec.width,sy=y*spec.height;return{x:center.x+sx*Math.cos(angle)-sy*Math.sin(angle),y:center.y+sx*Math.sin(angle)+sy*Math.cos(angle)};});}
export const canTransformLayer=(layer:{visible:boolean;locked:boolean})=>layer.visible&&!layer.locked;
export const transformCenter=(spec:TransformSpec)=>({x:spec.x+spec.width/2,y:spec.y+spec.height/2});
const radians=(degrees:number)=>degrees*Math.PI/180;
const normalizeRotation=(degrees:number)=>{let angle=((degrees%360)+360)%360;if(angle>180)angle-=360;return angle;};
function rotatePoint(point:{x:number;y:number},center:{x:number;y:number},angle:number){const a=radians(angle),cos=Math.cos(a),sin=Math.sin(a),x=point.x-center.x,y=point.y-center.y;return{x:center.x+x*cos-y*sin,y:center.y+x*sin+y*cos};}
function inverseRotatePoint(point:{x:number;y:number},center:{x:number;y:number},angle:number){return rotatePoint(point,center,-angle);}
export function transformedBounds(spec:TransformSpec){const center=transformCenter(spec),a=radians(spec.rotation),cos=Math.abs(Math.cos(a)),sin=Math.abs(Math.sin(a)),width=spec.width*cos+spec.height*sin,height=spec.width*sin+spec.height*cos;return{x:center.x-width/2,y:center.y-height/2,width,height};}

/** Keep the rotated extent inside the current document canvas, scaling down only when required. */
export function constrainTransform(spec:TransformSpec,documentWidth:number,documentHeight:number):TransformSpec{
  let next={...spec,width:Math.max(1,spec.width),height:Math.max(1,spec.height),rotation:normalizeRotation(spec.rotation)};
  const center=transformCenter(next),bounds=transformedBounds(next),scale=Math.min(1,documentWidth/bounds.width,documentHeight/bounds.height);
  if(scale<1){next.width=Math.max(1,next.width*scale);next.height=Math.max(1,next.height*scale);next.x=center.x-next.width/2;next.y=center.y-next.height/2;}
  const fitted=transformedBounds(next),cx=Math.max(fitted.width/2,Math.min(documentWidth-fitted.width/2,(fitted.x+fitted.width/2))),cy=Math.max(fitted.height/2,Math.min(documentHeight-fitted.height/2,(fitted.y+fitted.height/2)));
  next.x+=cx-(fitted.x+fitted.width/2);next.y+=cy-(fitted.y+fitted.height/2);return next;
}

export function transformHandles(spec:TransformSpec,zoom=1){
  const center=transformCenter(spec),halfWidth=spec.width/2,halfHeight=spec.height/2,offset=24/Math.max(.1,zoom),local:Record<TransformHandle,{x:number;y:number}>={nw:{x:-halfWidth,y:-halfHeight},n:{x:0,y:-halfHeight},ne:{x:halfWidth,y:-halfHeight},e:{x:halfWidth,y:0},se:{x:halfWidth,y:halfHeight},s:{x:0,y:halfHeight},sw:{x:-halfWidth,y:halfHeight},w:{x:-halfWidth,y:0},rotate:{x:0,y:-halfHeight-offset},move:{x:0,y:0}};
  return Object.fromEntries(Object.entries(local).map(([key,p])=>[key,rotatePoint({x:center.x+p.x,y:center.y+p.y},center,spec.rotation)])) as Record<TransformHandle,{x:number;y:number}>;
}

export function hitTestTransformHandle(spec:TransformSpec,point:{x:number;y:number},zoom:number):TransformHandle|null{
  const points=transformHandles(spec,zoom),radius=12/Math.max(.1,zoom),order:TransformHandle[]=['rotate','nw','n','ne','e','se','s','sw','w'];
  return order.map(handle=>({handle,distance:Math.hypot(point.x-points[handle].x,point.y-points[handle].y)})).filter(item=>item.distance<=radius).sort((a,b)=>a.distance-b.distance)[0]?.handle??null;
}

export function containsTransformPoint(spec:TransformSpec,point:{x:number;y:number}){const local=inverseRotatePoint(point,transformCenter(spec),spec.rotation);return local.x>=spec.x&&local.x<=spec.x+spec.width&&local.y>=spec.y&&local.y<=spec.y+spec.height;}

export function drawTransformOverlay(canvas:HTMLCanvasElement|null,spec:TransformSpec|null,zoom:number){
  if(!canvas||!spec)return;const context=canvas.getContext('2d');if(!context)return;const handles=transformHandles(spec,zoom),size=8/Math.max(.1,zoom),half=size/2,order:TransformHandle[]=['nw','n','ne','e','se','s','sw','w'];
  context.save();context.lineWidth=1.5/Math.max(.1,zoom);context.setLineDash([]);context.strokeStyle='rgba(16,75,88,.98)';context.beginPath();for(let i=0;i<4;i++){const p=handles[(['nw','ne','se','sw'] as TransformHandle[])[i]];i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y);}context.closePath();context.stroke();context.lineWidth=1/Math.max(.1,zoom);context.strokeStyle='rgba(255,255,255,.98)';context.stroke();
  const top=handles.n,rotation=handles.rotate;context.beginPath();context.moveTo(top.x,top.y);context.lineTo(rotation.x,rotation.y);context.strokeStyle='rgba(16,75,88,.98)';context.stroke();
  for(const handle of order){const p=handles[handle];context.beginPath();context.rect(p.x-half,p.y-half,size,size);context.fillStyle='#f7ffff';context.fill();context.strokeStyle='#147f91';context.lineWidth=1.5/Math.max(.1,zoom);context.stroke();}
  context.beginPath();context.arc(rotation.x,rotation.y,5/Math.max(.1,zoom),0,Math.PI*2);context.fillStyle='#ecfffc';context.fill();context.strokeStyle='#147f91';context.stroke();context.restore();
}

export function transformCursor(handle:TransformHandle|null){if(handle==='rotate')return'grab';if(handle==='move')return'move';if(handle==='n'||handle==='s')return'ns-resize';if(handle==='e'||handle==='w')return'ew-resize';if(handle==='nw'||handle==='se')return'nwse-resize';if(handle==='ne'||handle==='sw')return'nesw-resize';return'crosshair';}

export function resizeTransform(start:TransformSpec,handle:Exclude<TransformHandle,'rotate'|'move'>,pointer:{x:number;y:number},modifiers:TransformModifiers):TransformSpec{
  const startCenter=transformCenter(start),localPointer=inverseRotatePoint(pointer,startCenter,start.rotation),west=handle.includes('w'),east=handle.includes('e'),north=handle.includes('n'),south=handle.includes('s'),dx=west?-1:east?1:0,dy=north?-1:south?1:0;
  let left=start.x,top=start.y,width=start.width,height=start.height;
  if(modifiers.shift&&dx&&dy){
    const anchorX=modifiers.alt?startCenter.x:dx<0?start.x+start.width:start.x,anchorY=modifiers.alt?startCenter.y:dy<0?start.y+start.height:start.y;
    const sx=modifiers.alt?2*Math.abs(localPointer.x-anchorX)/start.width:Math.abs(localPointer.x-anchorX)/start.width,sy=modifiers.alt?2*Math.abs(localPointer.y-anchorY)/start.height:Math.abs(localPointer.y-anchorY)/start.height,scale=Math.max(.01,sx,sy);
    width=start.width*scale;height=start.height*scale;left=modifiers.alt?startCenter.x-width/2:dx<0?anchorX-width:anchorX;top=modifiers.alt?startCenter.y-height/2:dy<0?anchorY-height:anchorY;
  }else{
    if(dx){if(modifiers.alt){width=Math.max(1,2*Math.abs(localPointer.x-startCenter.x));left=startCenter.x-width/2;}else if(dx<0){const right=start.x+start.width;left=Math.min(localPointer.x,right);width=Math.max(1,right-left);}else{left=start.x;width=Math.max(1,localPointer.x-left);}}
    if(dy){if(modifiers.alt){height=Math.max(1,2*Math.abs(localPointer.y-startCenter.y));top=startCenter.y-height/2;}else if(dy<0){const bottom=start.y+start.height;top=Math.min(localPointer.y,bottom);height=Math.max(1,bottom-top);}else{top=start.y;height=Math.max(1,localPointer.y-top);}}
    if(modifiers.shift&&dx&&!dy){height=width/(start.width/start.height);top=startCenter.y-height/2;}
    if(modifiers.shift&&dy&&!dx){width=height*(start.width/start.height);left=startCenter.x-width/2;}
  }
  const localCenter={x:left+width/2,y:top+height/2},globalCenter=rotatePoint(localCenter,startCenter,start.rotation);
  return{...start,x:globalCenter.x-width/2,y:globalCenter.y-height/2,width,height};
}

export function rotateTransform(start:TransformSpec,startPointer:{x:number;y:number},pointer:{x:number;y:number},snap:boolean){
  const center=transformCenter(start),angleAt=(p:{x:number;y:number})=>Math.atan2(p.y-center.y,p.x-center.x)*180/Math.PI+90;
  let rotation=start.rotation+angleAt(pointer)-angleAt(startPointer);if(snap)rotation=Math.round(rotation/15)*15;
  return{...start,rotation:normalizeRotation(rotation)};
}

/** Stage the transform with the same raster bounds and blending used by Apply. */
export function renderTransformPreview(doc:DocumentModel,out:HTMLCanvasElement,layerId:string,source:HTMLCanvasElement,sourceRect:SelectionRect,spec:TransformSpec,smoothing:boolean,layerScratch:HTMLCanvasElement,rasterScratch:HTMLCanvasElement){
  const layer=doc.layers.find(item=>item.id===layerId);
  if(!layer){
    composite(doc,out);
    return;
  }
  const raster=rasterizeTransform(source,spec,doc.width,doc.height,smoothing,rasterScratch);
  const preview=copyLayerToPreview(layer,layerScratch);
  commitTransform(preview,sourceRect,raster);
  composite(doc,out,preview);
}

export function rasterizeTransform(source:HTMLCanvasElement,spec:TransformSpec,documentWidth:number,documentHeight:number,smoothing:boolean,scratch?:HTMLCanvasElement):TransformRaster{
  const fitted=constrainTransform(spec,documentWidth,documentHeight),bounds=transformedBounds(fitted),width=Math.max(1,Math.ceil(bounds.width-1e-9)),height=Math.max(1,Math.ceil(bounds.height-1e-9));
  if(width*height>documentWidth*documentHeight)throw new Error('Transformed selection exceeds the document memory limit.');
  const x=Math.max(0,Math.min(documentWidth-width,Math.floor(bounds.x)));
  const y=Math.max(0,Math.min(documentHeight-height,Math.floor(bounds.y)));
  const canvas=scratch??document.createElement('canvas');
  if(canvas.width!==width)canvas.width=width;
  if(canvas.height!==height)canvas.height=height;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Could not prepare the transform buffer.');
  context.clearRect(0,0,width,height);
  context.save();
  try{
    context.imageSmoothingEnabled=smoothing;
    context.imageSmoothingQuality='high';
    context.translate(width/2,height/2);
    context.rotate(radians(fitted.rotation));
    context.scale(fitted.flipX?-1:1,fitted.flipY?-1:1);
    context.drawImage(source,-fitted.width/2,-fitted.height/2,fitted.width,fitted.height);
    return {pixels:context.getImageData(0,0,width,height),rect:{x,y,width,height}};
  }finally{
    context.restore();
  }
}

/** Clear the original selection then composite the transformed pixels over destination artwork. */
export function commitTransform(layer:Layer,sourceRect:SelectionRect,raster:TransformRaster){
  const context=layer.canvas.getContext('2d')!;clearSelection(layer,sourceRect);
  const {pixels,rect}=raster,left=Math.max(0,rect.x),top=Math.max(0,rect.y),right=Math.min(layer.canvas.width,rect.x+pixels.width),bottom=Math.min(layer.canvas.height,rect.y+pixels.height);
  if(right<=left||bottom<=top)return;const dest=context.getImageData(left,top,right-left,bottom-top),sourceX=left-rect.x,sourceY=top-rect.y;
  for(let y=0;y<dest.height;y++)for(let x=0;x<dest.width;x++){const si=((sourceY+y)*pixels.width+sourceX+x)*4,di=(y*dest.width+x)*4,sa=pixels.data[si+3]/255;if(!sa)continue;const da=dest.data[di+3]/255,oa=sa+da*(1-sa);for(let channel=0;channel<3;channel++)dest.data[di+channel]=Math.round((pixels.data[si+channel]*sa+dest.data[di+channel]*da*(1-sa))/oa);dest.data[di+3]=Math.round(oa*255);}
  context.putImageData(dest,left,top);
}

export function flipTransform(spec:TransformSpec,axis:'horizontal'|'vertical'){return axis==='horizontal'?{...spec,flipX:!spec.flipX}:{...spec,flipY:!spec.flipY};}
