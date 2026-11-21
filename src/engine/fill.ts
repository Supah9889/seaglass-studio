import type {Layer} from './document';

export type FillOptions={
  /** Maximum pixels visited; remains a hard resource safeguard. */
  maxPixels?:number;
  /** Ask before applying a fill at or above this portion of the canvas. */
  confirmRatio?:number;
  /** Set only after the user confirms a previously reported large fill. */
  allowLarge?:boolean;
  /** Include up to this many adjacent partially transparent edge pixels. */
  expansion?:number;
};

export type FillResult={status:'filled'|'unchanged'|'outside'|'too-large'|'confirmation-required'|'unavailable';pixels:number;ratio?:number};

/** Inclusive-exclusive pixel bounds of the region a fill will write. */
export type FillBounds={x0:number;y0:number;x1:number;y1:number};

/**
 * SG-11: the result of one region analysis. It holds the layer pixels read once, the region
 * (core pixels, then the antialias fringe) and its bounds, so a confirmed fill commits
 * without a second traversal. Nothing is written to the layer until commitFill.
 */
export type FillPlan={
  layer:Layer;
  image:ImageData;
  region:Uint32Array;
  coreCount:number;
  bounds:FillBounds;
  ratio:number;
  color:[number,number,number,number];
};

export type FillAnalysis=
  |{status:'ready';pixels:number;ratio:number;needsConfirmation:boolean;plan:FillPlan}
  |{status:Exclude<FillResult['status'],'filled'|'confirmation-required'>;pixels:number};

const DEFAULT_MAX_PIXELS=16_777_216,DEFAULT_CONFIRM_RATIO=.5,YIELD_EVERY=0x10000;
const yieldToUi=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

function same(data:Uint8ClampedArray,i:number,target:number[],tolerance:number){
  if(data[i+3]===0&&target[3]===0)return true;
  return Math.abs(data[i]-target[0])<=tolerance&&Math.abs(data[i+1]-target[1])<=tolerance&&Math.abs(data[i+2]-target[2])<=tolerance&&Math.abs(data[i+3]-target[3])<=tolerance;
}
function bitIsSet(bits:Uint8Array,index:number){return(bits[index>>>3]&(1<<(index&7)))!==0;}
function setBit(bits:Uint8Array,index:number){bits[index>>>3]|=1<<(index&7);}

/** A FIFO of pixel indices that grows on demand up to a hard limit. */
class RegionQueue{
  items:Uint32Array;
  length=0;
  constructor(private readonly limit:number){this.items=new Uint32Array(Math.min(limit,65536));}
  /** Returns false when the hard limit would be exceeded. */
  push(value:number){
    if(this.length>=this.limit)return false;
    if(this.length===this.items.length){
      const grown=new Uint32Array(Math.min(this.limit,this.items.length*2));
      grown.set(this.items);this.items=grown;
    }
    this.items[this.length++]=value;
    return true;
  }
}

/**
 * Find the four-connected region a fill would change, plus up to two pixels of partially
 * transparent fringe, in a single traversal. Work yields periodically to keep the UI responsive.
 */
export async function analyzeFill(layer:Layer,x:number,y:number,color:[number,number,number,number],tolerance:number,options:FillOptions={}):Promise<FillAnalysis>{
  if(!layer.visible||layer.locked)return{status:'unavailable',pixels:0};
  const canvas=layer.canvas,w=canvas.width,h=canvas.height,total=w*h;
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=w||y>=h)return{status:'outside',pixels:0};
  const ctx=canvas.getContext('2d');if(!ctx)return{status:'outside',pixels:0};
  const image=ctx.getImageData(0,0,w,h),data=image.data,seed=(Math.floor(y)*w+Math.floor(x))*4;
  const target=[data[seed],data[seed+1],data[seed+2],data[seed+3]],tol=Math.max(0,Math.min(255,Math.round(tolerance)));
  if(layer.alphaLocked&&target[3]===0)return{status:'unchanged',pixels:0};
  if(target.every((v,i)=>v===color[i]))return{status:'unchanged',pixels:0};
  const limit=Math.min(total,Math.max(1,Math.floor(options.maxPixels??DEFAULT_MAX_PIXELS)));
  const queue=new RegionQueue(limit),visited=new Uint8Array(Math.ceil(total/8));
  let overflow=false,x0=w,y0=h,x1=0,y1=0;
  const take=(p:number)=>{
    if(!queue.push(p)){overflow=true;return false;}
    setBit(visited,p);
    const px=p%w,py=(p/w)|0;
    if(px<x0)x0=px;if(px+1>x1)x1=px+1;if(py<y0)y0=py;if(py+1>y1)y1=py+1;
    return true;
  };
  const enqueue=(p:number)=>{
    if(bitIsSet(visited,p))return true;
    const i=p*4;
    if((layer.alphaLocked&&data[i+3]===0)||!same(data,i,target,tol))return true;
    return take(p);
  };
  enqueue(Math.floor(y)*w+Math.floor(x));
  let head=0;
  while(head<queue.length&&!overflow){
    const p=queue.items[head++],px=p%w,py=(p/w)|0;
    if(px>0&&!enqueue(p-1))break;
    if(px+1<w&&!enqueue(p+1))break;
    if(py>0&&!enqueue(p-w))break;
    if(py+1<h&&!enqueue(p+w))break;
    if((head&(YIELD_EVERY-1))===0)await yieldToUi();
  }
  if(overflow)return{status:'too-large',pixels:queue.length};

  const coreCount=queue.length,expansion=Math.max(0,Math.min(2,Math.floor(options.expansion??1)));
  // Expand only into partially transparent pixels. Opaque linework remains a hard barrier,
  // and transparent pixels beyond the antialias fringe are never visited.
  let layerStart=0,layerEnd=queue.length;
  for(let distance=0;distance<expansion&&layerStart<layerEnd;distance++){
    for(let n=layerStart;n<layerEnd&&!overflow;n++){
      const p=queue.items[n],px=p%w,py=(p/w)|0;
      const visit=(q:number)=>{
        if(bitIsSet(visited,q))return true;
        const alpha=data[q*4+3];
        if(alpha===0||alpha===255)return true;
        return take(q);
      };
      if(px>0&&!visit(p-1))break;
      if(px+1<w&&!visit(p+1))break;
      if(py>0&&!visit(p-w))break;
      if(py+1<h&&!visit(p+w))break;
      if((n&(YIELD_EVERY-1))===0)await yieldToUi();
    }
    layerStart=layerEnd;layerEnd=queue.length;
  }
  if(overflow)return{status:'too-large',pixels:queue.length};

  const pixels=queue.length,ratio=pixels/total,confirmRatio=Math.max(0,Math.min(1,options.confirmRatio??DEFAULT_CONFIRM_RATIO));
  return{status:'ready',pixels,ratio,needsConfirmation:ratio>=confirmRatio,
    plan:{layer,image,region:queue.items.subarray(0,pixels),coreCount,bounds:{x0,y0,x1,y1},ratio,color}};
}

/**
 * Write an analyzed fill into its layer, touching only the region's bounds. The caller is
 * responsible for confirming that the layer has not changed since the analysis.
 */
export async function commitFill(plan:FillPlan):Promise<FillResult>{
  const {layer,image,region,coreCount,bounds,color}=plan,data=image.data;
  const ctx=layer.canvas.getContext('2d');
  if(!ctx)return{status:'unavailable',pixels:0};
  // Replace the matched interior. For fringe pixels, composite the requested fill underneath
  // existing antialiased ink instead of flattening the ink.
  for(let n=0;n<coreCount;n++){
    const i=region[n]*4;
    if(layer.alphaLocked){const amount=color[3]/255;for(let channel=0;channel<3;channel++)data[i+channel]=Math.round(data[i+channel]+(color[channel]-data[i+channel])*amount);}
    else{data[i]=color[0];data[i+1]=color[1];data[i+2]=color[2];data[i+3]=color[3];}
    if(((n+1)&(YIELD_EVERY*16-1))===0)await yieldToUi();
  }
  for(let n=coreCount;n<region.length;n++){
    const i=region[n]*4,srcA=data[i+3]/255,fillA=color[3]/255,outA=srcA+fillA*(1-srcA);
    if(outA<=0){data[i]=data[i+1]=data[i+2]=data[i+3]=0;continue;}
    data[i]=Math.round((data[i]*srcA+color[0]*fillA*(1-srcA))/outA);
    data[i+1]=Math.round((data[i+1]*srcA+color[1]*fillA*(1-srcA))/outA);
    data[i+2]=Math.round((data[i+2]*srcA+color[2]*fillA*(1-srcA))/outA);
    if(!layer.alphaLocked)data[i+3]=Math.round(outA*255);
  }
  // Only the affected rectangle is written back to the layer.
  ctx.putImageData(image,0,0,bounds.x0,bounds.y0,bounds.x1-bounds.x0,bounds.y1-bounds.y0);
  return{status:'filled',pixels:region.length,ratio:plan.ratio};
}

/**
 * Fill a four-connected region. Pixel data stays in a private ImageData buffer until the
 * fill passes its size/confirmation checks, so canceling never edits the layer.
 */
export async function bucketFill(layer:Layer,x:number,y:number,color:[number,number,number,number],tolerance:number,options:FillOptions={}):Promise<FillResult>{
  const analysis=await analyzeFill(layer,x,y,color,tolerance,options);
  if(analysis.status!=='ready')return{status:analysis.status,pixels:analysis.pixels};
  if(analysis.needsConfirmation&&!options.allowLarge)return{status:'confirmation-required',pixels:analysis.pixels,ratio:analysis.ratio};
  return commitFill(analysis.plan);
}
