/**
 * SG-09: present the canvas at most once per animation frame.
 *
 * Hot paths (brush moves, timed spray, move previews) update the document immediately but
 * only *request* a presentation. The latest request in a frame wins, so many input samples
 * cost one composite. `flush()` presents synchronously for discrete actions and readers that
 * need the canvas now; `cancel()` drops pending work when a session or document ends.
 */
export type FrameApi={request:(callback:()=>void)=>number;cancel:(handle:number)=>void};

const browserFrames:FrameApi={
 request:callback=>requestAnimationFrame(callback),
 cancel:handle=>cancelAnimationFrame(handle),
};

export class RenderScheduler{
 private handle:number|undefined;
 private work:(()=>void)|undefined;

 constructor(private readonly frames:FrameApi=browserFrames){}

 /** Queue `draw` for the next frame, replacing any draw already queued for it. */
 request(draw:()=>void){
  this.work=draw;
  if(this.handle===undefined)this.handle=this.frames.request(()=>{this.handle=undefined;this.run();});
 }

 /** Present queued work now, if any. Returns whether anything ran. */
 flush(){
  if(this.handle!==undefined){this.frames.cancel(this.handle);this.handle=undefined;}
  return this.run();
 }

 /** Drop queued work without presenting it. */
 cancel(){
  if(this.handle!==undefined){this.frames.cancel(this.handle);this.handle=undefined;}
  this.work=undefined;
 }

 get pending(){return this.work!==undefined;}

 private run(){
  const work=this.work;
  this.work=undefined;
  if(!work)return false;
  work();
  return true;
 }
}
