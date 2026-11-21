import {describe,expect,it} from 'vitest';
import {BRUSH_PREFERENCES_KEY,BRUSH_PREFERENCES_VERSION,BUILT_IN_PRESETS,createCustomPreset,deleteCustomPreset,duplicateBrushPreset,loadBrushPreferences,renameCustomPreset,restoreBuiltInPresets,sameBrushParameters,sameBrushSettings,saveBrushPreferences,settingsFromPreset,updateCustomPreset,type StorageLike} from './brushPresets';

function storage(initial?:string):StorageLike&{data:Map<string,string>}{const data=new Map<string,string>();if(initial)data.set(BRUSH_PREFERENCES_KEY,initial);return{data,getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);}};}
describe('brush preset library and preferences',()=>{
 it('defines thirteen useful built-ins with distinct tools and settings',()=>{expect(BUILT_IN_PRESETS.map(p=>p.name)).toEqual(['Fine Pencil','Sketch Pencil','Smooth Ink','Bold Ink','Soft Airbrush','Hard Airbrush','Gentle Spray','Dense Spray','Fine Splatter','Heavy Splatter','Soft Blender','Strong Smudge','Even Ink']);expect(BUILT_IN_PRESETS.every(p=>p.builtIn)).toBe(true);expect(new Set(BUILT_IN_PRESETS.map(p=>JSON.stringify(p))).size).toBe(13);expect(BUILT_IN_PRESETS[10].blendMode).toBe('blend');expect(BUILT_IN_PRESETS[11].blendMode).toBe('smudge');});
 it('creates, renames, updates, duplicates, and removes custom presets without altering built-ins',()=>{const created=createCustomPreset([...BUILT_IN_PRESETS],'Meghan Ink',BUILT_IN_PRESETS[2],'custom-a'),renamed=renameCustomPreset(created,'custom-a','Meghan Smooth Ink'),edited=updateCustomPreset(renamed,'custom-a',{...settingsFromPreset(BUILT_IN_PRESETS[2]),size:16}),duplicated=duplicateBrushPreset(edited,'custom-a','custom-b');expect(renamed.find(p=>p.id==='custom-a')?.name).toBe('Meghan Smooth Ink');expect(edited.find(p=>p.id==='custom-a')?.size).toBe(16);expect(duplicated.find(p=>p.id==='custom-b')).toMatchObject({name:'Meghan Smooth Ink copy',builtIn:false,tool:'brush',size:16});expect(()=>updateCustomPreset(duplicated,'fine-pencil',settingsFromPreset(BUILT_IN_PRESETS[0]))).toThrow('Built-in');expect(()=>deleteCustomPreset(duplicated,'fine-pencil')).toThrow('Built-in');const deleted=deleteCustomPreset(duplicated,'custom-a');expect(deleted.some(p=>p.id==='custom-a')).toBe(false);expect(deleted.filter(p=>p.builtIn)).toHaveLength(13);expect(()=>createCustomPreset(created,'  ',BUILT_IN_PRESETS[0])).toThrow('cannot be empty');});
 it('marks settings differences instead of mutating a selected preset',()=>{const preset=BUILT_IN_PRESETS[0],edited={...preset,size:preset.size+2};expect(sameBrushSettings(preset,preset)).toBe(true);expect(sameBrushSettings(preset,edited)).toBe(false);expect(preset.size).toBe(5);});
 it('does not mark a preset modified when only the active tool changes',()=>{const preset=settingsFromPreset(BUILT_IN_PRESETS[0]),activeTool={...preset,tool:'blend' as const};expect(sameBrushParameters(activeTool,preset)).toBe(true);expect(sameBrushSettings(activeTool,preset)).toBe(false);expect(sameBrushParameters({...activeTool,size:preset.size+1},preset)).toBe(false);});
 it('persists custom presets, selected preset, current settings, and pressure choices',()=>{const s=storage(),prefs=loadBrushPreferences(s),custom=createCustomPreset(prefs.presets,'Saved airbrush',BUILT_IN_PRESETS[4],'custom-save'),changed={...prefs,presets:custom,selectedPresetId:'custom-save',settings:{...settingsFromPreset(BUILT_IN_PRESETS[4]),size:51},pressure:{...prefs.pressure,enabled:false,opacityEnabled:true}};expect(saveBrushPreferences(s,changed)).toBe(true);expect(loadBrushPreferences(s)).toEqual(changed);});
 it('rejects creation and updates that could not round-trip through preferences',()=>{
  const base=settingsFromPreset(BUILT_IN_PRESETS[2]);
  const presets=createCustomPreset(BUILT_IN_PRESETS,'Saved ink',base,'custom-ink');
  const eraser={...base,tool:'eraser' as const,size:20};
  expect(()=>createCustomPreset(presets,'Eraser',eraser,'custom-eraser')).toThrow('Select a brush');
  expect(()=>updateCustomPreset(presets,'custom-ink',eraser)).toThrow('Select a brush');
  expect(()=>updateCustomPreset(presets,'custom-ink',{...base,size:NaN})).toThrow('cannot be saved');
  expect(presets.find(preset=>preset.id==='custom-ink')).toMatchObject({tool:'brush',size:base.size});
 });
 it('recovers safely from missing, corrupt, outdated, and invalid saved preferences',()=>{expect(loadBrushPreferences(storage()).presets).toHaveLength(13);expect(loadBrushPreferences(storage('{broken')).selectedPresetId).toBe('smooth-ink');const old=storage(JSON.stringify({version:0,presets:[{bad:true}],selectedPresetId:'gone',settings:{tool:'nonsense'},pressure:{minimumSize:1000}})),recovered=loadBrushPreferences(old);expect(recovered.presets).toHaveLength(13);expect(recovered.selectedPresetId).toBe('smooth-ink');expect(recovered.settings.tool).toBe('brush');expect(recovered.pressure.minimumSize).toBe(15);const malformedCurrent=loadBrushPreferences(storage(JSON.stringify({version:BRUSH_PREFERENCES_VERSION,presets:[{bad:true}],selectedPresetId:'gone',settings:{tool:'nonsense'},pressure:{minimumSize:1000}})));expect(malformedCurrent.presets).toHaveLength(13);expect(malformedCurrent.settings.tool).toBe('brush');expect(malformedCurrent.pressure.minimumSize).toBe(80);});
 it('protects built-in names and detects duplicate custom names case-insensitively',()=>{expect(()=>renameCustomPreset([...BUILT_IN_PRESETS],'fine-pencil','New')).toThrow('Built-in');const a=createCustomPreset([...BUILT_IN_PRESETS],'Custom brush',BUILT_IN_PRESETS[0],'custom-a');expect(()=>createCustomPreset(a,'custom BRUSH',BUILT_IN_PRESETS[1])).toThrow('already exists');});
 it('restores original built-in definitions while keeping custom presets',()=>{const modified=BUILT_IN_PRESETS.map(p=>p.id==='fine-pencil'?{...p,size:100}:p),custom=createCustomPreset(modified,'My brush',BUILT_IN_PRESETS[0],'custom-restore'),restored=restoreBuiltInPresets(custom);expect(restored.find(p=>p.id==='fine-pencil')?.size).toBe(5);expect(restored.some(p=>p.id==='custom-restore')).toBe(true);});
 it('does not fail the drawing flow when browser storage throws',()=>{const bad={getItem:()=>{throw Error('storage disabled')},setItem:()=>{throw Error('quota')}} as unknown as StorageLike;expect(loadBrushPreferences(bad).presets).toHaveLength(13);expect(saveBrushPreferences(bad,loadBrushPreferences(storage()))).toBe(false);});
});

describe('SG-15 even dab spacing setting',()=>{
 it('keeps existing presets continuous and adds an opt-in Even Ink preset at the end',()=>{
  expect(BUILT_IN_PRESETS.filter(p=>p.spacing>0).map(p=>p.id)).toEqual(['even-ink']);
  expect(BUILT_IN_PRESETS[BUILT_IN_PRESETS.length-1].id).toBe('even-ink');
  expect(BUILT_IN_PRESETS[2].id).toBe('smooth-ink');
 });
 it('loads saved settings and custom presets from before the spacing field as continuous',()=>{
  const old={...BUILT_IN_PRESETS[2]} as Record<string,unknown>;delete old.spacing;
  const raw=JSON.stringify({version:1,selectedPresetId:'custom-a',settings:old,presets:[{...old,id:'custom-a',name:'Old custom',builtIn:false}],pressure:{enabled:true,sizeEnabled:true,opacityEnabled:false,minimumSize:15,responseStrength:100}});
  const prefs=loadBrushPreferences({getItem:()=>raw,setItem:()=>{}});
  expect(prefs.settings.spacing).toBe(0);
  expect(prefs.presets.find(p=>p.id==='custom-a')?.spacing).toBe(0);
 });
 it('treats spacing as an editable parameter for the modified badge',()=>{
  expect(sameBrushParameters(BUILT_IN_PRESETS[2],{...BUILT_IN_PRESETS[2],spacing:20})).toBe(false);
 });
});
