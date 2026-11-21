/**
 * SG-08: opt-in, in-app performance counters for benchmarks.
 *
 * Disabled unless a benchmark sets `globalThis.__seaglassPerf = true`. When disabled each
 * call is a single property check, so ordinary editing pays no measurable cost.
 */
type PerfGlobal={__seaglassPerf?:boolean};

const state={
 composites:0,
 compositeMs:[] as number[],
 renders:0,
 frame:0,
 compositesByFrame:new Map<number,number>(),
 frameLoop:false,
};

export const perfEnabled=()=>(globalThis as PerfGlobal).__seaglassPerf===true;

function ensureFrameLoop(){
 if(state.frameLoop||typeof requestAnimationFrame!=='function')return;
 state.frameLoop=true;
 const tick=()=>{
  if(!perfEnabled()){state.frameLoop=false;return;}
  state.frame++;
  requestAnimationFrame(tick);
 };
 requestAnimationFrame(tick);
}

/** Time one presentation composite and attribute it to the current animation frame. */
export function measureComposite<T>(work:()=>T):T{
 if(!perfEnabled())return work();
 ensureFrameLoop();
 const start=performance.now();
 try{return work();}
 finally{
  state.composites++;
  state.compositeMs.push(performance.now()-start);
  state.compositesByFrame.set(state.frame,(state.compositesByFrame.get(state.frame)??0)+1);
 }
}

/** Count one React render of the editor shell. */
export function countRender(){if(perfEnabled())state.renders++;}

export function resetPerf(){
 state.composites=0;state.compositeMs=[];state.renders=0;state.compositesByFrame.clear();
 ensureFrameLoop();
}

const percentile=(values:number[],p:number)=>{
 if(!values.length)return 0;
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)];
};

export function perfSnapshot(){
 const perFrame=[...state.compositesByFrame.values()];
 return {
  composites:state.composites,
  compositeMsTotal:state.compositeMs.reduce((sum,ms)=>sum+ms,0),
  compositeMsMedian:percentile(state.compositeMs,.5),
  compositeMsP95:percentile(state.compositeMs,.95),
  framesWithComposite:perFrame.length,
  maxCompositesPerFrame:perFrame.length?Math.max(...perFrame):0,
  renders:state.renders,
 };
}
