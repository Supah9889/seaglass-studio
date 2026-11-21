import {PanelRightClose,PanelRightOpen,SlidersHorizontal} from 'lucide-react';
import {EFFECT_KINDS,defaultEffect,isNeutralEffect,type EffectKind,type EffectSettings} from '../engine/effects';

type Props={
 collapsed:boolean;
 settings:EffectSettings;
 /** Why effects cannot run right now (hidden or locked layer, staged transform…), or null. */
 blockedReason:string|null;
 previewing:boolean;
 hasSelection:boolean;
 onChange:(settings:EffectSettings)=>void;
 onApply:()=>void;
 onCancel:()=>void;
};

/** SG-13: Brightness/Contrast and Grayscale for the active layer, with a staged preview. */
export function EffectsPanel({collapsed,settings,blockedReason,previewing,hasSelection,onChange,onApply,onCancel}:Props){
 const neutral=isNeutralEffect(settings);
 const range=(label:string,value:number,min:number,max:number,update:(value:number)=>EffectSettings)=><>
  <label className="control-label">{label} <b>{value}</b></label>
  <input aria-label={label} type="range" min={min} max={max} value={value} disabled={!!blockedReason} onChange={e=>onChange(update(Number(e.target.value)))}/>
 </>;
 return <section className="panel glass" data-panel="effects" data-collapsed={collapsed}>
  <div className="panel-title"><span><SlidersHorizontal size={16}/> Layer effects</span><button className="collapse-panel" data-panel-toggle="effects" aria-expanded={!collapsed} title={collapsed?'Expand layer effects':'Collapse layer effects'} aria-label={collapsed?'Expand layer effects':'Collapse layer effects'}>{collapsed?<PanelRightOpen size={14}/>:<PanelRightClose size={14}/>}</button></div>
  <label className="control-label" htmlFor="effect-kind">Effect</label>
  <select id="effect-kind" value={settings.kind} disabled={!!blockedReason} onChange={e=>onChange(defaultEffect(e.target.value as EffectKind))}>
   {EFFECT_KINDS.map(kind=><option key={kind.value} value={kind.value}>{kind.label}</option>)}
  </select>
  {settings.kind==='brightness-contrast'
   ?<>{range('Brightness',settings.brightness,-100,100,brightness=>({...settings,brightness}))}{range('Contrast',settings.contrast,-100,100,contrast=>({...settings,contrast}))}</>
   :range('Amount',settings.amount,0,100,amount=>({...settings,amount}))}
  <small className="control-hint" role="status">{blockedReason??(neutral?'Move a slider to preview the effect. ':'')+(hasSelection?'Applies to the selected pixels of the active layer.':'Applies to the whole active layer.')+(previewing?' Previewing — Apply to keep it.':'')}</small>
  <div className="selection-actions">
   <button onClick={onApply} disabled={!!blockedReason||neutral} title="Apply the effect as one undoable edit">Apply</button>
   <button onClick={onCancel} disabled={!previewing&&neutral} title="Discard the preview and reset the settings">Cancel</button>
  </div>
 </section>;
}
