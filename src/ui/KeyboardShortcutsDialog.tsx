import {useEffect,useRef,useState} from 'react';
import {Keyboard} from 'lucide-react';
import {assignBinding,defaultKeyBindings,FIXED_SHORTCUTS,readShortcutKey,SHORTCUT_DEFINITIONS,shortcutLabel,type KeyBindings,type ShortcutAction,type ShortcutGroup} from '../engine/keybindings';

type Props={bindings:KeyBindings;onChange:(next:KeyBindings)=>void;onClose:()=>void;returnFocus?:{current:HTMLElement|null}};
const GROUPS:ShortcutGroup[]=['Tools','Brush','Color','Workspace'];
const FOCUSABLE='button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

/** SG-18: Settings → Keyboard Shortcuts. Choose Change, then press the new key. */
export default function KeyboardShortcutsDialog({bindings,onChange,onClose,returnFocus}:Props){
 const [recording,setRecording]=useState<ShortcutAction|null>(null);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 const [undoRestore,setUndoRestore]=useState<KeyBindings|null>(null);
 const dialog=useRef<HTMLElement>(null);
 const say=(text:string)=>{setNotice(text);setError('');setUndoRestore(null);};
 const fail=(text:string)=>{setError(text);};
 useEffect(()=>{
  const opener=returnFocus?.current??(document.activeElement as HTMLElement|null);
  dialog.current?.querySelector<HTMLElement>('.shortcut-change')?.focus();
  // Keep keyboard focus inside the dialog, so no key can reach the canvas behind it.
  const contain=(e:FocusEvent)=>{const node=dialog.current;if(node&&e.target instanceof Node&&!node.contains(e.target))node.querySelector<HTMLElement>('.shortcut-change')?.focus();};
  document.addEventListener('focusin',contain);
  return()=>{document.removeEventListener('focusin',contain);if(opener&&document.contains(opener))opener.focus();};
 },[]);// eslint-disable-line react-hooks/exhaustive-deps
 const focusChange=(action:ShortcutAction)=>dialog.current?.querySelector<HTMLElement>(`[data-action="${action}"] .shortcut-change`)?.focus();
 const startRecording=(action:ShortcutAction)=>{setRecording(action);say(`Press a key for ${shortcutLabel(action)}, or Esc to cancel.`);};
 const stopRecording=(text:string)=>{setRecording(null);say(text);};
 const keyDown=(e:React.KeyboardEvent<HTMLElement>)=>{
  // Keys pressed in this dialog never reach the canvas or tool shortcuts.
  e.stopPropagation();
  if(recording){
   if(e.key==='Tab'){stopRecording('Shortcut unchanged.');return;}
   e.preventDefault();
   if(e.key==='Escape'){stopRecording('Shortcut unchanged.');return;}
   const read=readShortcutKey(e.nativeEvent);
   if(!read)return;
   if('error' in read){fail(read.error);return;}
   const result=assignBinding(bindings,recording,read.binding);
   if(!result.ok){fail(result.error);return;}
   onChange(result.bindings);stopRecording(`${shortcutLabel(recording)} is now ${read.binding}.`);
   return;
  }
  if(e.key==='Escape'){e.preventDefault();onClose();return;}
  if(e.key==='Tab'&&dialog.current){
   const items=Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
   if(!items.length)return;
   const first=items[0],last=items[items.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
 };
 const clear=(action:ShortcutAction)=>{
  const result=assignBinding(bindings,action,null);
  if(!result.ok)return;
  onChange(result.bindings);setRecording(null);say(`${shortcutLabel(action)} has no shortcut.`);
  // The Clear button becomes unavailable, so keep focus in the same row.
  focusChange(action);
 };
 const restore=()=>{const previous=bindings;onChange(defaultKeyBindings());setRecording(null);setError('');setNotice('Default shortcuts restored.');setUndoRestore(previous);};
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!recording)onClose();}}>
  <section ref={dialog} className="shortcuts-dialog glass" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" aria-describedby="shortcuts-help" onKeyDown={keyDown}>
   <div className="panel-title"><span id="shortcuts-title"><Keyboard size={16}/> Keyboard Shortcuts</span></div>
   <p id="shortcuts-help" className="shortcuts-help">Choose Change, then press a single key, optionally with Shift. Shortcuts pause while you type in a text field.</p>
   <div className="shortcuts-feedback">
    <p className="shortcuts-message" aria-live="polite">{notice}{undoRestore&&<> <button className="shortcuts-undo" onClick={()=>{onChange(undoRestore);setUndoRestore(null);setNotice('Your previous shortcuts are back.');}}>Undo</button></>}</p>
    <p className="shortcuts-message error" role="alert">{error}</p>
   </div>
   <div className="shortcuts-list">
    {GROUPS.map(group=><section key={group} className="shortcut-group" aria-label={group}>
     <h3>{group}</h3>
     {SHORTCUT_DEFINITIONS.filter(item=>item.group===group).map(item=>{const binding=bindings[item.action],active=recording===item.action;return <div key={item.action} className={`shortcut-row ${active?'recording':''}`} data-action={item.action}>
      <span className="shortcut-name" id={`shortcut-${item.action.replace(':','-')}`}>{item.label}</span>
      <kbd className={binding?'':'unassigned'}>{active?'Press a key…':binding??'None'}</kbd>
      <button className="shortcut-change" aria-describedby={`shortcut-${item.action.replace(':','-')}`} onClick={()=>active?stopRecording('Shortcut unchanged.'):startRecording(item.action)}>{active?'Cancel':'Change'}</button>
      <button className="shortcut-clear" aria-describedby={`shortcut-${item.action.replace(':','-')}`} aria-disabled={!binding} onClick={()=>{if(binding)clear(item.action);}}>Clear</button>
     </div>;})}
    </section>)}
    <section className="shortcut-group fixed" aria-label="Fixed shortcuts">
     <h3>Fixed</h3>
     {FIXED_SHORTCUTS.map(item=><div key={item.keys} className="shortcut-row fixed"><span className="shortcut-name">{item.label}</span><kbd>{item.keys}</kbd></div>)}
    </section>
   </div>
   <div className="dialog-actions"><button onClick={restore}>Restore Defaults</button><button className="primary" onClick={onClose}>Done</button></div>
  </section>
 </div>;
}
