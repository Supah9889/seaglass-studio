/**
 * SG-12: combine raster selections as bounded coverage masks.
 *
 * A rectangle counts as a solid mask; lasso masks keep their antialiased coverage. Add takes
 * the maximum coverage, Intersect the minimum, and Subtract the clamped difference. Results
 * are trimmed to their non-empty bounds and carry a mask but no polygon, so their outline is
 * traced from mask boundaries (holes and separate islands included).
 */
import type {SelectionRect} from './selection';

export type SelectionMode='replace'|'add'|'subtract'|'intersect';
export const SELECTION_MODES:{value:SelectionMode;label:string}[]=[
 {value:'replace',label:'Replace'},
 {value:'add',label:'Add'},
 {value:'subtract',label:'Subtract'},
 {value:'intersect',label:'Intersect'},
];
const MAX_MASK_PIXELS=16_777_216;

/** Coverage (0–255) of `region` at document pixel (x, y). */
function coverageAt(region:SelectionRect,x:number,y:number){
 const lx=x-region.x,ly=y-region.y;
 if(lx<0||ly<0||lx>=region.width||ly>=region.height)return 0;
 return region.mask?region.mask[ly*region.width+lx]:255;
}

/** Trim a mask to the bounds of its non-zero coverage; null when it is empty. */
function trimmed(x:number,y:number,width:number,height:number,mask:Uint8Array):SelectionRect|null{
 let minX=width,minY=height,maxX=-1,maxY=-1;
 for(let row=0;row<height;row++)for(let col=0;col<width;col++){
  if(!mask[row*width+col])continue;
  if(col<minX)minX=col;if(col>maxX)maxX=col;if(row<minY)minY=row;if(row>maxY)maxY=row;
 }
 if(maxX<0)return null;
 const w=maxX-minX+1,h=maxY-minY+1;
 if(w===width&&h===height)return {x,y,width,height,mask};
 const out=new Uint8Array(w*h);
 for(let row=0;row<h;row++)out.set(mask.subarray((row+minY)*width+minX,(row+minY)*width+minX+w),row*w);
 return {x:x+minX,y:y+minY,width:w,height:h,mask:out};
}

export function combineSelections(base:SelectionRect|null,next:SelectionRect|null,mode:SelectionMode):SelectionRect|null{
 if(mode==='replace')return next;
 if(!base)return mode==='add'?next:null;
 if(!next)return base;
 let x0:number,y0:number,x1:number,y1:number;
 if(mode==='add'){x0=Math.min(base.x,next.x);y0=Math.min(base.y,next.y);x1=Math.max(base.x+base.width,next.x+next.width);y1=Math.max(base.y+base.height,next.y+next.height);}
 else if(mode==='subtract'){x0=base.x;y0=base.y;x1=base.x+base.width;y1=base.y+base.height;}
 else{x0=Math.max(base.x,next.x);y0=Math.max(base.y,next.y);x1=Math.min(base.x+base.width,next.x+next.width);y1=Math.min(base.y+base.height,next.y+next.height);}
 const width=x1-x0,height=y1-y0;
 if(width<=0||height<=0)return null;
 if(width*height>MAX_MASK_PIXELS)throw new RangeError('Selection mask exceeds the document pixel limit.');
 const mask=new Uint8Array(width*height);
 for(let row=0;row<height;row++)for(let col=0;col<width;col++){
  const a=coverageAt(base,x0+col,y0+row),b=coverageAt(next,x0+col,y0+row);
  mask[row*width+col]=mode==='add'?Math.max(a,b):mode==='intersect'?Math.min(a,b):Math.max(0,a-b);
 }
 return trimmed(x0,y0,width,height,mask);
}

const outlineCache=new WeakMap<Uint8Array,Float32Array>();

/**
 * Boundary segments of a mask's covered area (any coverage), in document coordinates, as
 * [x1, y1, x2, y2, ...]. Collinear unit edges are merged; results are cached per mask.
 */
export function maskOutline(region:SelectionRect):Float32Array{
 const mask=region.mask;
 if(!mask)return new Float32Array([region.x,region.y,region.x+region.width,region.y,region.x+region.width,region.y,region.x+region.width,region.y+region.height,region.x+region.width,region.y+region.height,region.x,region.y+region.height,region.x,region.y+region.height,region.x,region.y]);
 const cached=outlineCache.get(mask);if(cached)return cached;
 const {width:w,height:h,x:ox,y:oy}=region,inside=(x:number,y:number)=>x>=0&&y>=0&&x<w&&y<h&&mask[y*w+x]>0;
 const out:number[]=[];
 // Horizontal edges between rows y-1 and y.
 for(let y=0;y<=h;y++){
  let start=-1;
  for(let x=0;x<=w;x++){
   const edge=x<w&&inside(x,y-1)!==inside(x,y);
   if(edge&&start<0)start=x;
   if(!edge&&start>=0){out.push(ox+start,oy+y,ox+x,oy+y);start=-1;}
  }
 }
 // Vertical edges between columns x-1 and x.
 for(let x=0;x<=w;x++){
  let start=-1;
  for(let y=0;y<=h;y++){
   const edge=y<h&&inside(x-1,y)!==inside(x,y);
   if(edge&&start<0)start=y;
   if(!edge&&start>=0){out.push(ox+x,oy+start,ox+x,oy+y);start=-1;}
  }
 }
 const segments=new Float32Array(out);
 outlineCache.set(mask,segments);
 return segments;
}
