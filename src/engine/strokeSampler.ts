/**
 * SG-15: evenly spaced dabs along a stroke, independent of the input sample rate.
 *
 * A distance accumulator places dabs every `spacing` pixels along the path and carries the
 * remainder across samples, so a sparse and a dense recording of the same path produce
 * near-identical dabs. Pressure is interpolated by distance. A tap produces exactly one
 * dab, and finishing a stroke places a final dab at the real end point when the last dab
 * is more than half a spacing away.
 */
export type Dab={x:number;y:number;pressure:number};
type Sample={x:number;y:number;pressure:number};

export class DabSampler{
 private last:Sample|null=null;
 /** Distance still to travel along the path before the next dab. */
 private toNext=0;
 private sinceDab=0;

 constructor(private readonly spacing:number){
  if(!(spacing>0))throw new RangeError('Dab spacing must be positive.');
 }

 /** Begin a stroke: the first dab sits exactly at the pointer-down point. */
 start(x:number,y:number,pressure:number):Dab[]{
  this.last={x,y,pressure};this.toNext=this.spacing;this.sinceDab=0;
  return [{x,y,pressure}];
 }

 /** Extend the stroke to (x, y); returns the dabs that fall on the new segment. */
 add(x:number,y:number,pressure:number):Dab[]{
  const from=this.last;
  if(!from)return this.start(x,y,pressure);
  const dx=x-from.x,dy=y-from.y,length=Math.hypot(dx,dy),dabs:Dab[]=[];
  if(length===0){this.last={x,y,pressure};return dabs;}
  let travelled=this.toNext;
  while(travelled<=length){
   const t=travelled/length;
   dabs.push({x:from.x+dx*t,y:from.y+dy*t,pressure:from.pressure+(pressure-from.pressure)*t});
   travelled+=this.spacing;
  }
  this.toNext=travelled-length;
  this.sinceDab=dabs.length?this.spacing-this.toNext:this.sinceDab+length;
  this.last={x,y,pressure};
  return dabs;
 }

 /** End the stroke at (x, y), flushing a final dab onto the real end point if needed. */
 finish(x:number,y:number,pressure:number):Dab[]{
  const dabs=this.add(x,y,pressure);
  if(this.sinceDab>this.spacing/2)dabs.push({x,y,pressure});
  this.sinceDab=0;
  return dabs;
 }
}

/** Dab spacing in pixels for a brush `diameter` and a spacing percentage (of the diameter). */
export function dabSpacing(diameter:number,percent:number){
 return Math.max(.5,Math.max(1,diameter)*Math.min(100,Math.max(1,percent))/100);
}
