import {describe,expect,it} from 'vitest';
import {actionForKey,assignBinding,defaultKeyBindings,isEditableTarget,KEYBINDINGS_STORAGE_KEY,loadKeyBindings,normalizeBinding,readShortcutKey,saveKeyBindings,SHORTCUT_DEFINITIONS,withShortcut} from './keybindings';

const key=(k:string,extra:Partial<{code:string;shiftKey:boolean;ctrlKey:boolean;altKey:boolean;metaKey:boolean;repeat:boolean;isComposing:boolean}>={})=>({key:k,code:extra.code??(/^[a-z]$/i.test(k)?`Key${k.toUpperCase()}`:''),shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,...extra});
const memory=()=>{const data=new Map<string,string>();return{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},data};};

describe('default shortcuts',()=>{
 it('keep the existing tool, brush-size and color keys',()=>{
  const d=defaultKeyBindings();
  expect(d).toMatchObject({'tool:brush':'B','tool:pencil':'P','tool:selection':'M','tool:lasso':'Q','tool:blend':'W','tool:line':'L','tool:rectangle':'R','tool:ellipse':'O','tool:bucket':'G','tool:eyedropper':'I','tool:softAirbrush':'A','tool:spray':'S','tool:splatter':'Shift+D','tool:eraser':'E','tool:hand':'H','size-down':'[','size-up':']','swap-colors':'X','reset-colors':'D'});
 });
 it('have no duplicates',()=>{
  const keys=Object.values(defaultKeyBindings()).filter(Boolean);
  expect(new Set(keys).size).toBe(keys.length);
 });
 it('cover every drawing tool',()=>{
  const tools=SHORTCUT_DEFINITIONS.filter(item=>item.group==='Tools').map(item=>item.action);
  for(const tool of ['brush','pencil','eraser','hand','softAirbrush','spray','splatter','bucket','eyedropper','line','rectangle','ellipse','selection','lasso','blend'])expect(tools).toContain(`tool:${tool}`);
 });
});

describe('reading keys',()=>{
 it('names letters case-insensitively and Shift explicitly',()=>{
  expect(readShortcutKey(key('b'))).toEqual({binding:'B'});
  expect(readShortcutKey(key('B'))).toEqual({binding:'B'}); // Caps Lock
  expect(readShortcutKey(key('D',{shiftKey:true}))).toEqual({binding:'Shift+D'});
 });
 it('names digits and punctuation by physical key so Shift does not rename them',()=>{
  expect(readShortcutKey(key('!',{code:'Digit1',shiftKey:true}))).toEqual({binding:'Shift+1'});
  expect(readShortcutKey(key('{',{code:'BracketLeft',shiftKey:true}))).toEqual({binding:'Shift+['});
  expect(readShortcutKey(key(']',{code:'BracketRight'}))).toEqual({binding:']'});
  expect(readShortcutKey(key('5',{code:'Numpad5'}))).toEqual({binding:'5'});
 });
 it('ignores modifier-only presses and IME composition',()=>{
  expect(readShortcutKey(key('Shift',{shiftKey:true}))).toBeNull();
  expect(readShortcutKey(key('Control',{ctrlKey:true}))).toBeNull();
  expect(readShortcutKey(key('a',{isComposing:true}))).toBeNull();
 });
 it('refuses Ctrl, Alt and Windows-key combinations, which belong to the app, browser and Windows',()=>{
  for(const extra of [{ctrlKey:true},{altKey:true},{metaKey:true},{ctrlKey:true,shiftKey:true}]){
   const read=readShortcutKey(key('w',extra));
   expect(read&&'error' in read).toBe(true);
  }
 });
 it('refuses reserved keys and function keys',()=>{
  for(const k of [' ','Enter','Escape','Tab','Delete','Backspace','F5','F11','F12','ArrowLeft','Home'])expect(readShortcutKey(key(k))).toHaveProperty('error');
 });
});

describe('assigning shortcuts',()=>{
 it('reassigns a command to a free key',()=>{
  const result=assignBinding(defaultKeyBindings(),'tool:brush','K');
  expect(result.ok).toBe(true);
  if(result.ok)expect(result.bindings['tool:brush']).toBe('K');
 });
 it('prevents a key from running two commands',()=>{
  const result=assignBinding(defaultKeyBindings(),'tool:brush','E');
  expect(result).toMatchObject({ok:false,conflict:'tool:eraser'});
  if(!result.ok)expect(result.error).toContain('Eraser');
 });
 it('treats Shift as part of the key',()=>{
  expect(assignBinding(defaultKeyBindings(),'tool:brush','Shift+E').ok).toBe(true);
 });
 it('allows clearing a shortcut, which frees its key',()=>{
  const cleared=assignBinding(defaultKeyBindings(),'tool:eraser',null);
  expect(cleared.ok).toBe(true);
  if(cleared.ok)expect(assignBinding(cleared.bindings,'tool:brush','E').ok).toBe(true);
 });
 it('rejects malformed bindings',()=>{
  expect(assignBinding(defaultKeyBindings(),'tool:brush','Ctrl+B').ok).toBe(false);
  expect(normalizeBinding('Shift+')).toBeNull();
  expect(normalizeBinding('b')).toBeNull();
  expect(normalizeBinding(42)).toBeNull();
 });
});

describe('dispatching key presses',()=>{
 it('maps presses to commands with the current bindings',()=>{
  const d=defaultKeyBindings();
  expect(actionForKey(d,key('b'))).toBe('tool:brush');
  expect(actionForKey(d,key('D',{shiftKey:true}))).toBe('tool:splatter');
  expect(actionForKey(d,key('d'))).toBe('reset-colors');
  expect(actionForKey(d,key('[',{code:'BracketLeft'}))).toBe('size-down');
 });
 it('never runs a tool command for Ctrl shortcuts such as Ctrl+S or Ctrl+Z',()=>{
  const d=defaultKeyBindings();
  expect(actionForKey(d,key('s',{ctrlKey:true}))).toBeNull();
  expect(actionForKey(d,key('z',{ctrlKey:true}))).toBeNull();
  expect(actionForKey(d,key('b',{metaKey:true}))).toBeNull();
 });
 it('follows a reassigned key and forgets the old one',()=>{
  const result=assignBinding(defaultKeyBindings(),'tool:brush','K');if(!result.ok)throw new Error(result.error);
  expect(actionForKey(result.bindings,key('k'))).toBe('tool:brush');
  expect(actionForKey(result.bindings,key('b'))).toBeNull();
 });
 it('keeps Shift+letter selecting the letter\'s tool unless Shift+letter has its own binding',()=>{
  const d=defaultKeyBindings();
  expect(actionForKey(d,key('B',{shiftKey:true}))).toBe('tool:brush');
  expect(actionForKey(d,key('D',{shiftKey:true}))).toBe('tool:splatter');
  expect(actionForKey(d,key('X',{shiftKey:true}))).toBeNull(); // color commands never took Shift
  expect(actionForKey(d,key('{',{code:'BracketLeft',shiftKey:true}))).toBeNull();
 });
 it('ignores numpad keys while NumLock is off',()=>{
  const moved=assignBinding(defaultKeyBindings(),'tool:brush','4');if(!moved.ok)throw new Error();
  expect(actionForKey(moved.bindings,key('4',{code:'Numpad4'}))).toBe('tool:brush');
  expect(actionForKey(moved.bindings,key('ArrowLeft',{code:'Numpad4'}))).toBeNull();
 });
 it('accepts letters whose capital form is two letters',()=>{
  expect(readShortcutKey(key('ß',{code:'Minus'}))).toEqual({binding:'ß'});
  expect(normalizeBinding('ß')).toBe('ß');
 });
 it('repeats only commands that are meant to repeat while held',()=>{
  const d=defaultKeyBindings();
  expect(actionForKey(d,key(']',{code:'BracketRight',repeat:true}))).toBe('size-up');
  expect(actionForKey(d,key('x',{repeat:true}))).toBeNull();
 });
});

describe('editable targets',()=>{
 const element=(matches:boolean,inEditable=false)=>({matches:()=>matches,closest:()=>inEditable?{}:null});
 it('recognizes fields and content-editable regions',()=>{
  expect(isEditableTarget(element(true) as unknown as EventTarget)).toBe(true);
  expect(isEditableTarget(element(false,true) as unknown as EventTarget)).toBe(true);
  expect(isEditableTarget(element(false) as unknown as EventTarget)).toBe(false);
  expect(isEditableTarget(null)).toBe(false);
  expect(isEditableTarget({} as unknown as EventTarget)).toBe(false); // e.g. window, which has no matches()
 });
});

describe('persisting shortcuts',()=>{
 it('round-trips custom and cleared shortcuts',()=>{
  const storage=memory();
  let bindings=defaultKeyBindings();
  const moved=assignBinding(bindings,'tool:brush','K');if(!moved.ok)throw new Error();bindings=moved.bindings;
  const cleared=assignBinding(bindings,'tool:hand',null);if(!cleared.ok)throw new Error();bindings=cleared.bindings;
  expect(saveKeyBindings(storage,bindings)).toBe(true);
  expect(loadKeyBindings(storage)).toEqual(bindings);
 });
 it('falls back to defaults for missing, damaged or unknown-version data',()=>{
  const storage=memory();
  expect(loadKeyBindings(storage)).toEqual(defaultKeyBindings());
  storage.setItem(KEYBINDINGS_STORAGE_KEY,'{not json');
  expect(loadKeyBindings(storage)).toEqual(defaultKeyBindings());
  storage.setItem(KEYBINDINGS_STORAGE_KEY,JSON.stringify({version:9,bindings:{'tool:brush':'K'}}));
  expect(loadKeyBindings(storage)).toEqual(defaultKeyBindings());
 });
 it('drops invalid or duplicate saved keys instead of letting one key run two commands',()=>{
  const storage=memory();
  storage.setItem(KEYBINDINGS_STORAGE_KEY,JSON.stringify({version:1,bindings:{'tool:brush':'E','tool:eraser':'E','tool:pencil':'Ctrl+P','unknown:action':'Z'}}));
  const loaded=loadKeyBindings(storage);
  expect(loaded['tool:brush']).toBe('E');
  expect(loaded['tool:eraser']).toBeNull();
  expect(loaded['tool:pencil']).toBe('P'); // damaged value: back to the default
  expect(Object.keys(loaded)).not.toContain('unknown:action');
 });
 it('gives a command added later its default key unless that key is already taken',()=>{
  const storage=memory();
  const older=Object.fromEntries(Object.entries(defaultKeyBindings()).filter(([action])=>action!=='tool:hand'&&action!=='tool:eraser'));
  older['tool:brush']='H';
  storage.setItem(KEYBINDINGS_STORAGE_KEY,JSON.stringify({version:1,bindings:older}));
  const loaded=loadKeyBindings(storage);
  expect(loaded['tool:hand']).toBeNull();
  expect(loaded['tool:eraser']).toBe('E');
 });
 it('reports storage failures without throwing',()=>{
  const failing={getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('full');}};
  expect(loadKeyBindings(failing)).toEqual(defaultKeyBindings());
  expect(saveKeyBindings(failing,defaultKeyBindings())).toBe(false);
 });
 it('formats tooltips with the current key',()=>{
  expect(withShortcut('Paintbrush','B')).toBe('Paintbrush (B)');
  expect(withShortcut('Paintbrush',null)).toBe('Paintbrush');
 });
});
