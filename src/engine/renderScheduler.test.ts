import {describe,expect,it,vi} from 'vitest';
import {RenderScheduler,type FrameApi} from './renderScheduler';

function manualFrames(){
 const queue=new Map<number,()=>void>();let next=1;
 const api:FrameApi={request:callback=>{const id=next++;queue.set(id,callback);return id;},cancel:id=>{queue.delete(id);}};
 const tick=()=>{const callbacks=[...queue.values()];queue.clear();for(const callback of callbacks)callback();};
 return {api,tick,size:()=>queue.size};
}

describe('render scheduler',()=>{
 it('presents many requests in one frame once, using the latest draw',()=>{
  const frames=manualFrames(),scheduler=new RenderScheduler(frames.api),draws:number[]=[];
  for(let i=0;i<5;i++)scheduler.request(()=>draws.push(i));
  expect(frames.size()).toBe(1);
  expect(draws).toEqual([]);
  frames.tick();
  expect(draws).toEqual([4]);
  frames.tick();
  expect(draws).toEqual([4]);
 });

 it('schedules a new frame for requests after a presentation',()=>{
  const frames=manualFrames(),scheduler=new RenderScheduler(frames.api),draw=vi.fn();
  scheduler.request(draw);frames.tick();
  scheduler.request(draw);frames.tick();
  expect(draw).toHaveBeenCalledTimes(2);
 });

 it('flushes queued work synchronously and cancels its frame',()=>{
  const frames=manualFrames(),scheduler=new RenderScheduler(frames.api),draw=vi.fn();
  scheduler.request(draw);
  expect(scheduler.flush()).toBe(true);
  expect(draw).toHaveBeenCalledOnce();
  expect(frames.size()).toBe(0);
  expect(scheduler.flush()).toBe(false);
 });

 it('drops queued work on cancel',()=>{
  const frames=manualFrames(),scheduler=new RenderScheduler(frames.api),draw=vi.fn();
  scheduler.request(draw);
  scheduler.cancel();
  frames.tick();
  expect(draw).not.toHaveBeenCalled();
  expect(scheduler.pending).toBe(false);
 });
});
