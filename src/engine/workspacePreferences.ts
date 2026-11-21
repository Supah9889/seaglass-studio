const LEGACY_WORKSPACE_KEY='seaglass-workspace-v1';
export const WORKSPACE_PREFERENCES_KEY='seaglass-workspace-v2';
export const COLLAPSIBLE_PANELS=['layers','color','presets','tool','effects','style'] as const;
export type PanelId=typeof COLLAPSIBLE_PANELS[number];
export const PANEL_NAMES:Record<PanelId,string>={
 layers:'Layers',color:'Color',presets:'Presets',tool:'Tool properties',effects:'Layer effects',style:'Studio settings',
};

export type WorkspacePreferences={
 inspectorWidth:number;
 collapsed:Record<PanelId,boolean>;
 collapsedGroups:string[];
 order:PanelId[];
 pinned:PanelId[];
 layersHeight:number;
 layersFixed:boolean;
};
type StorageLike=Pick<Storage,'getItem'|'setItem'>;

export const DEFAULT_WORKSPACE:WorkspacePreferences={
 inspectorWidth:257,
 collapsed:{color:false,presets:false,tool:false,effects:false,style:false,layers:false},
 collapsedGroups:[],order:[...COLLAPSIBLE_PANELS],pinned:[],layersHeight:240,layersFixed:false,
};
export const MIN_LAYERS_HEIGHT=96;
export const MAX_LAYERS_HEIGHT=520;

export function clampInspectorWidth(width:number,viewportWidth:number){
 const max=Math.max(210,Math.min(420,viewportWidth-58-320-90));
 return Math.max(210,Math.min(max,Number.isFinite(width)?width:DEFAULT_WORKSPACE.inspectorWidth));
}
export function inspectorWidthFromPointer(clientX:number,viewportWidth:number){
 return clampInspectorWidth(viewportWidth-clientX-18,viewportWidth);
}
export function clampLayersHeight(height:number){
 return Math.round(Math.max(MIN_LAYERS_HEIGHT,Math.min(MAX_LAYERS_HEIGHT,
  Number.isFinite(height)?height:DEFAULT_WORKSPACE.layersHeight)));
}
export function togglePanel(prefs:WorkspacePreferences,id:PanelId){
 return {...prefs,collapsed:{...prefs.collapsed,[id]:!prefs.collapsed[id]}};
}
export function toggleGroupCollapsed(prefs:WorkspacePreferences,id:string){
 const set=new Set(prefs.collapsedGroups);
 set.has(id)?set.delete(id):set.add(id);
 return {...prefs,collapsedGroups:[...set]};
}
export function orderedPanels(order:PanelId[],pinned:PanelId[]){
 return [...order.filter(id=>pinned.includes(id)),...order.filter(id=>!pinned.includes(id))];
}
export function moveWorkspacePanel(order:PanelId[],pinned:PanelId[],id:PanelId,step:-1|1){
 const group=order.filter(panel=>pinned.includes(panel)===pinned.includes(id));
 const neighbor=group[group.indexOf(id)+step];
 if(!neighbor)return order;
 return order.map(panel=>panel===id?neighbor:panel===neighbor?id:panel);
}
export function resetWorkspacePreferences():WorkspacePreferences{
 return {...DEFAULT_WORKSPACE,collapsed:{...DEFAULT_WORKSPACE.collapsed},collapsedGroups:[],
  order:[...COLLAPSIBLE_PANELS],pinned:[]};
}
function knownPanels(value:unknown):PanelId[]{
 return Array.isArray(value)?[...new Set(value.filter((id):id is PanelId=>COLLAPSIBLE_PANELS.includes(id)))]:[];
}
function storedNumber(value:unknown){
 return typeof value==='number'?value:NaN;
}
export function loadWorkspacePreferences(storage:StorageLike):WorkspacePreferences{
 try{
  const v2=storage.getItem(WORKSPACE_PREFERENCES_KEY);
  const raw=v2??storage.getItem(LEGACY_WORKSPACE_KEY);
  if(!raw)return resetWorkspacePreferences();
  const data=JSON.parse(raw) as Partial<WorkspacePreferences>&{version?:number};
  if(data?.version!==(v2?2:1))return resetWorkspacePreferences();
  const order=knownPanels(data.order);
  const collapsed=data.collapsed&&typeof data.collapsed==='object'?data.collapsed:DEFAULT_WORKSPACE.collapsed;
  return {
   inspectorWidth:clampInspectorWidth(storedNumber(data.inspectorWidth),1440),
   collapsed:{color:collapsed.color===true,presets:collapsed.presets===true,tool:collapsed.tool===true,
    effects:collapsed.effects===true,style:collapsed.style===true,layers:collapsed.layers===true},
   collapsedGroups:Array.isArray(data.collapsedGroups)?data.collapsedGroups.filter(id=>typeof id==='string').slice(0,100):[],
   order:[...order,...COLLAPSIBLE_PANELS.filter(id=>!order.includes(id))],
   pinned:knownPanels(data.pinned),
   layersHeight:clampLayersHeight(storedNumber(data.layersHeight)),
   layersFixed:data.layersFixed===true,
  };
 }catch{return resetWorkspacePreferences();}
}

export function saveWorkspacePreferences(storage:StorageLike,prefs:WorkspacePreferences){
 try{storage.setItem(WORKSPACE_PREFERENCES_KEY,JSON.stringify({...prefs,version:2}));return true;}
 catch{return false;}
}
