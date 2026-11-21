import {afterEach,describe,expect,it,vi} from 'vitest';
import {unzipSync} from 'fflate';
import {decodeProject,encodeProject,StaleProjectRevisionError} from './project';
import type {DocumentModel,Layer} from './document';
import {MAX_DOCUMENT_LAYERS} from './document';
const bytes=new Uint8Array([137,80,78,71,1,2,3,4]);
function layer(id:string,name:string,visible:boolean,opacity:number):Layer{const canvas={toBlob:(cb:(blob:Blob)=>void)=>cb(new Blob([bytes],{type:'image/png'}))} as unknown as HTMLCanvasElement;return{id,name,visible,locked:id==='second',opacity,alphaLocked:id==='first',clipped:id==='second',canvas};}
afterEach(()=>vi.unstubAllGlobals());

function delayedProject(){
 const first=layer('first','Sketch',true,1),second=layer('second','Color',true,1);
 let release:(blob:Blob|null)=>void=()=>{},secondPixels=bytes;
 first.canvas.toBlob=callback=>{release=callback;};
 const encodeSecond=vi.fn<HTMLCanvasElement['toBlob']>(callback=>callback(new Blob([secondPixels])));
 second.canvas.toBlob=encodeSecond;
 const doc:DocumentModel={width:32,height:24,layers:[first,second],activeId:'second',groups:[{id:'g',name:'Art',visible:true,locked:false,opacity:1}]};
 return {doc,second,encodeSecond,finish:(blob:Blob=new Blob([bytes]))=>release(blob),paintSecond:()=>{
  secondPixels=new Uint8Array([...bytes,255]);
 }};
}

describe('coherent project encoding',()=>{
 it.each(['rename','paint','reorder','add','delete','active layer','group property','replace document'] as const)(
  'withholds the archive when %s changes during the first PNG callback',async edit=>{
   const {doc,second,finish,encodeSecond,paintSecond}=delayedProject();
   let current=doc,revision=1;
   const write=vi.fn();
   const saving=encodeProject(doc,()=>current===doc&&revision===1).then(write);
   switch(edit){
    case 'rename': second.name='Renamed';break;
    case 'paint': paintSecond();break;
    case 'reorder': doc.layers.reverse();break;
    case 'add': doc.layers.push(layer('third','New',true,1));break;
    case 'delete': doc.layers.pop();break;
    case 'active layer': doc.activeId='first';break;
    case 'group property': doc.groups![0].opacity=.5;break;
    case 'replace document': current={...doc};break;
   }
   if(edit!=='replace document')revision++;
   finish();
   await expect(saving).rejects.toBeInstanceOf(StaleProjectRevisionError);
   expect(encodeSecond).not.toHaveBeenCalled();
   expect(write).not.toHaveBeenCalled();
  },
 );

 it('checks the revision after reading the encoded PNG bytes',async()=>{
  const {doc,encodeSecond,finish}=delayedProject();
  let current=true,finishRead:(buffer:ArrayBuffer)=>void=()=>{};
  const blob=new Blob([bytes]);
  blob.arrayBuffer=vi.fn(()=>new Promise<ArrayBuffer>(resolve=>{finishRead=resolve;}));
  const saving=encodeProject(doc,()=>current);
  finish(blob);
  await Promise.resolve();
  expect(blob.arrayBuffer).toHaveBeenCalledOnce();
  current=false;
  finishRead(new ArrayBuffer(8));
  await expect(saving).rejects.toBeInstanceOf(StaleProjectRevisionError);
  expect(encodeSecond).not.toHaveBeenCalled();
 });

 it('snapshots metadata and ordered canvas references before the first asynchronous read',async()=>{
  const {doc,second,finish,encodeSecond}=delayedProject();
  const saving=encodeProject(doc);
  second.name='Different';
  second.canvas=layer('replacement','Replacement',true,1).canvas;
  doc.layers.reverse();
  doc.activeId='first';
  doc.groups![0].name='Different group';
  finish();
  const archive=unzipSync(await saving),manifest=JSON.parse(new TextDecoder().decode(archive['manifest.json']));
  expect(manifest.layers.map(({name}:{name:string})=>name)).toEqual(['Sketch','Color']);
  expect(manifest.activeId).toBe('second');
  expect(manifest.groups[0].name).toBe('Art');
  expect(encodeSecond).toHaveBeenCalledOnce();
 });
});

describe('editable project archive',()=>{
 it('roundtrips layer order, legacy properties, Alpha Lock, clipping, and exact layer image bytes',async()=>{const first=layer('first','Sketch',true,.75),second=layer('second','Color',false,.4),doc:DocumentModel={width:320,height:240,layers:[first,second],activeId:'second'};const archive=await encodeProject(doc),files=unzipSync(archive),manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));expect(manifest.layers.map((l:{name:string})=>l.name)).toEqual(['Sketch','Color']);expect(manifest.layers.map((l:{alphaLocked:boolean;clipped:boolean})=>[l.alphaLocked,l.clipped])).toEqual([[true,false],[false,true]]);expect(files['layers/0.png']).toEqual(bytes);expect(files['layers/1.png']).toEqual(bytes);const drawImage=vi.fn(),contexts:any[]=[];vi.stubGlobal('document',{createElement:()=>{const ctx={drawImage};contexts.push(ctx);return{width:0,height:0,getContext:()=>ctx}}});vi.stubGlobal('createImageBitmap',async(blob:Blob)=>({blob,width:320,height:240,close:vi.fn()}));const reopened=await decodeProject(archive);expect(reopened.width).toBe(320);expect(reopened.height).toBe(240);expect(reopened.layers.map(l=>[l.id,l.name,l.visible,l.locked,l.opacity,l.alphaLocked,l.clipped])).toEqual([['first','Sketch',true,false,.75,true,false],['second','Color',false,true,.4,false,true]]);expect(reopened.activeId).toBe('second');expect(drawImage).toHaveBeenCalledTimes(2);});
 it('reopens a selected native File through its ArrayBuffer without using Tauri filesystem reads',async()=>{const doc:DocumentModel={width:64,height:48,layers:[layer('selected','Selected file',true,1)],activeId:'selected'},archive=await encodeProject(doc),selected=new File([archive],'Untitled 12.seaglass',{type:'application/octet-stream'}),selectedBytes=new Uint8Array(await selected.arrayBuffer()),ctx={drawImage:vi.fn()};vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>ctx})});vi.stubGlobal('createImageBitmap',async()=>({width:64,height:48,close:vi.fn()}));const reopened=await decodeProject(selectedBytes);expect(reopened.layers[0].name).toBe('Selected file');expect(reopened.layers[0].id).toBe('selected');expect(ctx.drawImage).toHaveBeenCalledTimes(1);});
 it('preserves native 4K document dimensions through existing project serialization',async()=>{const doc:DocumentModel={width:3840,height:2160,layers:[layer('4k','4K art',true,1)],activeId:'4k'},archive=await encodeProject(doc),files=unzipSync(archive),manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));expect([manifest.width,manifest.height]).toEqual([3840,2160]);const ctx={drawImage:vi.fn()};vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>ctx})});vi.stubGlobal('createImageBitmap',async()=>({width:3840,height:2160,close:vi.fn()}));const reopened=await decodeProject(archive);expect([reopened.width,reopened.height,reopened.layers[0].canvas.width,reopened.layers[0].canvas.height]).toEqual([3840,2160,3840,2160]);});
 it('rejects projects with unsupported version or unsafe dimensions',async()=>{const{strToU8,zipSync}=await import('fflate');for(const manifest of [{version:2,width:2,height:2,layers:[{}]},{version:1,width:5000,height:2,layers:[{}]}]){const archive=zipSync({'manifest.json':strToU8(JSON.stringify(manifest))});await expect(decodeProject(archive)).rejects.toThrow();}});
 it('saves a 100-layer document and rejects a 101-layer document',async()=>{const layers=Array.from({length:MAX_DOCUMENT_LAYERS},(_,index)=>layer(`layer-${index}`,`Layer ${index}`,true,1)),doc:DocumentModel={width:320,height:240,layers,activeId:'layer-0'};await expect(encodeProject(doc)).resolves.toBeInstanceOf(Uint8Array);doc.layers.push(layer('layer-100','Layer 100',true,1));await expect(encodeProject(doc)).rejects.toThrow('layer count');});
 it('loads older manifests with Alpha Lock and clipping disabled by default',async()=>{const{strToU8,zipSync}=await import('fflate'),archive=zipSync({'manifest.json':strToU8(JSON.stringify({version:1,width:2,height:2,activeId:'legacy',layers:[{id:'legacy',name:'Old layer',path:'layers/0.png'}]})),'layers/0.png':bytes}),ctx={drawImage:vi.fn()};vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>ctx})});vi.stubGlobal('createImageBitmap',async()=>({width:2,height:2,close:vi.fn()}));const doc=await decodeProject(archive);expect(doc.activeId).toBe('legacy');expect(doc.layers[0]).toMatchObject({id:'legacy',name:'Old layer',visible:true,locked:false,opacity:1,alphaLocked:false,clipped:false});});
 it('roundtrips group membership and group visibility, opacity, and lock properties in version 2',async()=>{const a=layer('a','Base',true,.8),b=layer('b','Shade',true,.65);a.groupId='g';b.groupId='g';const doc:DocumentModel={width:32,height:24,layers:[a,b],activeId:'b',groups:[{id:'g',name:'Character',visible:false,locked:true,opacity:.42}]},archive=await encodeProject(doc),manifest=JSON.parse(new TextDecoder().decode(unzipSync(archive)['manifest.json']));expect(manifest.version).toBe(2);expect(manifest.groups).toEqual([{id:'g',name:'Character',visible:false,locked:true,opacity:.42}]);expect(manifest.layers.map((l:{groupId?:string})=>l.groupId)).toEqual(['g','g']);const ctx={drawImage:vi.fn()};vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>ctx})});vi.stubGlobal('createImageBitmap',async()=>({width:32,height:24,close:vi.fn()}));const reopened=await decodeProject(archive);expect(reopened.groups).toEqual(doc.groups);expect(reopened.layers.map(l=>l.groupId)).toEqual(['g','g']);});
 it('rejects missing group references, malformed group properties, and noncontiguous members',async()=>{const{strToU8,zipSync}=await import('fflate'),base={version:2,width:2,height:2,activeId:'a',groups:[{id:'g',name:'G',visible:true,locked:false,opacity:1}],layers:[{id:'a',name:'A',path:'layers/0.png',groupId:'missing'}]},archive=(manifest:unknown)=>zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'layers/0.png':bytes});await expect(decodeProject(archive(base))).rejects.toThrow('missing group');await expect(decodeProject(archive({...base,layers:[{id:'a',name:'A',path:'layers/0.png',groupId:'g'},{id:'b',name:'B',path:'layers/0.png'},{id:'c',name:'C',path:'layers/0.png',groupId:'g'}]}))).rejects.toThrow('contiguous');await expect(decodeProject(archive({...base,groups:[{id:'g',name:' ',visible:true,locked:false,opacity:1}],layers:[{id:'a',name:'A',path:'layers/0.png',groupId:'g'}]}))).rejects.toThrow('invalid layer group');});
});
