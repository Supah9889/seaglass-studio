import {describe,expect,it} from 'vitest';
import {combineSelections,maskOutline} from './selectionCombine';
import type {SelectionRect} from './selection';

const rect=(x:number,y:number,width:number,height:number):SelectionRect=>({x,y,width,height});
const at=(r:SelectionRect|null,x:number,y:number)=>{if(!r)return 0;const lx=x-r.x,ly=y-r.y;if(lx<0||ly<0||lx>=r.width||ly>=r.height)return 0;return r.mask?r.mask[ly*r.width+lx]:255;};
const covered=(r:SelectionRect|null)=>{let n=0;if(!r)return 0;for(let i=0;i<r.width*r.height;i++)if((r.mask?r.mask[i]:255)>0)n++;return n;};

describe('selection combine modes',()=>{
 it('keeps replace as plain replacement',()=>{
  expect(combineSelections(rect(0,0,4,4),rect(10,10,2,2),'replace')).toEqual(rect(10,10,2,2));
 });

 it('adds disjoint rectangles into one bounded mask with both islands',()=>{
  const out=combineSelections(rect(0,0,2,2),rect(6,0,2,2),'add')!;
  expect([out.x,out.y,out.width,out.height]).toEqual([0,0,8,2]);
  expect(covered(out)).toBe(8);
  expect(at(out,3,0)).toBe(0);
  expect(maskOutline(out).length/4).toBe(8); // two separate squares: four edges each
 });

 it('subtracts an inner rectangle to leave a hole',()=>{
  const out=combineSelections(rect(0,0,6,6),rect(2,2,2,2),'subtract')!;
  expect(covered(out)).toBe(32);
  expect(at(out,2,2)).toBe(0);
  expect(at(out,0,0)).toBe(255);
  expect(maskOutline(out).length/4).toBe(8); // outer square and the hole
 });

 it('intersects overlapping rectangles and trims to the overlap',()=>{
  const out=combineSelections(rect(0,0,5,5),rect(3,2,5,5),'intersect')!;
  expect([out.x,out.y,out.width,out.height]).toEqual([3,2,2,3]);
  expect(covered(out)).toBe(6);
 });

 it('returns null for empty results',()=>{
  expect(combineSelections(rect(0,0,2,2),rect(5,5,2,2),'intersect')).toBeNull();
  expect(combineSelections(rect(0,0,2,2),rect(0,0,2,2),'subtract')).toBeNull();
  expect(combineSelections(null,rect(0,0,2,2),'subtract')).toBeNull();
  expect(combineSelections(null,rect(1,1,2,2),'add')).toEqual(rect(1,1,2,2));
  // A click that draws no shape never discards the selection.
  for(const mode of ['add','subtract','intersect'] as const)expect(combineSelections(rect(0,0,2,2),null,mode)).toEqual(rect(0,0,2,2));
 });

 it('preserves fractional lasso coverage: max for add, min for intersect, clamped difference for subtract',()=>{
  const soft:SelectionRect={x:0,y:0,width:2,height:1,mask:new Uint8Array([100,200])};
  const other:SelectionRect={x:0,y:0,width:2,height:1,mask:new Uint8Array([150,50])};
  expect([...combineSelections(soft,other,'add')!.mask!]).toEqual([150,200]);
  expect([...combineSelections(soft,other,'intersect')!.mask!]).toEqual([100,50]);
  const difference=combineSelections(soft,other,'subtract')!; // the zero-coverage pixel is trimmed away
  expect([difference.x,difference.width,...difference.mask!]).toEqual([1,1,150]);
 });

 it('trims empty outer bounds after subtracting an edge',()=>{
  const out=combineSelections(rect(0,0,4,4),rect(0,0,4,2),'subtract')!;
  expect([out.x,out.y,out.width,out.height]).toEqual([0,2,4,2]);
 });

 it('caches the traced outline for a mask',()=>{
  const out=combineSelections(rect(0,0,3,3),rect(5,5,3,3),'add')!;
  expect(maskOutline(out)).toBe(maskOutline(out));
 });

 it('rejects masks beyond the document pixel limit before allocating',()=>{
  expect(()=>combineSelections(rect(0,0,1,1),rect(5000,5000,1,1),'add')).toThrow(/pixel limit/);
 });
});
