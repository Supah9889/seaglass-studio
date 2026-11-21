import type {DocumentModel,Layer} from './document';
export type Tool='brush'|'pencil'|'eraser'|'hand'|'softAirbrush'|'spray'|'splatter'|'bucket'|'eyedropper'|'line'|'rectangle'|'ellipse'|'selection'|'lasso'|'blend'|'text';
export function point(e:PointerEvent,canvas:HTMLCanvasElement,zoom:number,_pan:{x:number;y:number},_doc:DocumentModel){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)/zoom,y:(e.clientY-r.top)/zoom};}
export function paint(layer:Layer,from:{x:number;y:number}|null,to:{x:number;y:number},size:number,color:string,opacity:number,eraser:boolean){if(eraser&&layer.alphaLocked)return;const c=layer.canvas.getContext('2d')!;c.save();c.globalAlpha=opacity;c.globalCompositeOperation=eraser?'destination-out':layer.alphaLocked?'source-atop':'source-over';c.strokeStyle=color;c.fillStyle=color;c.lineWidth=size;c.lineCap='round';c.lineJoin='round';if(from){c.beginPath();c.moveTo(from.x,from.y);c.lineTo(to.x,to.y);c.stroke();}else{c.beginPath();c.arc(to.x,to.y,size/2,0,Math.PI*2);c.fill();}c.restore();}
export function airbrush(layer:Layer,from:{x:number;y:number}|null,to:{x:number;y:number},radius:number,density:number,color:string,opacity:number,random=Math.random){const c=layer.canvas.getContext('2d')!;const start=from??to,dx=to.x-start.x,dy=to.y-start.y,dist=Math.hypot(dx,dy),spacing=Math.max(2,radius*.18),steps=from?Math.max(1,Math.ceil(dist/spacing)):0,count=Math.max(1,Math.min(80,Math.round(density)));c.save();c.globalCompositeOperation=layer.alphaLocked?'source-atop':'source-over';c.globalAlpha=opacity;for(let s=0;s<=steps;s++){if(from&&s===0)continue;const t=steps?s/steps:0,cx=start.x+dx*t,cy=start.y+dy*t;for(let i=0;i<count;i++){const angle=random()*Math.PI*2,reach=Math.sqrt(random())*radius,px=cx+Math.cos(angle)*reach,py=cy+Math.sin(angle)*reach,r=Math.max(.7,radius*(.025+random()*.075)),g=c.createRadialGradient(px,py,0,px,py,r);g.addColorStop(0,color);g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.beginPath();c.arc(px,py,r,0,Math.PI*2);c.fill();}}c.restore();}
export function softAirbrush(layer:Layer,from:{x:number;y:number}|null,to:{x:number;y:number},size:number,softness:number,flow:number,color:string,opacity:number){const c=layer.canvas.getContext('2d')!,start=from??to,dx=to.x-start.x,dy=to.y-start.y,dist=Math.hypot(dx,dy),step=Math.max(1,size*.12),steps=from?Math.max(1,Math.ceil(dist/step)):0,r=Math.max(.5,size/2),inner=r*(1-Math.max(0,Math.min(1,softness/100)));c.save();c.globalCompositeOperation=layer.alphaLocked?'source-atop':'source-over';c.globalAlpha=opacity*Math.max(0,Math.min(1,flow/100));for(let s=0;s<=steps;s++){if(from&&s===0)continue;const t=steps?s/steps:0,x=start.x+dx*t,y=start.y+dy*t,g=c.createRadialGradient(x,y,inner,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}c.restore();}
export function splatter(layer:Layer,from:{x:number;y:number}|null,to:{x:number;y:number},spread:number,density:number,dropletSize:number,color:string,opacity:number,random=Math.random){const c=layer.canvas.getContext('2d')!,start=from??to,dx=to.x-start.x,dy=to.y-start.y,dist=Math.hypot(dx,dy),spacing=Math.max(2,spread*.15),steps=from?Math.max(1,Math.ceil(dist/spacing)):0,count=Math.max(1,Math.min(60,Math.round(density)));c.save();c.globalCompositeOperation=layer.alphaLocked?'source-atop':'source-over';c.globalAlpha=opacity;for(let s=0;s<=steps;s++){if(from&&s===0)continue;const t=steps?s/steps:0,cx=start.x+dx*t,cy=start.y+dy*t;for(let i=0;i<count;i++){const a=random()*Math.PI*2,d=Math.sqrt(random())*spread,x=cx+Math.cos(a)*d,y=cy+Math.sin(a)*d,r=Math.max(1,dropletSize*(.45+random()*1.1));c.beginPath();c.ellipse(x,y,r,r*(.65+random()*.55),random()*Math.PI,0,Math.PI*2);c.fillStyle=color;c.fill();}}c.restore();}
const clipBuffers=new WeakMap<HTMLCanvasElement,HTMLCanvasElement>();
function clipBufferFor(out:HTMLCanvasElement,width:number,height:number){let buffer=clipBuffers.get(out);if(!buffer){buffer=document.createElement('canvas');clipBuffers.set(out,buffer);}if(buffer.width!==width)buffer.width=width;if(buffer.height!==height)buffer.height=height;return buffer;}
const groupBuffers=new WeakMap<HTMLCanvasElement,HTMLCanvasElement>();
function groupBufferFor(out:HTMLCanvasElement,width:number,height:number){let buffer=groupBuffers.get(out);if(!buffer){buffer=document.createElement('canvas');groupBuffers.set(out,buffer);}if(buffer.width!==width)buffer.width=width;if(buffer.height!==height)buffer.height=height;return buffer;}
/** Render a flat stack, with clipping runs scoped to this stack. */
function compositeStack(layers:Layer[],out:HTMLCanvasElement,width:number,height:number,clearTarget=true){const c=out.getContext('2d')!;if(clearTarget)c.clearRect(0,0,width,height);c.globalCompositeOperation='source-over';let i=0;while(i<layers.length){const base=layers[i];if(base.clipped){if(base.visible){c.globalAlpha=base.opacity;c.drawImage(base.canvas,0,0);}i++;continue;}if(base.visible){c.globalAlpha=base.opacity;c.globalCompositeOperation=base.blendMode==='multiply'||base.blendMode==='screen'?base.blendMode:'source-over';c.drawImage(base.canvas,0,0);c.globalCompositeOperation='source-over';}let end=i+1;while(end<layers.length&&layers[end].clipped)end++;if(end>i+1){if(base.visible){const buffer=clipBufferFor(out,width,height),bc=buffer.getContext('2d')!;bc.clearRect(0,0,width,height);bc.globalCompositeOperation='source-over';for(let j=i+1;j<end;j++){const layer=layers[j];if(!layer.visible)continue;bc.globalAlpha=layer.opacity;bc.drawImage(layer.canvas,0,0);}bc.globalCompositeOperation='destination-in';bc.globalAlpha=base.opacity;bc.drawImage(base.canvas,0,0);bc.globalAlpha=1;bc.globalCompositeOperation='source-over';c.globalAlpha=1;c.drawImage(buffer,0,0);}i=end;}else i++;}c.globalAlpha=1;c.globalCompositeOperation='source-over';}
/** Groups composite their complete child stack first, then apply group opacity once. */
export function composite(doc:DocumentModel,out:HTMLCanvasElement,preview?:Pick<Layer,'id'|'canvas'>){
 const layers=preview?doc.layers.map(layer=>layer.id===preview.id?{...layer,canvas:preview.canvas}:layer):doc.layers;
 if(out.width!==doc.width)out.width=doc.width;
 if(out.height!==doc.height)out.height=doc.height;
 const context=out.getContext('2d')!;
 context.clearRect(0,0,out.width,out.height);
 context.globalCompositeOperation='source-over';
 let start=0;
 while(start<layers.length){
  const groupId=layers[start].groupId||undefined;
  let end=start+1;
  while(end<layers.length&&(layers[end].groupId||undefined)===groupId)end++;
  if(!groupId){
   compositeStack(layers.slice(start,end),out,doc.width,doc.height,false);
  }else{
   const group=doc.groups?.find(item=>item.id===groupId);
   if(group?.visible!==false){
    const buffer=groupBufferFor(out,doc.width,doc.height);
    compositeStack(layers.slice(start,end),buffer,doc.width,doc.height);
    context.globalAlpha=group?.opacity??1;
    context.drawImage(buffer,0,0);
   }
  }
  start=end;
 }
 context.globalAlpha=1;
 context.globalCompositeOperation='source-over';
}
export type SampleResult={status:'sampled';hex:string}|{status:'transparent'|'outside'};
export function sampleCompositeColor(doc:DocumentModel,out:HTMLCanvasElement,x:number,y:number):SampleResult{if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=doc.width||y>=doc.height)return{status:'outside'};composite(doc,out);const p=out.getContext('2d')!.getImageData(Math.floor(x),Math.floor(y),1,1).data;if(p[3]===0)return{status:'transparent'};const hex=(n:number)=>n.toString(16).padStart(2,'0');return{status:'sampled',hex:`#${hex(p[0])}${hex(p[1])}${hex(p[2])}`};}
export type ShapeTool='line'|'rectangle'|'ellipse';
export function drawShape(layer:Layer,tool:ShapeTool,a:{x:number;y:number},b:{x:number;y:number},color:string,opacity:number,strokeSize:number,filled:boolean){const c=layer.canvas.getContext('2d')!;const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(b.x-a.x),h=Math.abs(b.y-a.y);c.save();c.globalAlpha=opacity;c.globalCompositeOperation=layer.alphaLocked?'source-atop':'source-over';c.strokeStyle=color;c.fillStyle=color;c.lineWidth=strokeSize;c.lineJoin='round';if(tool==='line'){c.lineCap='round';c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}else if(tool==='rectangle'){if(filled)c.fillRect(x,y,w,h);else c.strokeRect(x,y,w,h);}else{c.beginPath();c.ellipse((a.x+b.x)/2,(a.y+b.y)/2,w/2,h/2,0,0,Math.PI*2);if(filled)c.fill();else c.stroke();}c.restore();}
export function stabilizePoint(previous:{x:number;y:number}|null,next:{x:number;y:number},strength:number){if(!previous)return next;const amount=Math.max(0,Math.min(95,strength))/100,follow=1-amount*.72;return{x:previous.x+(next.x-previous.x)*follow,y:previous.y+(next.y-previous.y)*follow};}
