import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDocument,estimateDocumentMemoryBytes,isValidDocumentSize,restore,snapshot,type DocumentModel, type Layer} from './document';
afterEach(()=>vi.unstubAllGlobals());
describe('document history snapshots',()=>{
 it('restores each layer, metadata, stacking order, and active layer across edits',()=>{const pixelA={tag:'a'},pixelB={tag:'b'},ctxA={getImageData:()=>pixelA},ctxB={getImageData:()=>pixelB};const mk=(id:string,name:string,ctx:any,visible=true)=>({id,name,visible,locked:false,opacity:.8,canvas:{getContext:()=>ctx}} as unknown as Layer);const a=mk('A','Sketch',ctxA),b=mk('B','Color',ctxB,false),doc:DocumentModel={width:4,height:4,layers:[a,b],activeId:'A'},before=snapshot(doc);doc.layers=[];doc.activeId='lost';const inserted:any[]=[];vi.stubGlobal('crypto',{randomUUID:()=>`new-${inserted.length}`});vi.stubGlobal('document',{createElement:()=>{const ctx={putImageData:(data:unknown)=>inserted.push(data)};return{width:0,height:0,getContext:()=>ctx}}});restore(doc,before);expect(doc.layers.map(l=>[l.id,l.name,l.visible,l.opacity])).toEqual([['A','Sketch',true,.8],['B','Color',false,.8]]);expect(doc.activeId).toBe('A');expect(inserted).toEqual([pixelA,pixelB]);});
});
describe('document resolution limits and estimates',()=>{
 it('accepts common and 4K document dimensions while enforcing allocation bounds',()=>{
  for(const [w,h] of [[1024,768],[1920,1080],[2048,2048],[3840,2160],[4096,4096]])expect(isValidDocumentSize(w,h)).toBe(true);
  expect(isValidDocumentSize(4097,1)).toBe(false);expect(isValidDocumentSize(4096,4097)).toBe(false);expect(isValidDocumentSize(4096,4096.5)).toBe(false);expect(isValidDocumentSize(4096,4096)).toBe(true);
 });
 it('estimates base canvas buffers and extra layer/history memory without allocating pixels',()=>{
  expect(estimateDocumentMemoryBytes(1024,768)).toBe(1024*768*12);expect(estimateDocumentMemoryBytes(100,50,2)).toBe(100*50*16);expect(estimateDocumentMemoryBytes(100,50,1,1)).toBe(100*50*16);expect(estimateDocumentMemoryBytes(5000,5000)).toBeNull();
 });
 it('initializes a new document at the exact requested pixel dimensions',()=>{
  const made:any[]=[];vi.stubGlobal('crypto',{randomUUID:()=>`new-${made.length}`});vi.stubGlobal('document',{createElement:()=>{const canvas={width:0,height:0,getContext:()=>({})};made.push(canvas);return canvas;}});
  const doc=createDocument(3840,2160,'Artwork');expect([doc.width,doc.height,doc.layers[0].canvas.width,doc.layers[0].canvas.height]).toEqual([3840,2160,3840,2160]);expect(doc.layers[0].name).toBe('Artwork');expect(made).toHaveLength(1);expect(()=>createDocument(4097,2160)).toThrow(RangeError);
 });
});
