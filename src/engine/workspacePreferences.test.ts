import {describe,expect,it} from 'vitest';
import {DEFAULT_WORKSPACE,clampLayersHeight,inspectorWidthFromPointer,loadWorkspacePreferences,moveWorkspacePanel,orderedPanels,resetWorkspacePreferences,saveWorkspacePreferences,toggleGroupCollapsed,togglePanel,WORKSPACE_PREFERENCES_KEY,type PanelId,type WorkspacePreferences} from './workspacePreferences';
import {point} from './paint';
function storage(){const data=new Map<string,string>();return{data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}};}
describe('workspace layout preferences',()=>{
 it('clamps inspector width and computes resize position while keeping canvas room',()=>{expect(inspectorWidthFromPointer(1200,1440)).toBe(222);expect(inspectorWidthFromPointer(20,1440)).toBe(420);expect(inspectorWidthFromPointer(1400,900)).toBe(210);});
 it('toggles and persists collapsible sections and groups',()=>{let prefs:WorkspacePreferences=resetWorkspacePreferences();prefs=togglePanel(prefs,'layers');prefs=toggleGroupCollapsed(prefs,'group-a');const s=storage();expect(saveWorkspacePreferences(s,prefs)).toBe(true);expect(loadWorkspacePreferences(s)).toEqual(prefs);expect(s.data.has(WORKSPACE_PREFERENCES_KEY)).toBe(true);});
 it('resets only layout preferences and recovers from invalid data',()=>{const saved={...DEFAULT_WORKSPACE,inspectorWidth:410,collapsed:{...DEFAULT_WORKSPACE.collapsed,color:true},collapsedGroups:['g']},s=storage();saveWorkspacePreferences(s,saved);expect(resetWorkspacePreferences()).toEqual(DEFAULT_WORKSPACE);s.data.set(WORKSPACE_PREFERENCES_KEY,'{broken');expect(loadWorkspacePreferences(s)).toEqual(DEFAULT_WORKSPACE);s.data.set(WORKSPACE_PREFERENCES_KEY,JSON.stringify({version:0,inspectorWidth:999}));expect(loadWorkspacePreferences(s)).toEqual(DEFAULT_WORKSPACE);});
 it('sanitizes stored order, pins and list sizing while retaining missing panels',()=>{
  const s=storage();
  s.setItem(WORKSPACE_PREFERENCES_KEY,JSON.stringify({version:2,order:['color','invalid','color','effects'],pinned:['style','style',3],layersHeight:900}));
  const prefs=loadWorkspacePreferences(s);
  expect(prefs.order).toEqual(['color','effects','layers','presets','tool','style']);
  expect(prefs.pinned).toEqual(['style']);
  expect(prefs.layersHeight).toBe(520);
  expect(clampLayersHeight(-30)).toBe(96);
  expect(clampLayersHeight(NaN)).toBe(DEFAULT_WORKSPACE.layersHeight);
 });
 it('moves panels within their pinned or unpinned group and preserves the underlying order when pinning',()=>{
  const prefs=resetWorkspacePreferences(),pinned:PanelId[]=['style','effects'];
  expect(orderedPanels(prefs.order,pinned)).toEqual(['effects','style','layers','color','presets','tool']);
  const moved=moveWorkspacePanel(prefs.order,pinned,'style',-1);
  expect(orderedPanels(moved,pinned)).toEqual(['style','effects','layers','color','presets','tool']);
  expect(moveWorkspacePanel(moved,pinned,'layers',-1)).toBe(moved);
  expect(prefs.order).toEqual(DEFAULT_WORKSPACE.order);
 });
 it('keeps document-coordinate pointer mapping correct after panel resizing shifts the centered canvas',()=>{const doc={width:300,height:200,layers:[],activeId:''},pixel={x:47.25,y:61.5},zoom=2;let left=240,top=85;const canvas={getBoundingClientRect:()=>({left,top})} as HTMLCanvasElement;expect(point({clientX:left+pixel.x*zoom,clientY:top+pixel.y*zoom} as PointerEvent,canvas,zoom,{x:0,y:0},doc as never)).toEqual(pixel);left=158;top=103;expect(point({clientX:left+pixel.x*zoom,clientY:top+pixel.y*zoom} as PointerEvent,canvas,zoom,{x:91,y:-18},doc as never)).toEqual(pixel);});
});

describe('layer effects panel preference',()=>{
 it('loads earlier saved preferences without the effects key as expanded',async()=>{
  const stored=JSON.stringify({version:1,inspectorWidth:300,collapsed:{color:true,presets:false,tool:false,style:false,layers:false},collapsedGroups:[]});
  const s=storage();s.setItem('seaglass-workspace-v1',stored);
  const prefs=loadWorkspacePreferences(s);
  expect(prefs.collapsed.effects).toBe(false);
  expect(prefs.collapsed.color).toBe(true);
  expect(prefs.inspectorWidth).toBe(300);
  expect(prefs.order).toEqual(DEFAULT_WORKSPACE.order);
  expect(saveWorkspacePreferences(s,prefs)).toBe(true);
  expect(loadWorkspacePreferences(s)).toEqual(prefs);
 });
});
