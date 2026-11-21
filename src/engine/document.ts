import type {TextData} from './text';
export type LayerGroup={id:string;name:string;visible:boolean;locked:boolean;opacity:number};
/** SG-14: how an ordinary raster layer combines with the layers beneath it. */
export type LayerBlendMode='normal'|'multiply'|'screen';
export const LAYER_BLEND_MODES:{value:LayerBlendMode;label:string}[]=[{value:'normal',label:'Normal'},{value:'multiply',label:'Multiply'},{value:'screen',label:'Screen'}];
export const isLayerBlendMode=(value:unknown):value is LayerBlendMode=>value==='normal'||value==='multiply'||value==='screen';
export type Layer = { id:string; name:string; canvas:HTMLCanvasElement; visible:boolean;locked:boolean;opacity:number;alphaLocked?:boolean;clipped?:boolean;groupId?:string;blendMode?:LayerBlendMode;
 /** SG-19: editable text source; the canvas holds its rendered pixels. */
 text?:TextData };
export type Snapshot = { id:string;name:string;visible:boolean;locked:boolean;opacity:number;alphaLocked?:boolean;clipped?:boolean;groupId?:string;blendMode?:LayerBlendMode;text?:TextData;activeDocumentLayerId:string;data:ImageData };
export type DocumentModel = { width:number;height:number;layers:Layer[];activeId:string;groups?:LayerGroup[] };
export const MAX_DOCUMENT_WIDTH=4096;
export const MAX_DOCUMENT_HEIGHT=4096;
export const MAX_DOCUMENT_PIXELS=16_777_216;
export const MAX_DOCUMENT_LAYERS=100;
export const DOCUMENT_LAYER_LIMIT_MESSAGE='This document has reached the 100-layer project limit';
/**
 * SG-17: one working-set estimate shared by the editor, the project reader and the writer.
 * Every layer surface plus four more: the composite, group and clipping scratch, and one
 * decoded or encoding layer image. The reader adds the archive's compressed and inflated bytes;
 * the writer applies that same estimate to the archive it produced, so every saved file can be
 * reopened. Editor admission also reserves room for the archive so the limit is reported when a
 * layer is added rather than at save time.
 */
export const DOCUMENT_WORKING_SET_BUDGET_BYTES=1024*1024*1024;
export const DOCUMENT_SURFACE_OVERHEAD=4;
/** Editor headroom for the archive held while saving and reopening (about two layer surfaces). */
export const DOCUMENT_ARCHIVE_RESERVE_SURFACES=2;
export const DOCUMENT_MEMORY_LIMIT_MESSAGE='Another layer would exceed the 1024 MiB working-memory budget needed to save this document. Delete or merge layers, or use a smaller canvas.';
export function estimateWorkingSetBytes(width:number,height:number,layerCount:number){return width*height*4*(layerCount+DOCUMENT_SURFACE_OVERHEAD);}
/** Why one more layer cannot be added, or null when it can. Checked before any allocation. */
export function layerAdmissionMessage(doc:Pick<DocumentModel,'layers'|'width'|'height'>){
 if(doc.layers.length>=MAX_DOCUMENT_LAYERS)return DOCUMENT_LAYER_LIMIT_MESSAGE;
 if(estimateWorkingSetBytes(doc.width,doc.height,doc.layers.length+1+DOCUMENT_ARCHIVE_RESERVE_SURFACES)>DOCUMENT_WORKING_SET_BUDGET_BYTES)return DOCUMENT_MEMORY_LIMIT_MESSAGE;
 return null;
}
export function canAddDocumentLayer(doc:Pick<DocumentModel,'layers'|'width'|'height'>){return layerAdmissionMessage(doc)===null;}
export function isValidDocumentSize(width:number,height:number){return Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=MAX_DOCUMENT_WIDTH&&height<=MAX_DOCUMENT_HEIGHT&&width*height<=MAX_DOCUMENT_PIXELS;}
export function estimateDocumentMemoryBytes(width:number,height:number,layerCount=1,historyCopies=0){return isValidDocumentSize(width,height)&&Number.isInteger(layerCount)&&layerCount>=1&&Number.isInteger(historyCopies)&&historyCopies>=0?width*height*4*(layerCount+2+historyCopies):null;}
export function createDocument(width:number,height:number,name='Layer 1'):DocumentModel{if(!isValidDocumentSize(width,height))throw new RangeError('Document dimensions exceed the supported 4096 px side / 16.7 megapixel limit.');const layer=makeLayer(width,height,name);return{width,height,layers:[layer],activeId:layer.id,groups:[]};}
export const makeLayer=(width:number,height:number,name:string):Layer=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return{id:crypto.randomUUID(),name,canvas,visible:true,locked:false,opacity:1,alphaLocked:false,clipped:false};};
export function snapshot(doc:DocumentModel,layerIds?:readonly string[]):Snapshot[]{const selected=layerIds?new Set(layerIds):null;return doc.layers.filter(layer=>!selected||selected.has(layer.id)).map(l=>({id:l.id,name:l.name,visible:l.visible,locked:l.locked,opacity:l.opacity,alphaLocked:l.alphaLocked===true,clipped:l.clipped===true,groupId:l.groupId,blendMode:l.blendMode,...(l.text?{text:{...l.text}}:{}),activeDocumentLayerId:doc.activeId,data:l.canvas.getContext('2d')!.getImageData(0,0,doc.width,doc.height)}));}
/** Restores pixel data; history passes preserveStructure=true to update existing surfaces without reallocating canvases. */
export function restore(doc:DocumentModel,s:Snapshot[],preserveStructure=false){
 if(!preserveStructure){doc.layers=s.map(item=>{const layer=makeLayer(doc.width,doc.height,item.name);layer.id=item.id;layer.visible=item.visible;layer.locked=item.locked;layer.opacity=item.opacity;layer.alphaLocked=item.alphaLocked===true;layer.clipped=item.clipped===true;layer.groupId=item.groupId;layer.blendMode=item.blendMode;if(item.text)layer.text={...item.text};layer.canvas.getContext('2d')!.putImageData(item.data,0,0);return layer;});const activeId=s[0]?.activeDocumentLayerId;doc.activeId=doc.layers.some(layer=>layer.id===activeId)?activeId:doc.layers[doc.layers.length-1].id;return;}
 const targets=s.map(item=>({item,layer:doc.layers.find(layer=>layer.id===item.id)}));if(targets.some(({item,layer})=>!layer||(item.data.width!==undefined&&item.data.width!==doc.width)||(item.data.height!==undefined&&item.data.height!==doc.height)))throw new Error('History snapshot no longer matches the document.');for(const {item,layer} of targets)layer!.canvas.getContext('2d')!.putImageData(item.data,0,0);const savedActive=s[0]?.activeDocumentLayerId;if(savedActive&&doc.layers.some(layer=>layer.id===savedActive))doc.activeId=savedActive;
}
