import {describe,expect,it} from 'vitest';
import {DEFAULT_PRESSURE} from './brushPresets';
import {coalescedPointerSamples,pressureAdjustments,pressureScale,readPenPressure,smoothPressure} from './pressure';

describe('tablet pressure mapping',()=>{
 it('falls back to full-strength mouse behavior when pressure is absent or unusable',()=>{for(const e of [undefined,{}, {pointerType:'mouse',pressure:.05},{pointerType:'pen',pressure:0},{pointerType:'pen',pressure:NaN},{pointerType:'pen',pressure:2}])expect(pressureAdjustments(e,DEFAULT_PRESSURE)).toEqual({sizeScale:1,opacityScale:1});expect(readPenPressure({pointerType:'pen',pressure:.25})).toBe(.25);});
 it('maps light pressure to a thinner stroke and heavy pressure to a larger stroke',()=>{const light=pressureScale({pointerType:'pen',pressure:.1},DEFAULT_PRESSURE),heavy=pressureScale({pointerType:'pen',pressure:.9},DEFAULT_PRESSURE);expect(light).toBeCloseTo(.235);expect(heavy).toBeCloseTo(.915);expect(heavy).toBeGreaterThan(light);});
 it('supports independent pressure size and opacity options',()=>{const e={pointerType:'pen',pressure:.4};expect(pressureAdjustments(e,{...DEFAULT_PRESSURE,sizeEnabled:false})).toEqual({sizeScale:1,opacityScale:1});expect(pressureAdjustments(e,{...DEFAULT_PRESSURE,opacityEnabled:true})).toMatchObject({sizeScale:.49,opacityScale:.49});expect(pressureAdjustments(e,{...DEFAULT_PRESSURE,enabled:false,opacityEnabled:true})).toEqual({sizeScale:1,opacityScale:1});});
 it('allows zero response strength and smooths transitions without jumps',()=>{expect(pressureScale({pointerType:'pen',pressure:.1},{...DEFAULT_PRESSURE,responseStrength:0})).toBe(1);expect(smoothPressure(null,.2)).toBe(.2);expect(smoothPressure(.2,.8,.5)).toBe(.5);});
 it('uses coalesced pointer samples once and falls back to the dispatch event',()=>{const a={timeStamp:1,clientX:1,clientY:1,pressure:.2},b={timeStamp:2,clientX:2,clientY:2,pressure:.8},event={...b,getCoalescedEvents:()=>[a,b]} as unknown as PointerEvent;expect(coalescedPointerSamples(event)).toHaveLength(2);const empty={...a,getCoalescedEvents:()=>[]} as unknown as PointerEvent;expect(coalescedPointerSamples(empty)).toEqual([empty]);});
});

describe('SG-15 pen lift samples',()=>{
 it('identifies zero-pressure pen samples as lift-off, not as full-strength input',async()=>{
  const {isPenLiftSample}=await import('./pressure');
  expect(isPenLiftSample({pointerType:'pen',pressure:0})).toBe(true);
  expect(isPenLiftSample({pointerType:'pen',pressure:.5})).toBe(false);
  expect(isPenLiftSample({pointerType:'mouse',pressure:0})).toBe(false);
  expect(isPenLiftSample({pointerType:'touch',pressure:0})).toBe(false);
  expect(isPenLiftSample(undefined)).toBe(false);
 });
});
