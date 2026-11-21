import {canAddDocumentLayer,makeLayer,type DocumentModel,type Layer,type LayerBlendMode,type LayerGroup} from './document';

export type LayerState={layer:Layer;name:string;visible:boolean;locked:boolean;opacity:number;alphaLocked:boolean;clipped:boolean;groupId?:string;blendMode?:LayerBlendMode};
export type LayerStructureSnapshot={layers:LayerState[];activeId:string;groups:LayerGroup[]};

/** Captures order and metadata only; canvas pixel buffers are retained by reference. */
export function captureLayerStructure(doc:DocumentModel):LayerStructureSnapshot{
  return{activeId:doc.activeId,groups:(doc.groups??[]).map(group=>({...group})),layers:doc.layers.map(layer=>({layer,name:layer.name,visible:layer.visible,locked:layer.locked,opacity:layer.opacity,alphaLocked:layer.alphaLocked===true,clipped:layer.clipped===true,groupId:layer.groupId,blendMode:layer.blendMode}))};
}
export function restoreLayerStructure(doc:DocumentModel,state:LayerStructureSnapshot){
  // Pixel undo/redo recreates canvases while preserving IDs. Prefer those live
  // layers so a later metadata undo cannot resurrect stale pre-undo pixels.
  const currentById=new Map(doc.layers.map(layer=>[layer.id,layer]));
  doc.groups=state.groups.map(group=>({...group}));doc.layers=state.layers.map(saved=>{const layer=currentById.get(saved.layer.id)??saved.layer;layer.name=saved.name;layer.visible=saved.visible;layer.locked=saved.locked;layer.opacity=saved.opacity;layer.alphaLocked=saved.alphaLocked;layer.clipped=saved.clipped;layer.groupId=saved.groupId;layer.blendMode=saved.blendMode;return layer;});
  doc.activeId=doc.layers.some(layer=>layer.id===state.activeId)?state.activeId:doc.layers[doc.layers.length-1]?.id??'';
}
export function renameLayer(doc:DocumentModel,id:string,name:string){const layer=doc.layers.find(item=>item.id===id),clean=name.trim();if(!layer||!clean)return false;layer.name=clean;return true;}
/** Visual up moves toward the top of the composite stack (the array's end). */
export function moveLayer(doc:DocumentModel,id:string,direction:'up'|'down'){
  const index=doc.layers.findIndex(layer=>layer.id===id),next=index+(direction==='up'?1:-1);
  if(index<0||next<0||next>=doc.layers.length)return false;
  if(doc.layers[index].groupId!==doc.layers[next].groupId)return false;
  [doc.layers[index],doc.layers[next]]=[doc.layers[next],doc.layers[index]];
  normalizeClippingLayers(doc);
  return true;
}
export function setLayerOpacity(layer:Layer,opacity:number){layer.opacity=Math.max(0,Math.min(1,Number.isFinite(opacity)?opacity:1));}
export function setLayerAlphaLocked(layer:Layer,enabled:boolean){layer.alphaLocked=enabled;}
export function setLayerClipped(layer:Layer,enabled:boolean){layer.clipped=enabled;}
/** A clipped layer needs a non-clipped layer below it to act as its alpha base. */
export function hasClippingBase(doc:DocumentModel,id:string){const index=doc.layers.findIndex(item=>item.id===id);if(index<=0)return false;const scope=doc.layers[index].groupId;for(let i=index-1;i>=0;i--){const candidate=doc.layers[i];if(candidate.groupId!==scope)return false;if(candidate.clipped!==true)return true;}return false;}
/** Clipping runs are local to a group; standalone root runs are separated by group boundaries. */
export function normalizeClippingLayers(doc:DocumentModel){const hasBase=new Map<string,boolean>();let rootRun=0,previousGroup:string|undefined;for(const layer of doc.layers){if(layer.groupId!==previousGroup){if(previousGroup!==undefined||layer.groupId!==undefined)rootRun++;previousGroup=layer.groupId;}const scope=layer.groupId?`group:${layer.groupId}`:`root:${rootRun}`,base=hasBase.get(scope)??false;if(layer.clipped===true){if(!base)layer.clipped=false;}else hasBase.set(scope,true);}}
export function duplicateLayer(doc:DocumentModel,id:string){
  if(!canAddDocumentLayer(doc))return null;
  const index=doc.layers.findIndex(layer=>layer.id===id);if(index<0)return null;
  const source=doc.layers[index],base=`${source.name} copy`;let name=base,n=2;
  while(doc.layers.some(layer=>layer.name===name))name=`${base} ${n++}`;
  const duplicate=makeLayer(doc.width,doc.height,name);
  duplicate.canvas.getContext('2d')!.drawImage(source.canvas,0,0);
  duplicate.visible=source.visible;duplicate.locked=source.locked;duplicate.opacity=source.opacity;
  duplicate.alphaLocked=source.alphaLocked===true;duplicate.clipped=source.clipped===true;duplicate.blendMode=source.blendMode;
  if(source.text)duplicate.text={...source.text};
  duplicate.groupId=source.groupId;
  doc.layers.splice(index+1,0,duplicate);doc.activeId=duplicate.id;
  return duplicate;
}

export function createLayerGroup(doc:DocumentModel,name='Group 1',id:string=crypto.randomUUID()){const clean=name.trim();if(!clean)throw new Error('Group name cannot be empty.');if((doc.groups??[]).length>=100)throw new Error('A document can contain at most 100 layer groups.');if((doc.groups??[]).some(group=>group.name.toLowerCase()===clean.toLowerCase()))throw new Error('A group with that name already exists.');const group:LayerGroup={id,name:clean,visible:true,locked:false,opacity:1};doc.groups=[...(doc.groups??[]),group];return group;}
export function renameLayerGroup(doc:DocumentModel,id:string,name:string){const group=doc.groups?.find(item=>item.id===id),clean=name.trim();if(!group||!clean)return false;if(doc.groups?.some(item=>item.id!==id&&item.name.toLowerCase()===clean.toLowerCase()))throw new Error('A group with that name already exists.');group.name=clean;return true;}
export function setLayerGroupVisibility(group:LayerGroup,visible:boolean){group.visible=visible;}
export function setLayerGroupLock(group:LayerGroup,locked:boolean){group.locked=locked;}
export function setLayerGroupOpacity(group:LayerGroup,opacity:number){group.opacity=Math.max(0,Math.min(1,Number.isFinite(opacity)?opacity:1));}
export function isLayerVisible(doc:DocumentModel,layer:Layer){return layer.visible&&(!layer.groupId||doc.groups?.find(group=>group.id===layer.groupId)?.visible!==false);}
export function isLayerLocked(doc:DocumentModel,layer:Layer){return layer.locked||!!layer.groupId&&doc.groups?.find(group=>group.id===layer.groupId)?.locked===true;}
export function assignLayerToGroup(doc:DocumentModel,layerId:string,groupId:string|null){const layer=doc.layers.find(item=>item.id===layerId);if(!layer||groupId&&!doc.groups?.some(group=>group.id===groupId))return false;if(layer.groupId===groupId)return false;const previous=layer.groupId,index=doc.layers.indexOf(layer);doc.layers.splice(index,1);layer.groupId=groupId??undefined;if(groupId){let insert=doc.layers.findIndex(item=>item.groupId===groupId);if(insert<0)insert=doc.layers.length;else while(insert<doc.layers.length&&doc.layers[insert].groupId===groupId)insert++;doc.layers.splice(insert,0,layer);}else doc.layers.push(layer);normalizeClippingLayers(doc);return previous!==groupId;}
export function moveLayerWithinScope(doc:DocumentModel,layerId:string,direction:'up'|'down'){return moveLayer(doc,layerId,direction);}
export function moveLayerGroup(doc:DocumentModel,id:string,direction:'up'|'down'){const members=doc.layers.filter(layer=>layer.groupId===id);if(!members.length){const groups=doc.groups??[],index=groups.findIndex(group=>group.id===id),next=index+(direction==='up'?1:-1);if(index<0||next<0||next>=groups.length)return false;[groups[index],groups[next]]=[groups[next],groups[index]];return true;}const indices=members.map(layer=>doc.layers.indexOf(layer)),start=Math.min(...indices),end=Math.max(...indices);if(end-start+1!==members.length)return false;const adjacent=direction==='up'?end+1:start-1;if(adjacent<0||adjacent>=doc.layers.length)return false;const otherId=doc.layers[adjacent].groupId;if(otherId===id)return false;let otherStart=adjacent,otherEnd=adjacent;if(otherId){while(otherStart>0&&doc.layers[otherStart-1].groupId===otherId)otherStart--;while(otherEnd+1<doc.layers.length&&doc.layers[otherEnd+1].groupId===otherId)otherEnd++;}const otherLength=otherEnd-otherStart+1,moved=doc.layers.splice(start,members.length);doc.layers.splice(direction==='up'?start+otherLength:otherStart,0,...moved);normalizeClippingLayers(doc);return true;}
export function deleteLayerGroup(doc:DocumentModel,id:string,contents:'preserve'|'delete'){const group=doc.groups?.find(item=>item.id===id);if(!group)return false;const members=doc.layers.filter(layer=>layer.groupId===id);if(contents==='delete'&&doc.layers.length-members.length<1)return false;doc.layers=contents==='delete'?doc.layers.filter(layer=>layer.groupId!==id):doc.layers.map(layer=>{if(layer.groupId===id)layer.groupId=undefined;return layer;});doc.groups=doc.groups!.filter(item=>item.id!==id);if(!doc.layers.some(layer=>layer.id===doc.activeId))doc.activeId=doc.layers[Math.min(doc.layers.length-1,0)]?.id??'';normalizeClippingLayers(doc);return true;}
/** Keep one editable layer in every document and select the nearest survivor. */
export function deleteLayer(doc:DocumentModel,id:string){
  if(doc.layers.length<=1)return false;
  const index=doc.layers.findIndex(layer=>layer.id===id);if(index<0)return false;
  doc.layers.splice(index,1);
  normalizeClippingLayers(doc);
  if(doc.activeId===id)doc.activeId=doc.layers[Math.max(0,index-1)]?.id??doc.layers[0].id;
  return true;
}

/** SG-14: set a layer's blend mode; Normal is stored as the absence of a mode. */
export function setLayerBlendMode(doc:DocumentModel,id:string,mode:LayerBlendMode){
 const layer=doc.layers.find(item=>item.id===id);
 if(!layer)return false;
 const next=mode==='normal'?undefined:mode;
 if(layer.blendMode===next)return false;
 layer.blendMode=next;
 return true;
}
