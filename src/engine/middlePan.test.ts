import {describe,expect,it} from 'vitest';
import {beginMiddlePan,isMiddlePanStart,isMiddleStillHeld,middlePanStep} from './middlePan';

describe('middle-mouse panning',()=>{
 it('starts only for the middle button of a mouse',()=>{
  expect(isMiddlePanStart({button:1,pointerType:'mouse'})).toBe(true);
  expect(isMiddlePanStart({button:1})).toBe(true);
  expect(isMiddlePanStart({button:0,pointerType:'mouse'})).toBe(false);
  expect(isMiddlePanStart({button:2,pointerType:'mouse'})).toBe(false);
  // A pen barrel button or a touch contact must never be mistaken for a pan.
  expect(isMiddlePanStart({button:1,pointerType:'pen'})).toBe(false);
  expect(isMiddlePanStart({button:1,pointerType:'touch'})).toBe(false);
 });
 it('moves the viewport by the pointer movement between samples',()=>{
  const session=beginMiddlePan({pointerId:3,clientX:100,clientY:200});
  expect(middlePanStep(session,{clientX:100,clientY:200})).toEqual({x:0,y:0});
  expect(middlePanStep(session,{clientX:160,clientY:150})).toEqual({x:60,y:-50});
  expect(middlePanStep(session,{clientX:150,clientY:150})).toEqual({x:-10,y:0});
 });
 it('applies deltas so a zoom during the drag is kept rather than overwritten',()=>{
  const session=beginMiddlePan({pointerId:1,clientX:0,clientY:0});
  let pan={x:0,y:0};
  const step=(x:number,y:number)=>{const d=middlePanStep(session,{clientX:x,clientY:y});pan={x:pan.x+d.x,y:pan.y+d.y};};
  step(50,0);
  pan={x:-300,y:120}; // wheel zoom anchors a new pan mid-drag
  step(60,5);
  expect(pan).toEqual({x:-290,y:125});
 });
 it('detects a released middle button from the buttons mask',()=>{
  expect(isMiddleStillHeld({buttons:4})).toBe(true);
  expect(isMiddleStillHeld({buttons:5})).toBe(true);
  expect(isMiddleStillHeld({buttons:1})).toBe(false);
  expect(isMiddleStillHeld({buttons:0})).toBe(false);
 });
});
