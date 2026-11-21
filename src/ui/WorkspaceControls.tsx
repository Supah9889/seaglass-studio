import {ChevronDown,ChevronUp,Pin} from 'lucide-react';
import {useState} from 'react';
import {PANEL_NAMES,type PanelId} from '../engine/workspacePreferences';

type Props={
 order:PanelId[];
 pinned:PanelId[];
 onNavigate:(id:PanelId)=>void;
 onPin:(id:PanelId)=>void;
 onMove:(id:PanelId,direction:-1|1)=>void;
};

export function WorkspaceControls({order,pinned,onNavigate,onPin,onMove}:Props){
 const [arranging,setArranging]=useState(false);
 const [target,setTarget]=useState<PanelId>('layers');
 return <div className="workspace-controls glass">
  <div className="workspace-controls-row">
   <select value={target} aria-label="Jump to panel" onChange={event=>setTarget(event.target.value as PanelId)}>
    {order.map(id=><option value={id} key={id}>{PANEL_NAMES[id]}</option>)}
   </select>
   <button type="button" className="workspace-go" aria-label="Go to selected panel" onClick={()=>onNavigate(target)}>Go</button>
   <button type="button" className="workspace-arrange" aria-expanded={arranging} aria-controls="workspace-panel-order"
    onClick={()=>setArranging(open=>!open)}>{arranging?'Done':'Arrange'}</button>
  </div>
  <ul hidden={!arranging} id="workspace-panel-order" className="workspace-panel-order" aria-label="Panel order">
   {order.map(id=>{
    const name=PANEL_NAMES[id],isPinned=pinned.includes(id);
    const group=order.filter(panel=>pinned.includes(panel)===isPinned);
    const first=group[0]===id,last=group[group.length-1]===id;
    return <li key={id}>
     <span>{name}</span>
     <button type="button" className="workspace-pin" aria-label={`Pin ${name}`} aria-pressed={isPinned}
      onClick={()=>onPin(id)}><Pin size={13}/></button>
     <button type="button" aria-label={`Move ${name} panel up`} aria-disabled={first}
      onClick={()=>{if(!first)onMove(id,-1);}}><ChevronUp size={15}/></button>
     <button type="button" aria-label={`Move ${name} panel down`} aria-disabled={last}
      onClick={()=>{if(!last)onMove(id,1);}}><ChevronDown size={15}/></button>
    </li>;
   })}
  </ul>
 </div>;
}
