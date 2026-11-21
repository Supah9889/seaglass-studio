import {describe,expect,it} from 'vitest';
import {applyEffect,changedSpans,isNeutralEffect,normalizeEffect} from './effects';

const px=(...pixels:number[][])=>new Uint8ClampedArray(pixels.flat());

describe('local layer effects',()=>{
 it('is an exact identity at neutral settings',()=>{
  const data=px([12,34,56,255],[200,100,50,128]);
  expect(applyEffect(data,2,{kind:'brightness-contrast',brightness:0,contrast:0})).toBe(0);
  expect([...data]).toEqual([12,34,56,255,200,100,50,128]);
  expect(isNeutralEffect({kind:'grayscale',amount:0})).toBe(true);
 });

 it('clamps parameters to their supported ranges',()=>{
  expect(normalizeEffect({kind:'brightness-contrast',brightness:500,contrast:-Infinity})).toEqual({kind:'brightness-contrast',brightness:100,contrast:0});
  expect(normalizeEffect({kind:'grayscale',amount:-5})).toEqual({kind:'grayscale',amount:0});
 });

 it('brightens and clamps channels without touching alpha',()=>{
  const data=px([100,250,0,200]);
  applyEffect(data,1,{kind:'brightness-contrast',brightness:20,contrast:0});
  expect([...data]).toEqual([151,255,51,200]);
 });

 it('increases contrast around mid-gray and leaves mid-gray fixed',()=>{
  const data=px([128,64,192,255]);
  applyEffect(data,1,{kind:'brightness-contrast',brightness:0,contrast:50});
  expect(data[0]).toBe(128);
  expect(data[1]).toBeLessThan(64);
  expect(data[2]).toBeGreaterThan(192);
  expect(data[3]).toBe(255);
 });

 it('converts to Rec. 709 luminance and keeps neutral grays unchanged',()=>{
  const data=px([255,0,0,255],[90,90,90,77]);
  applyEffect(data,2,{kind:'grayscale',amount:100});
  expect([...data.slice(0,4)]).toEqual([54,54,54,255]);
  expect([...data.slice(4)]).toEqual([90,90,90,77]);
 });

 it('keeps fully transparent pixels byte-identical',()=>{
  const data=px([10,200,30,0]);
  applyEffect(data,1,{kind:'grayscale',amount:100});
  expect([...data]).toEqual([10,200,30,0]);
 });

 it('leaves pixels outside the selection untouched and blends partial coverage',()=>{
  const data=px([255,0,0,255],[255,0,0,255],[255,0,0,255]);
  // Buffer origin (10,0); coverage covers x=11 fully and x=12 at half.
  applyEffect(data,3,{kind:'grayscale',amount:100},{x:11,y:0,width:2,height:1,mask:new Uint8Array([255,128])},10,0);
  expect([...data.slice(0,4)]).toEqual([255,0,0,255]);
  expect([...data.slice(4,8)]).toEqual([54,54,54,255]);
  expect([...data.slice(8,12)]).toEqual([154,27,27,255]);
 });

 it('finds only the rows and runs of pixels that changed, so unchanged pixels are never rewritten',()=>{
  const before=px([1,1,1,255],[2,2,2,128],[3,3,3,255],[4,4,4,255]);
  const after=new Uint8ClampedArray(before);after[0]=9;after[8]=9;after[12]=9;
  // 2×2 buffer: row 0 changes at x=0 only; row 1 changes at x=0..1.
  expect(changedSpans(before,after,2)).toEqual([{x:0,y:0,width:1},{x:0,y:1,width:2}]);
 });
});
