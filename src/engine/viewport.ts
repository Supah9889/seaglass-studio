export type ViewportPreference='auto'|'sharp'|'smooth';
export type ViewportMode='sharp'|'smooth';

/** Resolve a display-only interpolation preference. Document pixels are untouched. */
export function resolveViewportMode(preference:ViewportPreference,zoom:number):ViewportMode{
 return preference==='sharp'||preference==='smooth'?preference:zoom>=2?'sharp':'smooth';
}

/** Snap a translated canvas origin to a physical display pixel in sharp mode. */
export function snapViewportTranslation(translation:number,canvasOrigin:number,devicePixelRatio=1):number{
 const scale=Number.isFinite(devicePixelRatio)&&devicePixelRatio>0?devicePixelRatio:1;
 return translation+(Math.round((canvasOrigin+translation)*scale)/scale-(canvasOrigin+translation));
}
