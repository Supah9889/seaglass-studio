import {describe,expect,it} from 'vitest';
import {DabSampler,dabSpacing,type Dab} from './strokeSampler';

/** Feed a straight path from (0,0) to (length,0) as `samples` evenly spaced input events. */
function record(length:number,samples:number,spacing:number,pressure=(t:number)=>1){
 const sampler=new DabSampler(spacing),dabs:Dab[]=[...sampler.start(0,0,pressure(0))];
 for(let i=1;i<samples;i++){const t=i/samples;dabs.push(...sampler.add(length*t,0,pressure(t)));}
 dabs.push(...sampler.finish(length,0,pressure(1)));
 return dabs;
}

describe('SG-15 evenly spaced dabs',()=>{
 it('places near-identical dabs for sparse and dense recordings of the same path',()=>{
  const sparse=record(300,4,6),dense=record(300,240,6);
  expect(Math.abs(sparse.length-dense.length)).toBeLessThanOrEqual(1);
  const xs=(dabs:Dab[])=>dabs.map(d=>Math.round(d.x*100)/100);
  expect(xs(sparse).slice(0,-1)).toEqual(xs(dense).slice(0,-1));
  expect(sparse[sparse.length-1].x).toBe(300);
  expect(dense[dense.length-1].x).toBe(300);
 });

 it('keeps regular spacing across samples by carrying the remainder',()=>{
  const dabs=record(100,7,10);
  for(let i=1;i<dabs.length-1;i++)expect(dabs[i].x-dabs[i-1].x).toBeCloseTo(10,6);
 });

 it('produces exactly one dab for a tap',()=>{
  const sampler=new DabSampler(5);
  expect(sampler.start(40,40,.3)).toEqual([{x:40,y:40,pressure:.3}]);
  expect(sampler.finish(40,40,.3)).toEqual([]);
 });

 it('flushes a final dab at the real end point, with its real pressure',()=>{
  const sampler=new DabSampler(10);
  sampler.start(0,0,1);
  sampler.add(14,0,1);
  const end=sampler.finish(18,0,.2);
  expect(end[end.length-1]).toEqual({x:18,y:0,pressure:.2});
 });

 it('does not double-deposit when the last dab already sits near the end',()=>{
  const sampler=new DabSampler(10);
  sampler.start(0,0,1);
  expect(sampler.finish(11,0,1)).toEqual([{x:10,y:0,pressure:1}]);
 });

 it('interpolates pressure by distance along a segment',()=>{
  const sampler=new DabSampler(25);
  sampler.start(0,0,0);
  const dabs=sampler.add(100,0,1);
  expect(dabs.map(d=>d.pressure)).toEqual([.25,.5,.75,1]);
 });

 it('derives spacing from the brush diameter and clamps it to a usable range',()=>{
  expect(dabSpacing(40,25)).toBe(10);
  expect(dabSpacing(1,1)).toBe(.5);
  expect(dabSpacing(40,500)).toBe(40);
  expect(()=>new DabSampler(0)).toThrow(RangeError);
 });
});
