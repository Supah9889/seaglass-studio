import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const styles=readFileSync('src/ui/theme.css','utf8');
const app=readFileSync('src/ui/App.tsx','utf8');

describe('viewport-constrained workspace layout',()=>{
 it('locks page scrolling and sizes the app to the dynamic browser viewport',()=>{
  expect(styles).toMatch(/html,body,#root\{width:100%;height:100%;overflow:hidden\}/);
  expect(styles).toMatch(/\.app-shell\{[^}]*height:100vh;height:100dvh;min-height:0;overflow:hidden/);
 });
 it('keeps inspector and toolrail independently scrollable',()=>{
  expect(styles).toMatch(/\.toolrail\{overflow-y:auto;overscroll-behavior:contain/);
  expect(styles).toMatch(/\.inspector\{overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain/);
 });
 it('preserves dock preferences while providing a narrow-screen stacked workspace',()=>{
  expect(styles).toContain('html[data-dock="left"] .workspace,html[data-dock="right"] .workspace,html[data-dock="top"] .workspace');
  expect(styles).toContain('@media(max-width:680px)');
  expect(styles).toContain('grid-template-rows:42px minmax(100px,1fr) minmax(110px,24dvh)');
  expect(styles).toContain('@media(max-height:560px) and (min-width:681px)');
 });
 it('handles non-passive wheel zoom at the full stage, including empty canvas margins',()=>{
  expect(app).toContain("element.addEventListener('wheel',handleWheel,{passive:false})");
  expect(app).toContain('e.preventDefault();zoomAt(e.clientX,e.clientY');
  expect(app).toContain('<div className="stage" ref={stage} data-display-revision={displayTick}');
  // SG-20: the stage owns middle-button panning and suppresses browser autoscroll.
  expect(app).toContain('onPointerDownCapture={startMiddlePan}');
  expect(app).toContain("imageRendering:viewportMode==='sharp'?'pixelated':'auto'");
  expect(app).toContain('Math.min(8,z*1.2)');
  expect(app).toContain('Canvas display quality');
 });
});
