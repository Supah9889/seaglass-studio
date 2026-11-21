import {afterEach,describe,expect,it,vi} from 'vitest';
import {strToU8,unzipSync,zipSync} from 'fflate';
import {decodeProject,encodeProject} from './project';
import {composite} from './paint';
import {captureLayerStructure,duplicateLayer,restoreLayerStructure,setLayerBlendMode} from './layers';
import type {DocumentModel,Layer} from './document';

afterEach(()=>vi.unstubAllGlobals());

const pngBytes=new Uint8Array([137,80,78,71,13,10,26,10]);
function layer(id:string,extra:Partial<Layer>={}):Layer{
 return {id,name:id,visible:true,locked:false,opacity:1,canvas:{width:4,height:4,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([pngBytes],{type:'image/png'})),getContext:()=>({drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(64)})})} as unknown as HTMLCanvasElement,...extra};
}
const manifestOf=(bytes:Uint8Array)=>JSON.parse(new TextDecoder().decode(unzipSync(bytes)['manifest.json']));

describe('SG-14 layer blend modes',()=>{
 it('composites ordinary layers with their mode and keeps clipped children Normal',()=>{
  const ops:string[]=[];
  const ctx={globalAlpha:1,_op:'source-over',set globalCompositeOperation(v:string){this._op=v;},get globalCompositeOperation(){return this._op;},clearRect:()=>{},drawImage:(canvas:{id?:string})=>ops.push(`${canvas.id}:${ctx._op}`)};
  const scratch={width:4,height:4,getContext:()=>ctx};
  vi.stubGlobal('document',{createElement:()=>scratch});
  const mk=(id:string,extra:Partial<Layer>={})=>({...layer(id,extra),canvas:{id,width:4,height:4} as unknown as HTMLCanvasElement});
  const doc:DocumentModel={width:4,height:4,activeId:'top',groups:[],layers:[mk('bottom'),mk('mult',{blendMode:'multiply'}),mk('clip',{clipped:true,blendMode:'screen'}),mk('screen',{blendMode:'screen'})]};
  const out={width:4,height:4,getContext:()=>ctx} as unknown as HTMLCanvasElement;
  composite(doc,out);
  expect(ops).toContain('bottom:source-over');
  expect(ops).toContain('mult:multiply');
  expect(ops).toContain('screen:screen');
  expect(ops.find(op=>op.startsWith('clip:'))).toBe('clip:source-over');
  expect(ctx._op).toBe('source-over');
 });

 it('keeps writing version 2 when every layer is Normal, and version 3 otherwise',async()=>{
  const plain:DocumentModel={width:4,height:4,activeId:'a',groups:[],layers:[layer('a'),layer('b',{blendMode:'normal'})]};
  const normal=manifestOf(await encodeProject(plain));
  expect(normal.version).toBe(2);
  expect(normal.layers.some((item:{blendMode?:string})=>'blendMode' in item)).toBe(false);
  const blended:DocumentModel={...plain,layers:[layer('a'),layer('b',{blendMode:'multiply'})]};
  const v3=manifestOf(await encodeProject(blended));
  expect(v3.version).toBe(3);
  expect(v3.layers[1].blendMode).toBe('multiply');
  expect('blendMode' in v3.layers[0]).toBe(false);
 });

 it('reopens a version 3 project with its blend modes',async()=>{
  vi.stubGlobal('createImageBitmap',async()=>({width:4,height:4,close:()=>{}}));
  vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage:()=>{}})})});
  const manifest={version:3,width:4,height:4,activeId:'b',groups:[],layers:[{id:'a',name:'A',visible:true,locked:false,opacity:1,path:'layers/0.png'},{id:'b',name:'B',visible:true,locked:false,opacity:1,blendMode:'screen',path:'layers/1.png'}]};
  const doc=await decodeProject(zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'layers/0.png':pngBytes,'layers/1.png':pngBytes}));
  expect(doc.layers.map(item=>item.blendMode)).toEqual([undefined,'screen']);
 });

 it('rejects blend data in an older format and unknown modes, before allocating layers',async()=>{
  const createElement=vi.fn();vi.stubGlobal('document',{createElement});
  const archive=(version:number,mode:string)=>zipSync({'manifest.json':strToU8(JSON.stringify({version,width:4,height:4,activeId:'a',groups:[],layers:[{id:'a',name:'A',visible:true,locked:false,opacity:1,blendMode:mode,path:'layers/0.png'}]})),'layers/0.png':pngBytes});
  await expect(decodeProject(archive(2,'multiply'))).rejects.toThrow(/unsupported blend mode/);
  await expect(decodeProject(archive(3,'overlay'))).rejects.toThrow(/unsupported blend mode/);
  expect(createElement).not.toHaveBeenCalled();
 });

 it('gives a readable error for projects from a newer version',async()=>{
  const archive=zipSync({'manifest.json':strToU8(JSON.stringify({version:5,width:4,height:4,activeId:'a',layers:[]}))});
  await expect(decodeProject(archive)).rejects.toThrow(/newer version of SeaGlass Studio/);
 });

 it('records blend changes in structural history and copies them on duplicate',()=>{
  vi.stubGlobal('document',{createElement:()=>({width:4,height:4,getContext:()=>({drawImage:()=>{}})})});
  vi.stubGlobal('crypto',{randomUUID:()=>'copy-id'});
  const doc:DocumentModel={width:4,height:4,activeId:'a',groups:[],layers:[layer('a')]};
  const before=captureLayerStructure(doc);
  expect(setLayerBlendMode(doc,'a','multiply')).toBe(true);
  expect(setLayerBlendMode(doc,'a','multiply')).toBe(false);
  expect(duplicateLayer(doc,'a')?.blendMode).toBe('multiply');
  restoreLayerStructure(doc,before);
  expect(doc.layers.map(item=>item.blendMode)).toEqual([undefined]);
  expect(setLayerBlendMode(doc,'a','normal')).toBe(false);
 });
});
