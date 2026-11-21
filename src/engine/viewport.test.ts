import {describe,expect,it} from 'vitest';
import {resolveViewportMode,snapViewportTranslation} from './viewport';

describe('viewport display quality',()=>{
 it('selects sharp automatically at 200% and above while retaining smooth below',()=>{
  expect([.25,.5,1,1.99,2,4,8].map(z=>resolveViewportMode('auto',z))).toEqual(['smooth','smooth','smooth','smooth','sharp','sharp','sharp']);
 });
 it('honors explicit display-mode overrides at every zoom',()=>{
  expect(resolveViewportMode('sharp',.5)).toBe('sharp');expect(resolveViewportMode('smooth',8)).toBe('smooth');
 });
 it('snaps the translated canvas origin to physical pixels without changing zoom',()=>{
  expect(snapViewportTranslation(3.17,100.2,1)).toBeCloseTo(2.8);expect(snapViewportTranslation(-1.1,20.25,2)).toBeCloseTo(-1.25);
 });
});
