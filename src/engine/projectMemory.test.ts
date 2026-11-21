import {describe,expect,it,vi} from 'vitest';
import {strToU8,zipSync} from 'fflate';
import {decodeProject,encodeProject,estimateProjectEncodeBytes,estimateProjectLoadBytes,isProjectArchiveSizeSafe,PROJECT_ARCHIVE_LIMIT_BYTES,PROJECT_LOAD_MEMORY_BUDGET_BYTES,PROJECT_MANIFEST_LIMIT_BYTES,PROJECT_UNCOMPRESSED_LIMIT_BYTES} from './project';
import type {DocumentModel,Layer} from './document';

describe('project decode memory preflight',()=>{
 it('estimates raster surfaces plus archive and inflated entry buffers',()=>{
  const surfaces=1024*768*4*(3+4);
  expect(estimateProjectLoadBytes(1024,768,3,100,200)).toBe(surfaces+300);
  expect(estimateProjectLoadBytes(4097,1,1)).toBeNull();
  expect(estimateProjectLoadBytes(100,100,101)).toBeNull();
  expect(estimateProjectEncodeBytes(3840,2160,4)).toBeLessThan(PROJECT_LOAD_MEMORY_BUDGET_BYTES);
  // SG-17: reader and writer share one working-set estimate (layers + 4 surfaces).
  expect(estimateProjectEncodeBytes(4096,4096,12)).toBe(PROJECT_LOAD_MEMORY_BUDGET_BYTES);
  expect(estimateProjectEncodeBytes(4096,4096,13)).toBeGreaterThan(PROJECT_LOAD_MEMORY_BUDGET_BYTES);
  expect(estimateProjectEncodeBytes(1024,768,100)).toBe(estimateProjectLoadBytes(1024,768,100));
  expect(isProjectArchiveSizeSafe(PROJECT_ARCHIVE_LIMIT_BYTES)).toBe(true);
  expect(isProjectArchiveSizeSafe(PROJECT_ARCHIVE_LIMIT_BYTES+1)).toBe(false);
 });
 it('rejects high-memory projects before allocating canvases',async()=>{
  const archive=zipSync({'manifest.json':strToU8(JSON.stringify({version:2,width:4096,height:4096,activeId:'layer-0',groups:[],layers:Array.from({length:12},(_,index)=>({id:`layer-${index}`,name:`Layer ${index}`,visible:true,locked:false,opacity:1,path:`layers/${index}.png`}))})),...Object.fromEntries(Array.from({length:12},(_,index)=>[`layers/${index}.png`,new Uint8Array([1,2,3])]))});
  const createElement=vi.fn();vi.stubGlobal('document',{createElement});
  await expect(decodeProject(archive)).rejects.toThrow(/1024 MiB safety budget/);
  expect(createElement).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
 });
 it('rejects missing image references before creating layer surfaces',async()=>{
  const archive=zipSync({'manifest.json':strToU8(JSON.stringify({version:1,width:2,height:2,activeId:'a',layers:[{id:'a',name:'A',path:'layers/missing.png'}]}))});
  const createElement=vi.fn();vi.stubGlobal('document',{createElement});
  await expect(decodeProject(archive)).rejects.toThrow(/image reference is missing/);
  expect(createElement).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
 });
 it('rejects ZIP entries advertising excessive expanded data before unzip',async()=>{
  const archive=zipSync({'manifest.json':strToU8('{}')}),view=new DataView(archive.buffer,archive.byteOffset,archive.byteLength);
  let central=-1;for(let offset=0;offset<archive.length-4;offset++)if(view.getUint32(offset,true)===0x02014b50){central=offset;break;}
  expect(central).toBeGreaterThanOrEqual(0);view.setUint32(central+24,PROJECT_UNCOMPRESSED_LIMIT_BYTES+1,true);
  await expect(decodeProject(archive)).rejects.toThrow(/768 MiB safety limit/);
 });
 it('rejects an oversized manifest before inflating it',async()=>{
  const archive=zipSync({'manifest.json':strToU8('{}')}),view=new DataView(archive.buffer,archive.byteOffset,archive.byteLength);
  let central=-1;for(let offset=0;offset<archive.length-4;offset++)if(view.getUint32(offset,true)===0x02014b50){central=offset;break;}
  view.setUint32(central+24,PROJECT_MANIFEST_LIMIT_BYTES+1,true);
  await expect(decodeProject(archive)).rejects.toThrow(/4 MiB metadata limit/);
 });
 it('rejects high-memory project saves before encoding any layer',async()=>{
  const toBlob=vi.fn(),layers=Array.from({length:13},(_,i)=>({id:`l${i}`,name:`Layer ${i}`,visible:true,locked:false,opacity:1,canvas:{width:4096,height:4096,toBlob}} as unknown as Layer)),doc:DocumentModel={width:4096,height:4096,layers,activeId:'l0',groups:[]};
  await expect(encodeProject(doc)).rejects.toThrow(/1024 MiB safety budget/);
  expect(toBlob).not.toHaveBeenCalled();
 });
});

describe('SG-17 shared working-set budget',()=>{
 const doc=(width:number,height:number,count:number)=>({width,height,layers:Array.from({length:count},()=>({}) as Layer)});
 it('admits a small document all the way to the 100-layer limit',async()=>{
  const {layerAdmissionMessage,DOCUMENT_LAYER_LIMIT_MESSAGE}=await import('./document');
  expect(layerAdmissionMessage(doc(1024,768,99))).toBeNull();
  expect(layerAdmissionMessage(doc(1024,768,100))).toBe(DOCUMENT_LAYER_LIMIT_MESSAGE);
 });
 it('refuses the layer that would make a 4096² document unsaveable, with an explicit reason',async()=>{
  const {layerAdmissionMessage,DOCUMENT_MEMORY_LIMIT_MESSAGE}=await import('./document');
  // Adding layer n+1 needs (n+1 + 4 working + 2 archive reserve) × 64 MiB ≤ 1024 MiB: ten layers fit.
  expect(layerAdmissionMessage(doc(4096,4096,9))).toBeNull();
  expect(layerAdmissionMessage(doc(4096,4096,10))).toBe(DOCUMENT_MEMORY_LIMIT_MESSAGE);
 });
 it('keeps 3840×2160 UHD editing well above typical layer counts',async()=>{
  const {layerAdmissionMessage}=await import('./document');
  expect(layerAdmissionMessage(doc(3840,2160,25))).toBeNull();
  expect(layerAdmissionMessage(doc(3840,2160,26))).not.toBeNull();
 });
 it('lets every project the reader accepts pass the writer check',()=>{
  for(const [w,h] of [[4096,4096],[3840,2160],[1920,1080],[1024,768]] as const){
   for(let layers=1;layers<=100;layers++){
    const load=estimateProjectLoadBytes(w,h,layers,0,0);
    if(load!==null&&load<=PROJECT_LOAD_MEMORY_BUDGET_BYTES)expect(estimateProjectEncodeBytes(w,h,layers)!).toBeLessThanOrEqual(PROJECT_LOAD_MEMORY_BUDGET_BYTES);
   }
  }
 });
});

describe('SG-17 reopenable saves',()=>{
 it('refuses to write an archive the reader would reject, before any file exists',async()=>{
  // Ten 4096² layers pass the pre-encode check (14 × 64 MiB = 896 MiB), but 100 MiB PNGs push
  // the reopen estimate over the budget.
  const png=new Uint8Array(100*1024*1024);
  const layers=Array.from({length:10},(_,i)=>({id:`l${i}`,name:`Layer ${i}`,visible:true,locked:false,opacity:1,canvas:{width:4096,height:4096,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([png.subarray(0,1024*1024)],{type:'image/png'}))}} as unknown as Layer));
  // Use small real blobs but report large entry sizes through the estimate inputs instead.
  expect(estimateProjectLoadBytes(4096,4096,10,png.byteLength*10,png.byteLength*10)!).toBeGreaterThan(PROJECT_LOAD_MEMORY_BUDGET_BYTES);
  const doc:DocumentModel={width:4096,height:4096,layers,activeId:'l0',groups:[]};
  const bytes=await encodeProject(doc); // 1 MiB PNGs: reopenable, so it succeeds
  expect(estimateProjectLoadBytes(4096,4096,10,bytes.byteLength,bytes.byteLength)!).toBeLessThanOrEqual(PROJECT_LOAD_MEMORY_BUDGET_BYTES);
 });
 it('reports the reopen limit when encoded layers are too large to reopen',async()=>{
  // 11 layers: 15 × 64 MiB = 960 MiB working set; 77 MiB of entries tips the reopen estimate over 1024 MiB.
  const big=new Uint8Array(7*1024*1024);
  const layers=Array.from({length:11},(_,i)=>({id:`l${i}`,name:`Layer ${i}`,visible:true,locked:false,opacity:1,canvas:{width:4096,height:4096,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([big],{type:'image/png'}))}} as unknown as Layer));
  const doc:DocumentModel={width:4096,height:4096,layers,activeId:'l0',groups:[]};
  await expect(encodeProject(doc)).rejects.toThrow(/Reopening this project would need/);
 },30000);
});
