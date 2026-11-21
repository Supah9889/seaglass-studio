import type {DocumentModel,Layer} from './document';
import {composite} from './paint';
import {maskOutline} from './selectionCombine';

export type SelectionPoint={x:number;y:number};
export type SelectionRect={x:number;y:number;width:number;height:number;mask?:Uint8Array;points?:SelectionPoint[]};
export type SelectionClipboard={image:ImageData;x:number;y:number;mask?:Uint8Array;points?:SelectionPoint[]};

/** Creates an integer, document-clipped rectangle from two pointer positions. */
export function selectionRect(a:{x:number;y:number},b:{x:number;y:number},width:number,height:number):SelectionRect|null{
  const left=Math.max(0,Math.floor(Math.min(a.x,b.x))),top=Math.max(0,Math.floor(Math.min(a.y,b.y)));
  const right=Math.min(width,Math.ceil(Math.max(a.x,b.x))),bottom=Math.min(height,Math.ceil(Math.max(a.y,b.y)));
  return right>left&&bottom>top?{x:left,y:top,width:right-left,height:bottom-top}:null;
}

export function containsPoint(rect:SelectionRect,p:{x:number;y:number}){
  if(!(p.x>=rect.x&&p.y>=rect.y&&p.x<rect.x+rect.width&&p.y<rect.y+rect.height))return false;
  if(!rect.mask)return true;const x=Math.floor(p.x)-rect.x,y=Math.floor(p.y)-rect.y;return rect.mask[y*rect.width+x]>0;
}

/** Build an antialiased, compact mask by rasterizing a closed lasso into its clipped bounds. */
export function createLassoSelection(points:SelectionPoint[],width:number,height:number):SelectionRect|null{
  const clean=points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)).map(p=>({x:p.x,y:p.y}));
  if(clean.length<3)return null;let minX=width,minY=height,maxX=0,maxY=0;for(const p of clean){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  const left=Math.max(0,Math.floor(minX)),top=Math.max(0,Math.floor(minY)),right=Math.min(width,Math.ceil(maxX)),bottom=Math.min(height,Math.ceil(maxY));
  if(right<=left||bottom<=top)return null;const region={x:left,y:top,width:right-left,height:bottom-top};if(region.width*region.height>16_777_216)throw new RangeError('Selection mask exceeds the document pixel limit.');
  const canvas=document.createElement('canvas');canvas.width=region.width;canvas.height=region.height;const context=canvas.getContext('2d');if(!context)throw new Error('Could not create the lasso mask.');context.clearRect(0,0,region.width,region.height);context.fillStyle='#fff';context.beginPath();context.moveTo(clean[0].x-left,clean[0].y-top);for(let i=1;i<clean.length;i++)context.lineTo(clean[i].x-left,clean[i].y-top);context.closePath();context.fill();
  const rgba=context.getImageData(0,0,region.width,region.height).data,mask=new Uint8Array(region.width*region.height);let any=false;for(let i=0;i<mask.length;i++){mask[i]=rgba[i*4+3];any||=mask[i]>0;}return any?{...region,mask,points:clean}:null;
}

export function translateSelection(region:SelectionRect,dx:number,dy:number,width:number,height:number):SelectionRect|null{
  const shiftX=Math.round(dx),shiftY=Math.round(dy),rawX=region.x+shiftX,rawY=region.y+shiftY,left=Math.max(0,rawX),top=Math.max(0,rawY),right=Math.min(width,rawX+region.width),bottom=Math.min(height,rawY+region.height);if(right<=left||bottom<=top)return null;
  const next:SelectionRect={x:left,y:top,width:right-left,height:bottom-top};if(region.mask){const mask=new Uint8Array(next.width*next.height);for(let y=0;y<next.height;y++)for(let x=0;x<next.width;x++){const sx=left+x-rawX,sy=top+y-rawY;if(sx>=0&&sy>=0&&sx<region.width&&sy<region.height)mask[y*next.width+x]=region.mask[sy*region.width+sx];}next.mask=mask;}
  if(region.points)next.points=region.points.map(p=>({x:p.x+shiftX,y:p.y+shiftY}));return next;
}

export function copySelection(layer:Layer,rect:SelectionRect):SelectionClipboard{
  const image=layer.canvas.getContext('2d')!.getImageData(rect.x,rect.y,rect.width,rect.height);if(rect.mask){for(let i=0;i<rect.mask.length;i++){const alpha=Math.round(image.data[i*4+3]*rect.mask[i]/255);image.data[i*4+3]=alpha;if(!alpha){image.data[i*4]=0;image.data[i*4+1]=0;image.data[i*4+2]=0;}}}
  return{image,x:rect.x,y:rect.y,mask:rect.mask,points:rect.points};
}

export function pasteClipboard(layer:Layer,clipboard:SelectionClipboard):SelectionRect{
  layer.canvas.getContext('2d')!.putImageData(clipboard.image,clipboard.x,clipboard.y);
  return{x:clipboard.x,y:clipboard.y,width:clipboard.image.width,height:clipboard.image.height,mask:clipboard.mask,points:clipboard.points};
}

export function clearSelection(layer:Layer,rect:SelectionRect){
  const context=layer.canvas.getContext('2d')!;if(!rect.mask){context.clearRect(rect.x,rect.y,rect.width,rect.height);return;}const image=context.getImageData(rect.x,rect.y,rect.width,rect.height);for(let i=0;i<rect.mask.length;i++){const alpha=Math.round(image.data[i*4+3]*(255-rect.mask[i])/255);image.data[i*4+3]=alpha;if(!alpha){image.data[i*4]=0;image.data[i*4+1]=0;image.data[i*4+2]=0;}}context.putImageData(image,rect.x,rect.y);
}

export function moveSelection(layer:Layer,clipboard:SelectionClipboard,dx:number,dy:number){
  const context=layer.canvas.getContext('2d')!;
  clearSelection(layer,{x:clipboard.x,y:clipboard.y,width:clipboard.image.width,height:clipboard.image.height,mask:clipboard.mask});
  const targetX=clipboard.x+Math.round(dx),targetY=clipboard.y+Math.round(dy),left=Math.max(0,targetX),top=Math.max(0,targetY),right=Math.min(layer.canvas.width,targetX+clipboard.image.width),bottom=Math.min(layer.canvas.height,targetY+clipboard.image.height);
  if(right<=left||bottom<=top)return;
  const destination=context.getImageData(left,top,right-left,bottom-top),sourceX=left-targetX,sourceY=top-targetY;
  for(let y=0;y<destination.height;y++)for(let x=0;x<destination.width;x++){
    const sourceIndex=((sourceY+y)*clipboard.image.width+sourceX+x)*4,targetIndex=(y*destination.width+x)*4,sa=clipboard.image.data[sourceIndex+3]/255;
    if(sa===0)continue;const da=destination.data[targetIndex+3]/255,outA=sa+da*(1-sa);
    for(let channel=0;channel<3;channel++)destination.data[targetIndex+channel]=Math.round((clipboard.image.data[sourceIndex+channel]*sa+destination.data[targetIndex+channel]*da*(1-sa))/outA);
    destination.data[targetIndex+3]=Math.round(outA*255);
  }
  context.putImageData(destination,left,top);
}

/** Clone one layer into session-owned scratch before applying a staged edit. */
export function copyLayerToPreview(layer:Layer,canvas:HTMLCanvasElement):Layer{
  const {width,height}=layer.canvas;
  if(canvas.width!==width)canvas.width=width;
  if(canvas.height!==height)canvas.height=height;
  const context=canvas.getContext('2d')!;
  context.clearRect(0,0,width,height);
  context.drawImage(layer.canvas,0,0);
  return {...layer,canvas};
}

/** Paints a move preview into the display canvas without changing document pixels. */
export function renderMovePreview(doc:DocumentModel,out:HTMLCanvasElement,layerId:string,clipboard:SelectionClipboard,dx:number,dy:number,scratch:HTMLCanvasElement){
  const layer=doc.layers.find(item=>item.id===layerId);
  if(!layer||(!Math.round(dx)&&!Math.round(dy))){
    composite(doc,out);
    return;
  }
  const preview=copyLayerToPreview(layer,scratch);
  moveSelection(preview,clipboard,dx,dy);
  composite(doc,out,preview);
}

export function drawSelectionBorder(canvas:HTMLCanvasElement|null,rect:SelectionRect|null,zoom:number){
  if(!canvas)return;const context=canvas.getContext('2d');if(!context)return;
  context.save();context.lineWidth=1/Math.max(.1,zoom);context.setLineDash([5/Math.max(.1,zoom),3/Math.max(.1,zoom)]);
  if(rect){if(rect.points?.length){context.beginPath();context.moveTo(rect.points[0].x,rect.points[0].y);for(const p of rect.points.slice(1))context.lineTo(p.x,p.y);context.closePath();context.strokeStyle='rgba(255,255,255,.98)';context.stroke();context.lineDashOffset=4/Math.max(.1,zoom);context.strokeStyle='rgba(20,78,91,.95)';context.stroke();}else if(rect.mask){const segments=maskOutline(rect);context.beginPath();for(let i=0;i<segments.length;i+=4){context.moveTo(segments[i],segments[i+1]);context.lineTo(segments[i+2],segments[i+3]);}context.strokeStyle='rgba(255,255,255,.98)';context.stroke();context.lineDashOffset=4/Math.max(.1,zoom);context.strokeStyle='rgba(20,78,91,.95)';context.stroke();}else{context.strokeStyle='rgba(255,255,255,.98)';context.strokeRect(rect.x+.5/zoom,rect.y+.5/zoom,rect.width-1/zoom,rect.height-1/zoom);context.setLineDash([5/Math.max(.1,zoom),3/Math.max(.1,zoom)]);context.lineDashOffset=4/Math.max(.1,zoom);context.strokeStyle='rgba(20,78,91,.95)';context.strokeRect(rect.x+.5/zoom,rect.y+.5/zoom,rect.width-1/zoom,rect.height-1/zoom);}}
  context.restore();
}

export function drawLassoPath(canvas:HTMLCanvasElement|null,points:SelectionPoint[],zoom:number,closed=false){
  if(!canvas||points.length<2)return;const context=canvas.getContext('2d');if(!context)return;context.save();context.lineWidth=1/Math.max(.1,zoom);context.setLineDash([5/Math.max(.1,zoom),3/Math.max(.1,zoom)]);context.beginPath();context.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))context.lineTo(p.x,p.y);if(closed)context.closePath();context.strokeStyle='rgba(255,255,255,.98)';context.stroke();context.lineDashOffset=4/Math.max(.1,zoom);context.strokeStyle='rgba(20,78,91,.95)';context.stroke();context.restore();
}
