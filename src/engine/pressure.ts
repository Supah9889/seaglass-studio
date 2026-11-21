import type {PressurePreferences} from './brushPresets';

export type PointerPressure={pointerType?:string;pressure?:number};
/**
 * SG-15: a pen reporting zero pressure during a stroke is lifting off (pens without pressure
 * support report 0.5 while in contact). Such samples are skipped rather than painted at full
 * strength, which would leave a heavy dab at the end of the stroke.
 */
export function isPenLiftSample(event:PointerPressure|undefined){return event?.pointerType==='pen'&&event.pressure===0;}
/** Treat missing, mouse, zero, and invalid pressure as ordinary full-strength input. */
export function readPenPressure(event:PointerPressure|undefined){if(event?.pointerType!=='pen'||typeof event.pressure!=='number'||!Number.isFinite(event.pressure)||event.pressure<=0||event.pressure>1)return null;return event.pressure;}
export function pressureScale(event:PointerPressure|undefined,prefs:PressurePreferences){const pressure=readPenPressure(event);if(!prefs.enabled||pressure===null)return 1;const response=Math.max(0,Math.min(1,prefs.responseStrength/100)),minimum=Math.max(.05,Math.min(.8,prefs.minimumSize/100)),shaped=1-(1-pressure)*response;return minimum+(1-minimum)*shaped;}
export function smoothPressure(previous:number|null,next:number,factor=.55){if(previous===null)return next;const t=Math.max(0,Math.min(1,factor));return previous+(next-previous)*t;}
export function pressureAdjustments(event:PointerPressure|undefined,prefs:PressurePreferences){const scale=pressureScale(event,prefs);return{sizeScale:prefs.enabled&&prefs.sizeEnabled?scale:1,opacityScale:prefs.enabled&&prefs.opacityEnabled?scale:1};}
/** Coalesced input usually includes the dispatch event; remove a repeated tail sample and always return at least one sample. */
export function coalescedPointerSamples(event:PointerEvent){const samples=Array.from(event.getCoalescedEvents?.()??[]);if(!samples.length)return[event];const last=samples[samples.length-1];if(last.timeStamp!==event.timeStamp||last.clientX!==event.clientX||last.clientY!==event.clientY)samples.push(event);return samples.filter((sample,index)=>index===0||sample.timeStamp!==samples[index-1].timeStamp||sample.clientX!==samples[index-1].clientX||sample.clientY!==samples[index-1].clientY||sample.pressure!==samples[index-1].pressure);}
