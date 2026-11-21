import type {Tool} from './paint';
import {COLLAPSIBLE_PANELS,PANEL_NAMES,type PanelId} from './workspacePreferences';

/**
 * SG-18: customizable single-key shortcuts for tools and a few brush and color commands.
 *
 * A binding is one key, optionally with Shift, written like "B", "Shift+D" or "[". Ctrl, Alt and
 * Windows-key combinations are reserved: the app uses Ctrl for Save, Undo, Copy and similar
 * commands, and browsers and Windows own many others (Ctrl+W, Alt+F4, Alt+Tab...). Letters
 * follow the active keyboard layout; digits and punctuation use the physical key, so Shift
 * does not change their name.
 */
export type ShortcutAction=`tool:${Tool}`|`panel:${PanelId}`|'size-down'|'size-up'|'swap-colors'|'reset-colors';
export type ShortcutGroup='Tools'|'Brush'|'Color'|'Workspace';
export type ShortcutDefinition={action:ShortcutAction;label:string;group:ShortcutGroup;defaultKey:string|null;repeat?:boolean};
export type KeyBindings=Record<ShortcutAction,string|null>;

export const SHORTCUT_DEFINITIONS:readonly ShortcutDefinition[]=[
 {action:'tool:brush',label:'Paintbrush',group:'Tools',defaultKey:'B'},
 {action:'tool:pencil',label:'Pencil',group:'Tools',defaultKey:'P'},
 {action:'tool:selection',label:'Rectangular selection',group:'Tools',defaultKey:'M'},
 {action:'tool:lasso',label:'Freehand lasso',group:'Tools',defaultKey:'Q'},
 {action:'tool:blend',label:'Blend / Smudge',group:'Tools',defaultKey:'W'},
 {action:'tool:line',label:'Line',group:'Tools',defaultKey:'L'},
 {action:'tool:rectangle',label:'Rectangle',group:'Tools',defaultKey:'R'},
 {action:'tool:ellipse',label:'Ellipse',group:'Tools',defaultKey:'O'},
 {action:'tool:bucket',label:'Paint Bucket',group:'Tools',defaultKey:'G'},
 {action:'tool:eyedropper',label:'Eyedropper',group:'Tools',defaultKey:'I'},
 {action:'tool:softAirbrush',label:'Soft Airbrush',group:'Tools',defaultKey:'A'},
 {action:'tool:spray',label:'Spray Paint',group:'Tools',defaultKey:'S'},
 {action:'tool:splatter',label:'Splatter Brush',group:'Tools',defaultKey:'Shift+D'},
 {action:'tool:eraser',label:'Eraser',group:'Tools',defaultKey:'E'},
 {action:'tool:hand',label:'Hand tool',group:'Tools',defaultKey:'H'},
 {action:'tool:text',label:'Text',group:'Tools',defaultKey:'T'},
 {action:'size-down',label:'Decrease brush size',group:'Brush',defaultKey:'[',repeat:true},
 {action:'size-up',label:'Increase brush size',group:'Brush',defaultKey:']',repeat:true},
 {action:'swap-colors',label:'Swap primary and secondary colors',group:'Color',defaultKey:'X'},
 {action:'reset-colors',label:'Reset colors to black and white',group:'Color',defaultKey:'D'},
 ...COLLAPSIBLE_PANELS.map<ShortcutDefinition>(id=>({action:`panel:${id}`,label:`Toggle ${PANEL_NAMES[id]}`,group:'Workspace',defaultKey:null})),
];

/** Fixed commands, listed in the dialog so people can see which keys are taken. */
export const FIXED_SHORTCUTS:readonly {keys:string;label:string}[]=[
 {keys:'Ctrl+S',label:'Save project'},{keys:'Ctrl+O',label:'Open project'},
 {keys:'Ctrl+Z',label:'Undo'},{keys:'Ctrl+Y / Ctrl+Shift+Z',label:'Redo'},
 {keys:'Ctrl+C / Ctrl+X / Ctrl+V',label:'Copy, cut and paste a selection'},
 {keys:'Delete / Backspace',label:'Delete selected pixels'},
 {keys:'Enter / Esc',label:'Apply a transform / cancel or deselect'},
 {keys:'Space (hold)',label:'Pan the canvas'},{keys:'Middle mouse (hold)',label:'Pan the canvas'},
];

export const KEYBINDINGS_STORAGE_KEY='seaglass-keybindings-v1';
const ACTIONS=new Set<string>(SHORTCUT_DEFINITIONS.map(item=>item.action));
const definitionFor=(action:ShortcutAction)=>SHORTCUT_DEFINITIONS.find(item=>item.action===action)!;
export const shortcutLabel=(action:ShortcutAction)=>definitionFor(action).label;

export function defaultKeyBindings():KeyBindings{
 return Object.fromEntries(SHORTCUT_DEFINITIONS.map(item=>[item.action,item.defaultKey])) as KeyBindings;
}

type KeyLike={key:string;code?:string;shiftKey:boolean;ctrlKey:boolean;altKey:boolean;metaKey:boolean;isComposing?:boolean};
const MODIFIER_KEYS=new Set(['Shift','Control','Alt','AltGraph','Meta','OS','CapsLock','NumLock','ScrollLock','Fn','FnLock','Hyper','Super','Dead','Process','Unidentified']);
const PUNCTUATION_CODES:Record<string,string>={BracketLeft:'[',BracketRight:']',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/',Backslash:'\\',Minus:'-',Equal:'=',Backquote:'`',IntlBackslash:'\\'};
const PUNCTUATION=new Set(Object.values(PUNCTUATION_CODES));
const RESERVED_KEYS:Record<string,string>={
 ' ':'Space is held to pan the canvas.',Spacebar:'Space is held to pan the canvas.',
 Enter:'Enter applies a transform.',Escape:'Esc cancels and deselects.',Tab:'Tab moves keyboard focus.',
 Delete:'Delete removes selected pixels.',Backspace:'Backspace removes selected pixels.',
};
export type KeyRead={binding:string}|{error:string}|null;

/** Names the key in a key event, or explains why it cannot be a shortcut. Modifier-only presses return null. */
export function readShortcutKey(event:KeyLike):KeyRead{
 if(event.isComposing||MODIFIER_KEYS.has(event.key))return null;
 if(event.ctrlKey||event.altKey||event.metaKey)return{error:'Ctrl, Alt and Windows-key combinations are reserved for app commands, the browser and Windows. Use a single key, optionally with Shift.'};
 if(RESERVED_KEYS[event.key])return{error:`That key is reserved. ${RESERVED_KEYS[event.key]}`};
 if(/^F\d{1,2}$/.test(event.key))return{error:'Function keys are reserved by the browser and Windows.'};
 const code=event.code??'';
 let base:string|null=null;
 if(/^\p{L}$/u.test(event.key)){const upper=event.key.toUpperCase();base=upper.length===1?upper:event.key;}
 else if(/^Digit\d$/.test(code))base=code.slice(5);
 else if(/^Numpad\d$/.test(code)&&/^\d$/.test(event.key))base=code.slice(6);
 else if(PUNCTUATION_CODES[code])base=PUNCTUATION_CODES[code];
 else if(/^\d$/.test(event.key)||PUNCTUATION.has(event.key))base=event.key;
 if(!base)return{error:'Choose a letter, digit or punctuation key, optionally with Shift.'};
 return{binding:(event.shiftKey?'Shift+':'')+base};
}

/** Accepts only well-formed bindings, so a damaged preference can never shadow a real key. */
export function normalizeBinding(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const match=/^(Shift\+)?(.+)$/.exec(value);if(!match)return null;
 const base=match[2];
 if(!((/^\p{L}$/u.test(base)&&(base.toUpperCase().length!==1||base===base.toUpperCase()))||/^\d$/.test(base)||PUNCTUATION.has(base)))return null;
 return (match[1]??'')+base;
}

export function findConflict(bindings:KeyBindings,action:ShortcutAction,binding:string):ShortcutAction|null{
 for(const item of SHORTCUT_DEFINITIONS)if(item.action!==action&&bindings[item.action]===binding)return item.action;
 return null;
}
export type AssignResult={ok:true;bindings:KeyBindings}|{ok:false;error:string;conflict?:ShortcutAction};
/** Assigns a key, refusing one that another command already uses. */
export function assignBinding(bindings:KeyBindings,action:ShortcutAction,binding:string|null):AssignResult{
 if(binding===null)return{ok:true,bindings:{...bindings,[action]:null}};
 const clean=normalizeBinding(binding);
 if(!clean)return{ok:false,error:'That key cannot be used as a shortcut.'};
 const conflict=findConflict(bindings,action,clean);
 if(conflict)return{ok:false,conflict,error:`${clean} is already used by ${shortcutLabel(conflict)}. Clear or change that shortcut first.`};
 return{ok:true,bindings:{...bindings,[action]:clean}};
}

/** The command a key press runs, or null. Held keys repeat only for commands that are meant to. */
export function actionForKey(bindings:KeyBindings,event:KeyLike&{repeat?:boolean}):ShortcutAction|null{
 const read=readShortcutKey(event);
 if(!read||!('binding' in read))return null;
 const match=(binding:string)=>SHORTCUT_DEFINITIONS.find(item=>bindings[item.action]===binding);
 let item=match(read.binding);
 // Earlier versions selected a tool whether or not Shift was held. Keep that for tools, so a
 // held Shift still works, unless the shifted key is bound to something of its own.
 if(!item&&read.binding.startsWith('Shift+')&&/^\p{L}$/u.test(read.binding.slice(6))){const plain=match(read.binding.slice(6));if(plain?.action.startsWith('tool:'))item=plain;}
 if(!item)return null;
 return event.repeat&&!item.repeat?null:item.action;
}

/** Text fields, number fields, selects and content-editable elements own their keys. */
export function isEditableTarget(target:EventTarget|null){
 const element=target as {closest?:(selector:string)=>unknown;matches?:(selector:string)=>boolean}|null;
 if(!element||typeof element.matches!=='function')return false;
 return element.matches('input,textarea,select,[contenteditable=""],[contenteditable="true"]')||Boolean(element.closest?.('[contenteditable=""],[contenteditable="true"]'));
}

type StorageLike=Pick<Storage,'getItem'|'setItem'>;
/**
 * Saved bindings override the defaults; a damaged saved key falls back to its default. A command added in a later version receives its default
 * key unless the person already uses that key elsewhere. Duplicate or invalid keys are dropped.
 */
export function loadKeyBindings(storage:StorageLike):KeyBindings{
 const result=defaultKeyBindings();
 let saved:Record<string,unknown>;
 try{
  const raw=storage.getItem(KEYBINDINGS_STORAGE_KEY);if(!raw)return result;
  const data=JSON.parse(raw) as {version?:unknown;bindings?:unknown};
  if(data?.version!==1||!data.bindings||typeof data.bindings!=='object')return result;
  saved=data.bindings as Record<string,unknown>;
 }catch{return result;}
 const used=new Set<string>();
 for(const item of SHORTCUT_DEFINITIONS){
  if(!Object.prototype.hasOwnProperty.call(saved,item.action))continue;
  const value=saved[item.action],binding=value===null?null:normalizeBinding(value)??item.defaultKey;
  result[item.action]=binding&&!used.has(binding)?binding:null;
  if(binding)used.add(binding);
 }
 for(const item of SHORTCUT_DEFINITIONS){
  if(Object.prototype.hasOwnProperty.call(saved,item.action))continue;
  const binding=result[item.action];
  if(binding&&used.has(binding))result[item.action]=null;else if(binding)used.add(binding);
 }
 return result;
}
export function saveKeyBindings(storage:StorageLike,bindings:KeyBindings){
 try{
  const stored:Record<string,string|null>={};
  for(const [action,binding] of Object.entries(bindings))if(ACTIONS.has(action))stored[action]=binding;
  storage.setItem(KEYBINDINGS_STORAGE_KEY,JSON.stringify({version:1,bindings:stored}));
  return true;
 }catch{return false;}
}
/** Tooltip text such as "Paintbrush (B)", or just the name when the command has no key. */
export function withShortcut(label:string,binding:string|null){return binding?`${label} (${binding})`:label;}
