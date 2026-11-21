/**
 * SG-13: local raster effects (Brightness/Contrast and Grayscale).
 *
 * Effects change color only: alpha is never modified, fully transparent pixels keep their
 * exact bytes, and pixels outside an optional selection mask are untouched. Partial mask
 * coverage blends between the original and the effect result. Neutral parameters are an
 * exact identity.
 */
export type EffectSettings=
 |{kind:'brightness-contrast';brightness:number;contrast:number}
 |{kind:'grayscale';amount:number};

export type EffectKind=EffectSettings['kind'];
export const EFFECT_KINDS:{value:EffectKind;label:string}[]=[
 {value:'brightness-contrast',label:'Brightness / Contrast'},
 {value:'grayscale',label:'Grayscale'},
];
export const defaultEffect=(kind:EffectKind):EffectSettings=>kind==='grayscale'?{kind,amount:100}:{kind,brightness:0,contrast:0};

const clamp=(value:number,min:number,max:number)=>Number.isFinite(value)?Math.min(max,Math.max(min,value)):0;

/** Clamp parameters to their supported ranges: brightness and contrast −100…100, amount 0…100. */
export function normalizeEffect(effect:EffectSettings):EffectSettings{
 return effect.kind==='grayscale'
  ?{kind:'grayscale',amount:clamp(Math.round(effect.amount),0,100)}
  :{kind:'brightness-contrast',brightness:clamp(Math.round(effect.brightness),-100,100),contrast:clamp(Math.round(effect.contrast),-100,100)};
}

export function isNeutralEffect(effect:EffectSettings){
 const e=normalizeEffect(effect);
 return e.kind==='grayscale'?e.amount===0:e.brightness===0&&e.contrast===0;
}

/** Build a 256-entry lookup for per-channel transforms (brightness/contrast). */
function channelTable(brightness:number,contrast:number){
 const table=new Uint8ClampedArray(256);
 const offset=brightness*2.55,c=contrast*2.55,factor=(259*(c+255))/(255*(259-c));
 for(let v=0;v<256;v++)table[v]=Math.round(factor*(v+offset-128)+128);
 return table;
}

/** Selection coverage in the pixel buffer's own coordinates; omitted means "everything". */
export type EffectMask={x:number;y:number;width:number;height:number;mask?:Uint8Array};

/**
 * Apply `effect` in place to RGBA `data` of a `width`-wide buffer whose top-left sits at
 * (`originX`, `originY`) in document space. Returns the number of pixels changed.
 */
export function applyEffect(data:Uint8ClampedArray,width:number,effect:EffectSettings,coverage?:EffectMask,originX=0,originY=0){
 const e=normalizeEffect(effect);
 if(isNeutralEffect(e))return 0;
 const height=data.length/(width*4);
 const table=e.kind==='brightness-contrast'?channelTable(e.brightness,e.contrast):null;
 const amount=e.kind==='grayscale'?e.amount/100:0;
 let changed=0;
 for(let y=0;y<height;y++){
  for(let x=0;x<width;x++){
   let cover=255;
   if(coverage){
    const lx=x+originX-coverage.x,ly=y+originY-coverage.y;
    if(lx<0||ly<0||lx>=coverage.width||ly>=coverage.height)continue;
    cover=coverage.mask?coverage.mask[ly*coverage.width+lx]:255;
    if(cover===0)continue;
   }
   const i=(y*width+x)*4;
   if(data[i+3]===0)continue;
   const r=data[i],g=data[i+1],b=data[i+2];
   let nr:number,ng:number,nb:number;
   if(table){nr=table[r];ng=table[g];nb=table[b];}
   else{const luma=0.2126*r+0.7152*g+0.0722*b;nr=r+(luma-r)*amount;ng=g+(luma-g)*amount;nb=b+(luma-b)*amount;}
   if(cover<255){const t=cover/255;nr=r+(nr-r)*t;ng=g+(ng-g)*t;nb=b+(nb-b)*t;}
   const or=Math.round(nr),og=Math.round(ng),ob=Math.round(nb);
   if(or!==r||og!==g||ob!==b){data[i]=or;data[i+1]=og;data[i+2]=ob;changed++;}
  }
 }
 return changed;
}

/** Horizontal runs of pixels whose bytes differ between `before` and `after` (one row each). */
export function changedSpans(before:Uint8ClampedArray,after:Uint8ClampedArray,width:number){
 const spans:{x:number;y:number;width:number}[]=[],height=before.length/(width*4);
 for(let y=0;y<height;y++){
  let start=-1;
  for(let x=0;x<=width;x++){
   const i=(y*width+x)*4;
   const differs=x<width&&(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2]||before[i+3]!==after[i+3]);
   if(differs&&start<0)start=x;
   if(!differs&&start>=0){spans.push({x:start,y,width:x-start});start=-1;}
  }
 }
 return spans;
}
