export type HSV={h:number;s:number;v:number};
export type RGB={r:number;g:number;b:number};
const clamp=(x:number,min:number,max:number)=>Math.max(min,Math.min(max,x));
export function normalizeHex(input:string):string|null{const raw=input.trim().replace(/^#/,'');if(!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(raw))return null;const full=raw.length===3?raw.split('').map(x=>x+x).join(''):raw;return`#${full.toLowerCase()}`;}
export function hexToRgb(hex:string):RGB|null{const value=normalizeHex(hex);if(!value)return null;return{r:parseInt(value.slice(1,3),16),g:parseInt(value.slice(3,5),16),b:parseInt(value.slice(5,7),16)};}
export function rgbToHex({r,g,b}:RGB):string|null{if(![r,g,b].every(Number.isFinite)||[r,g,b].some(x=>x<0||x>255))return null;return`#${[r,g,b].map(x=>Math.round(x).toString(16).padStart(2,'0')).join('')}`;}
export function rgbToHsv(rgb:RGB):HSV{const r=rgb.r/255,g=rgb.g/255,b=rgb.b/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;if(d){if(max===r)h=60*(((g-b)/d)%6);else if(max===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4);}return{h:(h+360)%360,s:max===0?0:d/max,v:max};}
export function hsvToRgb({h,s,v}:HSV):RGB|null{if(![h,s,v].every(Number.isFinite)||s<0||s>1||v<0||v>1)return null;const hue=((h%360)+360)%360,c=v*s,x=c*(1-Math.abs((hue/60)%2-1)),m=v-c;let q:RGB;if(hue<60)q={r:c,g:x,b:0};else if(hue<120)q={r:x,g:c,b:0};else if(hue<180)q={r:0,g:c,b:x};else if(hue<240)q={r:0,g:x,b:c};else if(hue<300)q={r:x,g:0,b:c};else q={r:c,g:0,b:x};return{r:Math.round((q.r+m)*255),g:Math.round((q.g+m)*255),b:Math.round((q.b+m)*255)};}
export function hsvToHex(hsv:HSV){const rgb=hsvToRgb(hsv);return rgb?rgbToHex(rgb):null;}
export function hexToHsv(hex:string){const rgb=hexToRgb(hex);return rgb?rgbToHsv(rgb):null;}
export type WheelPoint={zone:'hue'|'sv'|'outside';hue:number;saturation:number;value:number};
/** Coordinates are relative to a square wheel; hue follows clockwise CSS conic order. */
export function mapWheelPoint(x:number,y:number,size:number,current:HSV):WheelPoint{if(size<=0)return{zone:'outside',hue:current.h,saturation:current.s,value:current.v};const nx=x/size-.5,ny=y/size-.5,r=Math.hypot(nx,ny),hue=(Math.atan2(ny,nx)*180/Math.PI+360)%360,left=.25,right=.75,saturation: number=clamp((nx+.5-left)/(right-left),0,1),value=1-clamp((ny+.5-left)/(right-left),0,1);if(r>=.36&&r<=.5)return{zone:'hue',hue,saturation:current.s,value:current.v};if(nx+.5>=left&&nx+.5<=right&&ny+.5>=left&&ny+.5<=right)return{zone:'sv',hue:current.h,saturation,value};return{zone:'outside',hue,saturation,value};}
export function parseRgbInput(r:string,g:string,b:string){const values=[r,g,b].map(x=>x.trim()===''?NaN:Number(x));if(!values.every(Number.isInteger)||values.some(x=>x<0||x>255))return null;return rgbToHex({r:values[0],g:values[1],b:values[2]});}
export function parseHsvInput(h:string,s:string,v:string){const values=[h,s,v].map(Number);if(!values.every(Number.isFinite)||values[0]<0||values[0]>360||values[1]<0||values[1]>100||values[2]<0||values[2]>100)return null;return hsvToHex({h:values[0],s:values[1]/100,v:values[2]/100});}
export function swapColorSlots(primary:string,secondary:string,active:'primary'|'secondary'){return{primary:secondary,secondary:primary,activeColor:active==='primary'?secondary:primary};}
export function defaultColorSlots(){return{primary:'#000000',secondary:'#ffffff'};}
