import {afterEach,describe,expect,it,vi} from 'vitest';
import {strToU8,unzipSync,zipSync} from 'fflate';
import {decodeProject,encodeProject} from './project';
import {HistoryManager} from './history';
import {captureLayerStructure,duplicateLayer} from './layers';
import {restore,snapshot,type DocumentModel,type Layer} from './document';
import type {TextData} from './text';

afterEach(()=>vi.unstubAllGlobals());

const pngBytes=new Uint8Array([137,80,78,71,13,10,26,10]);
const text:TextData={text:'Hello\nSea',x:10,y:12,width:200,height:60,fontFamily:'Arial, Helvetica, sans-serif',fontSize:24,color:'#205060',align:'center',lineHeight:1.25};
/** A canvas stand-in that records text drawing calls. */
function fakeCanvas(){
 const drawn:string[]=[];
 const ctx={drawn,font:'',fillStyle:'',textAlign:'start',textBaseline:'alphabetic',clearRect:()=>{drawn.length=0;},save:()=>{},restore:()=>{},fillText:(t:string)=>{drawn.push(t);},measureText:(t:string)=>({width:t.length*10}),drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(64),width:4,height:4}),putImageData:()=>{}};
 return{width:4,height:4,ctx,getContext:()=>ctx,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([pngBytes],{type:'image/png'}))};
}
function layer(id:string,extra:Partial<Layer>={}):Layer{return{id,name:id,visible:true,locked:false,opacity:1,canvas:fakeCanvas() as unknown as HTMLCanvasElement,...extra};}
const manifestOf=(bytes:Uint8Array)=>JSON.parse(new TextDecoder().decode(unzipSync(bytes)['manifest.json']));
const stubDecoder=()=>{vi.stubGlobal('createImageBitmap',async()=>({width:4,height:4,close:()=>{}}));vi.stubGlobal('document',{createElement:()=>fakeCanvas()});};

describe('SG-19 text layers in project files',()=>{
 it('writes version 4 with the text source only when a project has a text layer',async()=>{
  const plain:DocumentModel={width:4,height:4,activeId:'a',groups:[],layers:[layer('a')]};
  expect(manifestOf(await encodeProject(plain)).version).toBe(2);
  const withText:DocumentModel={...plain,layers:[layer('a'),layer('t',{text})]};
  const bytes=await encodeProject(withText),manifest=manifestOf(bytes);
  expect(manifest.version).toBe(4);
  expect(manifest.layers[1].text).toEqual(text);
  expect('text' in manifest.layers[0]).toBe(false);
  // The rendered pixels are stored too, so the file reopens identically.
  expect(Object.keys(unzipSync(bytes))).toContain('layers/1.png');
 });
 it('reopens editable text with its rendered pixels, alongside raster layers and blend modes',async()=>{
  stubDecoder();
  const manifest={version:4,width:4,height:4,activeId:'t',groups:[],layers:[{id:'a',name:'Paint',visible:true,locked:false,opacity:1,blendMode:'multiply',path:'layers/0.png'},{id:'t',name:'Hello',visible:false,locked:false,opacity:.5,text,path:'layers/1.png'}]};
  const doc=await decodeProject(zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'layers/0.png':pngBytes,'layers/1.png':pngBytes}));
  expect(doc.layers[1].text).toEqual(text);
  expect(doc.layers[1]).toMatchObject({visible:false,opacity:.5});
  expect(doc.layers[0].text).toBeUndefined();
  expect(doc.layers[0].blendMode).toBe('multiply');
 });
 it('round-trips text through save and reopen',async()=>{
  const saved=await encodeProject({width:4,height:4,activeId:'t',groups:[],layers:[layer('t',{text})]});
  stubDecoder();
  const reopened=await decodeProject(saved);
  expect(reopened.layers[0].text).toEqual(text);
 });
 it('refuses text in an older format version and malformed text, without changing the open document',async()=>{
  stubDecoder();
  const archive=(version:number,value:unknown)=>zipSync({'manifest.json':strToU8(JSON.stringify({version,width:4,height:4,activeId:'a',groups:[],layers:[{id:'a',name:'A',visible:true,locked:false,opacity:1,text:value,path:'layers/0.png'}]})),'layers/0.png':pngBytes});
  await expect(decodeProject(archive(3,text))).rejects.toThrow(/invalid text data/);
  await expect(decodeProject(archive(4,{...text,color:'javascript:alert(1)'}))).rejects.toThrow(/invalid text data/);
  await expect(decodeProject(archive(4,{...text,fontFamily:'x;}</style>'}))).rejects.toThrow(/invalid text data/);
 });
 it('still opens version 1 to 3 projects without text',async()=>{
  stubDecoder();
  for(const version of [1,2,3]){
   const manifest={version,width:4,height:4,activeId:'a',groups:[],layers:[{id:'a',name:'A',visible:true,locked:false,opacity:1,path:'layers/0.png'}]};
   const doc=await decodeProject(zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'layers/0.png':pngBytes}));
   expect(doc.layers[0].text).toBeUndefined();
  }
 });
});

describe('SG-19 text layer history',()=>{
 it('undoes and redoes a text edit and re-renders the layer each time',()=>{
  const t=layer('t',{text}),doc:DocumentModel={width:4,height:4,activeId:'t',layers:[t]},history=new HistoryManager();
  const ctx=(t.canvas as unknown as ReturnType<typeof fakeCanvas>).ctx;
  history.pushText('t',t.text,doc);t.text={...text,text:'Changed'};
  expect(history.undo(doc)).toBe(true);
  expect(t.text).toEqual(text);expect(ctx.drawn).toEqual(['Hello','Sea']);
  expect(history.redo(doc)).toBe(true);
  expect(t.text!.text).toBe('Changed');expect(ctx.drawn).toEqual(['Changed']);
 });
 it('undoes Rasterize by restoring the editable source',()=>{
  const t=layer('t',{text}),doc:DocumentModel={width:4,height:4,activeId:'t',layers:[t]},history=new HistoryManager();
  history.pushText('t',t.text,doc);t.text=undefined;
  expect(history.undo(doc)).toBe(true);expect(t.text).toEqual(text);
  expect(history.redo(doc)).toBe(true);expect(t.text).toBeUndefined();
 });
 it('keeps the recorded source isolated from later in-place edits to the live layer',()=>{
  const t=layer('t',{text:{...text}}),doc:DocumentModel={width:4,height:4,activeId:'t',layers:[t]},history=new HistoryManager();
  history.pushText('t',t.text,doc);t.text!.text='mutated in place';
  history.undo(doc);
  expect(t.text!.text).toBe('Hello\nSea');
 });
 it('skips a text entry whose layer was removed and continues with the next action',()=>{
  const a=layer('a'),t=layer('t',{text}),doc:DocumentModel={width:4,height:4,activeId:'a',layers:[a,t]},history=new HistoryManager();
  const before=captureLayerStructure(doc);a.name='Renamed';history.pushLayerState(before,doc);
  history.pushText('t',text,doc);doc.layers=[a];
  expect(history.undo(doc)).toBe(true);expect(a.name).toBe('a');
 });
 it('removes a newly created text layer on undo and restores it, text intact, on redo',()=>{
  const a=layer('a'),doc:DocumentModel={width:4,height:4,activeId:'a',layers:[a]},history=new HistoryManager();
  const before=captureLayerStructure(doc),t=layer('t',{text});doc.layers.push(t);doc.activeId='t';history.pushLayerState(before,doc);
  history.undo(doc);expect(doc.layers.map(item=>item.id)).toEqual(['a']);
  history.redo(doc);expect(doc.layers[1].text).toEqual(text);expect(doc.activeId).toBe('t');
 });
});

describe('SG-19 text layers with other layer operations',()=>{
 it('duplicates the editable source as an independent copy',()=>{
  vi.stubGlobal('document',{createElement:()=>fakeCanvas()});vi.stubGlobal('crypto',{randomUUID:()=>'copy'});
  const doc:DocumentModel={width:4,height:4,activeId:'t',layers:[layer('t',{text})]};
  const copy=duplicateLayer(doc,'t')!;
  expect(copy.text).toEqual(text);expect(copy.text).not.toBe(doc.layers[0].text);
 });
 it('keeps text through pixel snapshots that rebuild layers',()=>{
  vi.stubGlobal('document',{createElement:()=>fakeCanvas()});vi.stubGlobal('crypto',{randomUUID:()=>'rebuilt'});
  const doc:DocumentModel={width:4,height:4,activeId:'t',layers:[layer('t',{text})]};
  restore(doc,snapshot(doc));
  expect(doc.layers[0].text).toEqual(text);
 });
});
