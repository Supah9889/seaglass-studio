/**
 * SG-20: holding the middle mouse button pans the canvas with any tool selected.
 * The pan is independent of the active tool and of the canvas gesture system, so it can never
 * start a stroke, a selection or a fill.
 */
export type MiddlePanSession={pointerId:number;lastX:number;lastY:number};
/** The middle button's bit in PointerEvent.buttons. */
const MIDDLE_BUTTON_MASK=4;

/** Only a mouse middle button starts a pan; pens and touch use their own buttons for other things. */
export function isMiddlePanStart(event:{button:number;pointerType?:string}){
 return event.button===1&&(event.pointerType===undefined||event.pointerType===''||event.pointerType==='mouse');
}
export function beginMiddlePan(event:{pointerId:number;clientX:number;clientY:number}):MiddlePanSession{
 return{pointerId:event.pointerId,lastX:event.clientX,lastY:event.clientY};
}
/** False once the middle button is no longer held, even if its pointerup was never delivered. */
export function isMiddleStillHeld(event:{buttons:number}){return (event.buttons&MIDDLE_BUTTON_MASK)!==0;}
/**
 * The screen-pixel movement since the previous sample. Applying it as a delta to the current pan
 * keeps any zoom or fit that happened during the drag instead of overwriting it.
 */
export function middlePanStep(session:MiddlePanSession,event:{clientX:number;clientY:number}){
 const delta={x:event.clientX-session.lastX,y:event.clientY-session.lastY};
 session.lastX=event.clientX;session.lastY=event.clientY;
 return delta;
}
