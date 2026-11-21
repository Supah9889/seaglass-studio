import type {BlendMode} from './blend';
import type {Tool} from './paint';

export type BrushSettings={tool:Tool;size:number;opacity:number;density:number;softness:number;flow:number;dropletSize:number;blendMode:BlendMode;blendStrength:number;blendSoftness:number;stabilization:number;
 /** SG-15: even dab spacing as a percentage of the diameter; 0 keeps the continuous stroke. */
 spacing:number};
export type BrushPreset=BrushSettings&{id:string;name:string;builtIn:boolean};
export type PressurePreferences={enabled:boolean;sizeEnabled:boolean;opacityEnabled:boolean;minimumSize:number;responseStrength:number};
export type BrushPreferences={presets:BrushPreset[];selectedPresetId:string;settings:BrushSettings;pressure:PressurePreferences};
export type StorageLike=Pick<Storage,'getItem'|'setItem'>;
export const BRUSH_PREFERENCES_KEY='seaglass-brush-preferences-v1';
export const BRUSH_PREFERENCES_VERSION=1;

const setting=(tool:Tool,size:number,opacity=1,extra:Partial<BrushSettings>={}):BrushSettings=>({tool,size,opacity,density:18,softness:75,flow:18,dropletSize:6,blendMode:'smudge',blendStrength:55,blendSoftness:60,stabilization:0,spacing:0,...extra});
export const BUILT_IN_PRESETS:BrushPreset[]=[
 {id:'fine-pencil',name:'Fine Pencil',builtIn:true,...setting('pencil',5,.82,{stabilization:12})},
 {id:'sketch-pencil',name:'Sketch Pencil',builtIn:true,...setting('pencil',18,.34,{stabilization:5})},
 {id:'smooth-ink',name:'Smooth Ink',builtIn:true,...setting('brush',7,1,{stabilization:28})},
 {id:'bold-ink',name:'Bold Ink',builtIn:true,...setting('brush',24,1,{stabilization:35})},
 {id:'soft-airbrush',name:'Soft Airbrush',builtIn:true,...setting('softAirbrush',72,.34,{softness:92,flow:22})},
 {id:'hard-airbrush',name:'Hard Airbrush',builtIn:true,...setting('softAirbrush',32,.82,{softness:24,flow:46})},
 {id:'gentle-spray',name:'Gentle Spray',builtIn:true,...setting('spray',54,.5,{density:8})},
 {id:'dense-spray',name:'Dense Spray',builtIn:true,...setting('spray',46,.82,{density:64})},
 {id:'fine-splatter',name:'Fine Splatter',builtIn:true,...setting('splatter',34,.78,{density:12,dropletSize:2})},
 {id:'heavy-splatter',name:'Heavy Splatter',builtIn:true,...setting('splatter',74,.9,{density:42,dropletSize:18})},
 {id:'soft-blender',name:'Soft Blender',builtIn:true,...setting('blend',42,1,{blendMode:'blend',blendStrength:34,blendSoftness:88})},
 {id:'strong-smudge',name:'Strong Smudge',builtIn:true,...setting('blend',30,1,{blendMode:'smudge',blendStrength:88,blendSoftness:55})},
 // Appended so existing preset positions and IDs stay unchanged.
 {id:'even-ink',name:'Even Ink',builtIn:true,...setting('brush',10,1,{stabilization:20,spacing:20})},
];
export const DEFAULT_PRESSURE:PressurePreferences={enabled:true,sizeEnabled:true,opacityEnabled:false,minimumSize:15,responseStrength:100};
export const DEFAULT_BRUSH_SETTINGS=BUILT_IN_PRESETS[2];

const supportedTools:Tool[]=['brush','pencil','softAirbrush','spray','splatter','blend'];
export const canStoreBrushPreset=(tool:Tool)=>supportedTools.includes(tool);
export const BRUSH_PRESET_TOOL_HINT='Select a brush, pencil, airbrush, spray, splatter, or blender to save a preset.';
function cleanSettings(value:unknown):BrushSettings|null{
 if(!value||typeof value!=='object')return null;const v=value as Partial<BrushSettings>;
 if(!canStoreBrushPreset(v.tool as Tool)||![v.size,v.opacity,v.density,v.softness,v.flow,v.dropletSize,v.blendStrength,v.blendSoftness,v.stabilization].every(Number.isFinite)||!['smudge','blend','soften'].includes(v.blendMode as string))return null;
 return{tool:v.tool as Tool,size:clamp(v.size!,1,120),opacity:clamp(v.opacity!,0,1),density:clamp(v.density!,1,80),softness:clamp(v.softness!,0,100),flow:clamp(v.flow!,1,100),dropletSize:clamp(v.dropletSize!,1,30),blendMode:v.blendMode as BlendMode,blendStrength:clamp(v.blendStrength!,0,100),blendSoftness:clamp(v.blendSoftness!,0,100),stabilization:clamp(v.stabilization!,0,95),spacing:Number.isFinite(v.spacing)&&v.spacing!>0?clamp(v.spacing!,5,100):0};
}
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
function validCustom(value:unknown):BrushPreset|null{if(!value||typeof value!=='object')return null;const v=value as Partial<BrushPreset>,settings=cleanSettings(v);if(typeof v.id!=='string'||!v.id.startsWith('custom-')||typeof v.name!=='string'||!v.name.trim()||!settings)return null;return{id:v.id,name:v.name.trim(),builtIn:false,...settings};}
export function sameBrushSettings(a:BrushSettings,b:BrushSettings){return(a as BrushSettings).tool===b.tool&&a.size===b.size&&a.opacity===b.opacity&&a.density===b.density&&a.softness===b.softness&&a.flow===b.flow&&a.dropletSize===b.dropletSize&&a.blendMode===b.blendMode&&a.blendStrength===b.blendStrength&&a.blendSoftness===b.blendSoftness&&a.stabilization===b.stabilization&&(a.spacing??0)===(b.spacing??0);}
/** Compare editable brush parameters while ignoring the currently active toolbar tool. */
export function sameBrushParameters(a:BrushSettings,b:BrushSettings){return a.size===b.size&&a.opacity===b.opacity&&a.density===b.density&&a.softness===b.softness&&a.flow===b.flow&&a.dropletSize===b.dropletSize&&a.blendMode===b.blendMode&&a.blendStrength===b.blendStrength&&a.blendSoftness===b.blendSoftness&&a.stabilization===b.stabilization&&(a.spacing??0)===(b.spacing??0);}
export function settingsFromPreset(preset:BrushPreset):BrushSettings{return{tool:preset.tool,size:preset.size,opacity:preset.opacity,density:preset.density,softness:preset.softness,flow:preset.flow,dropletSize:preset.dropletSize,blendMode:preset.blendMode,blendStrength:preset.blendStrength,blendSoftness:preset.blendSoftness,stabilization:preset.stabilization,spacing:preset.spacing??0};}
export function loadBrushPreferences(storage:StorageLike):BrushPreferences{
 try{const raw=storage.getItem(BRUSH_PREFERENCES_KEY);if(!raw)return defaults();const value=JSON.parse(raw) as Partial<BrushPreferences>&{version?:number};if(value.version!==BRUSH_PREFERENCES_VERSION)return defaults();const custom=(Array.isArray(value.presets)?value.presets.map(validCustom).filter((p):p is BrushPreset=>!!p):[]).slice(0,100),presets=[...BUILT_IN_PRESETS,...custom],settings=cleanSettings(value.settings)??{...DEFAULT_BRUSH_SETTINGS},pressureRaw=value.pressure as Partial<PressurePreferences>|undefined,pressure:PressurePreferences={enabled:typeof pressureRaw?.enabled==='boolean'?pressureRaw.enabled:DEFAULT_PRESSURE.enabled,sizeEnabled:typeof pressureRaw?.sizeEnabled==='boolean'?pressureRaw.sizeEnabled:DEFAULT_PRESSURE.sizeEnabled,opacityEnabled:typeof pressureRaw?.opacityEnabled==='boolean'?pressureRaw.opacityEnabled:DEFAULT_PRESSURE.opacityEnabled,minimumSize:typeof pressureRaw?.minimumSize==='number'?clamp(pressureRaw.minimumSize,5,80):DEFAULT_PRESSURE.minimumSize,responseStrength:typeof pressureRaw?.responseStrength==='number'?clamp(pressureRaw.responseStrength,0,100):DEFAULT_PRESSURE.responseStrength};const selected=presets.some(p=>p.id===value.selectedPresetId)?value.selectedPresetId!:BUILT_IN_PRESETS[2].id;return{presets,selectedPresetId:selected,settings,pressure};}catch{return defaults();}
}
function defaults():BrushPreferences{return{presets:[...BUILT_IN_PRESETS],selectedPresetId:DEFAULT_BRUSH_SETTINGS.id,settings:{...DEFAULT_BRUSH_SETTINGS},pressure:{...DEFAULT_PRESSURE}};}
export function saveBrushPreferences(storage:StorageLike,prefs:BrushPreferences){try{storage.setItem(BRUSH_PREFERENCES_KEY,JSON.stringify({...prefs,version:BRUSH_PREFERENCES_VERSION,presets:prefs.presets.filter(p=>!p.builtIn)}));return true;}catch{return false;}}
function checkedPresetSettings(settings:BrushSettings){
 if(!canStoreBrushPreset(settings.tool))throw new Error(BRUSH_PRESET_TOOL_HINT);
 const cleaned=cleanSettings(settings);
 if(!cleaned)throw new Error('The current brush settings cannot be saved.');
 return cleaned;
}
export function createCustomPreset(presets:BrushPreset[],name:string,settings:BrushSettings,id=`custom-${crypto.randomUUID()}`):BrushPreset[]{const clean=name.trim();if(!clean)throw new Error('Preset name cannot be empty.');if(presets.some(p=>p.name.toLowerCase()===clean.toLowerCase()))throw new Error('A preset with that name already exists.');return[...presets,{...checkedPresetSettings(settings),id,name:clean,builtIn:false}];}
export function renameCustomPreset(presets:BrushPreset[],id:string,name:string){const clean=name.trim(),target=presets.find(p=>p.id===id);if(!target||target.builtIn)throw new Error('Built-in presets cannot be renamed.');if(!clean)throw new Error('Preset name cannot be empty.');if(presets.some(p=>p.id!==id&&p.name.toLowerCase()===clean.toLowerCase()))throw new Error('A preset with that name already exists.');return presets.map(p=>p.id===id?{...p,name:clean}:p);}
export function updateCustomPreset(presets:BrushPreset[],id:string,settings:BrushSettings){const target=presets.find(p=>p.id===id);if(!target||target.builtIn)throw new Error('Built-in presets cannot be changed.');const checked=checkedPresetSettings(settings);return presets.map(p=>p.id===id?{...p,...checked}:p);}
export function duplicateBrushPreset(presets:BrushPreset[],id:string,newId=`custom-${crypto.randomUUID()}`){const source=presets.find(p=>p.id===id);if(!source)throw new Error('Preset not found.');let name=`${source.name} copy`,n=2;while(presets.some(p=>p.name.toLowerCase()===name.toLowerCase()))name=`${source.name} copy ${n++}`;return[...presets,{...source,id:newId,name,builtIn:false}];}
export function deleteCustomPreset(presets:BrushPreset[],id:string){const target=presets.find(p=>p.id===id);if(!target)return presets;if(target.builtIn)throw new Error('Built-in presets cannot be deleted.');return presets.filter(p=>p.id!==id);}
export function restoreBuiltInPresets(presets:BrushPreset[]){return[...BUILT_IN_PRESETS,...presets.filter(p=>!p.builtIn)];}
