import type {Layer} from './document';

export type BlendMode='smudge'|'blend'|'soften';
type Point={x:number;y:number};
// SG-16: short segments keep their original pacing (at most 64 dabs). Longer segments get
// regular spacing up to a per-segment budget of dab-pixel reads, so fast or sparse input no
// longer leaves gaps, while the largest brushes stay bounded.
const MIN_STEP_CAP=64,DAB_PIXEL_BUDGET=4_000_000;
export function maxBlendSteps(radius:number){const side=2*Math.ceil(radius)+1;return Math.max(MIN_STEP_CAP,Math.floor(DAB_PIXEL_BUDGET/(side*side)));}

function sample(data:Uint8ClampedArray,width:number,height:number,x:number,y:number){
  const fx=Math.max(0,Math.min(width-1,x)),fy=Math.max(0,Math.min(height-1,y)),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),tx=fx-x0,ty=fy-y0,weights=[(1-tx)*(1-ty),tx*(1-ty),(1-tx)*ty,tx*ty],indices=[(y0*width+x0)*4,(y0*width+x1)*4,(y1*width+x0)*4,(y1*width+x1)*4];let a=0,r=0,g=0,b=0;
  for(let i=0;i<4;i++){const w=weights[i],j=indices[i],alpha=data[j+3]/255* w;a+=alpha;r+=data[j]*alpha;g+=data[j+1]*alpha;b+=data[j+2]*alpha;}
  return a>1e-7?[r/a,g/a,b/a,a*255]:[0,0,0,0];
}

function mixAt(data:Uint8ClampedArray,index:number,target:number[],amount:number,changeAlpha:boolean){
  const t=Math.max(0,Math.min(1,amount)),sourceAlpha=data[index+3]/255,targetAlpha=target[3]/255,outAlpha=changeAlpha?sourceAlpha+(targetAlpha-sourceAlpha)*t:sourceAlpha;
  if(outAlpha<=1e-7){data[index]=data[index+1]=data[index+2]=data[index+3]=0;return;}
  for(let c=0;c<3;c++){const srcPremul=data[index+c]*sourceAlpha,dstPremul=target[c]*targetAlpha,premul=srcPremul+(dstPremul-srcPremul)*t;data[index+c]=Math.round(premul/outAlpha);}
  data[index+3]=Math.round(outAlpha*255);
}

function brushCoverage(distance:number,radius:number,softness:number){
  if(distance>=radius)return 0;const soft=Math.max(0,Math.min(100,softness))/100,inner=radius*(1-soft),edge=Math.max(.75,radius-inner);if(distance<=inner)return 1;const t=Math.max(0,Math.min(1,(radius-distance)/edge));return t*t*(3-2*t);
}

function dab(layer:Layer,center:Point,radius:number,strength:number,softness:number,mode:BlendMode,shift:Point,alphaLocked:boolean){
  const canvas=layer.canvas,context=canvas.getContext('2d');if(!context||radius<=0)return;
  const margin=mode==='smudge'?Math.ceil(Math.hypot(shift.x,shift.y))+1:1,left=Math.max(0,Math.floor(center.x-radius)-margin),top=Math.max(0,Math.floor(center.y-radius)-margin),right=Math.min(canvas.width,Math.ceil(center.x+radius)+margin),bottom=Math.min(canvas.height,Math.ceil(center.y+radius)+margin),width=right-left,height=bottom-top;
  if(width<=0||height<=0||width*height>120_000)return;const image=context.getImageData(left,top,width,height),source=new Uint8ClampedArray(image.data),amount=Math.max(0,Math.min(100,strength))/100;if(amount===0)return;
  for(let y=Math.max(0,Math.floor(center.y-radius)-top);y<Math.min(height,Math.ceil(center.y+radius)-top);y++)for(let x=Math.max(0,Math.floor(center.x-radius)-left);x<Math.min(width,Math.ceil(center.x+radius)-left);x++){
    const distance=Math.hypot(left+x+.5-center.x,top+y+.5-center.y),coverage=brushCoverage(distance,radius,softness)*amount;if(coverage<=0)continue;const i=(y*width+x)*4;
    if(mode==='smudge'){
      const target=sample(source,width,height,x-shift.x,y-shift.y);if(source[i+3]===0&&(alphaLocked||target[3]===0))continue;if(alphaLocked&&target[3]===0)continue;mixAt(image.data,i,target,coverage,!alphaLocked);continue;
    }
    if(source[i+3]===0&&(mode==='blend'||alphaLocked))continue;
    let wr=0,wg=0,wb=0,wa=0,total=0;
    const weights=mode==='soften'?[1,2,1,2,4,2,1,2,1]:[1,1,1,1,2,1,1,1,1];let k=0;
    for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++,k++){
      const sx=Math.max(0,Math.min(width-1,x+ox)),sy=Math.max(0,Math.min(height-1,y+oy)),si=(sy*width+sx)*4,w=weights[k],a=source[si+3]/255;total+=w;wa+=a*w;wr+=source[si]*a*w;wg+=source[si+1]*a*w;wb+=source[si+2]*a*w;
    }
    if(wa===0)continue;const alpha=mode==='soften'?wa/total*255:source[i+3],target=[wr/wa,wg/wa,wb/wa,alpha];mixAt(image.data,i,target,coverage,mode==='soften'&&!alphaLocked);
  }
  context.putImageData(image,left,top);
}

/** Applies localized, continuous blend dabs. Returns the dab count for diagnostics/tests. */
export function blendStroke(layer:Layer,from:Point|null,to:Point,diameter:number,strength:number,softness:number,mode:BlendMode):number{
  if(layer.locked||!layer.visible||!Number.isFinite(diameter)||!Number.isFinite(strength)||!Number.isFinite(softness))return 0;
  const radius=Math.max(.5,Math.min(60,diameter/2)),start=from??to,dx=to.x-start.x,dy=to.y-start.y,distance=Math.hypot(dx,dy);
  if(mode==='smudge'&&!from)return 0;const spacing=Math.max(1,radius*.22),steps=from?Math.max(1,Math.min(maxBlendSteps(radius),Math.ceil(distance/spacing))):0;
  if(!from){dab(layer,to,radius,strength,softness,mode,{x:0,y:0},layer.alphaLocked===true);return 1;}
  for(let i=1;i<=steps;i++){const t=i/steps,center={x:start.x+dx*t,y:start.y+dy*t},shift={x:dx/steps,y:dy/steps};dab(layer,center,radius,strength,softness,mode,shift,layer.alphaLocked===true);}
  return steps;
}
