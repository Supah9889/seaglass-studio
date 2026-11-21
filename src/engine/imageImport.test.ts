import {afterEach,describe,expect,it,vi} from 'vitest';
import {unzipSync} from 'fflate';
import {createDocument,MAX_DOCUMENT_LAYERS,makeLayer} from './document';
import {captureLayerStructure} from './layers';
import {HistoryManager} from './history';
import {encodeProject} from './project';
import {clipboardPastePriority,importImageAsLayer,imageLayerName,isSupportedImageFile,openImageAsDocument} from './imageImport';
import type {DocumentModel} from './document';

afterEach(()=>vi.unstubAllGlobals());
const pngBytes=new Uint8Array([137,80,78,71,1,2,3]);
function setupBitmap(width:number,height:number){
  const drawImage=vi.fn(),ctx={drawImage};
  const createCanvas=()=>({width:0,height:0,getContext:()=>ctx,toBlob:(callback:(blob:Blob)=>void)=>callback(new Blob([pngBytes],{type:'image/png'}))});
  const bitmap={width,height,close:vi.fn()};
  vi.stubGlobal('crypto',{randomUUID:()=>`id-${width}-${height}`});
  vi.stubGlobal('document',{createElement:createCanvas});
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
  return{drawImage,bitmap,decoder:globalThis.createImageBitmap as ReturnType<typeof vi.fn>};
}
const file=(name:string,type='')=>({name,type} as File);

describe('local image importing',()=>{
  it.each([['art.png','image/png'],['photo.jpg','image/jpeg'],['texture.webp','image/webp']])('opens supported format %s at native dimensions',async(name,type)=>{
    const f=file(name,type),m=setupBitmap(320,180),doc=await openImageAsDocument(f);
    expect(isSupportedImageFile(f)).toBe(true);expect([doc.width,doc.height]).toEqual([320,180]);expect(doc.layers).toHaveLength(1);expect(doc.layers[0].name).toBe(imageLayerName(name));expect(m.drawImage).toHaveBeenCalledWith(m.bitmap,0,0);expect(m.bitmap.close).toHaveBeenCalledOnce();
  });
  it('keeps source alpha intact by drawing the decoded bitmap directly without flattening',async()=>{
    const m=setupBitmap(16,12);await openImageAsDocument(file('alpha.png','image/png'));
    expect(m.drawImage.mock.calls[0][0]).toBe(m.bitmap);expect(m.drawImage.mock.calls[0]).toHaveLength(3);
  });
  it('imports as a centered native-scale regular layer and reports clipping at document edges',async()=>{
    const m=setupBitmap(120,60),doc=createDocument(100,80,'Background'),result=await importImageAsLayer(file('wide.png'),doc);
    expect(result.clipped).toBe(true);expect([result.layer.canvas.width,result.layer.canvas.height]).toEqual([100,80]);expect(m.drawImage).toHaveBeenCalledWith(m.bitmap,-10,10);expect(result.layer).toMatchObject({visible:true,locked:false,opacity:1,name:'wide'});expect(doc.layers).toHaveLength(1);
  });
  it('centers an imported image when it fits, without changing the document or its layers',async()=>{
    const m=setupBitmap(20,10),doc=createDocument(100,80),original=doc.layers[0],result=await importImageAsLayer(file('detail.jpeg'),doc);
    expect(result.clipped).toBe(false);expect(m.drawImage).toHaveBeenCalledWith(m.bitmap,40,35);expect(doc.layers).toEqual([original]);
  });
  it('allows import at 99 layers and rejects import at 100 before decoding',async()=>{
    const m=setupBitmap(8,8),doc=createDocument(32,24);
    while(doc.layers.length<MAX_DOCUMENT_LAYERS-1)doc.layers.push(makeLayer(doc.width,doc.height,`Layer ${doc.layers.length+1}`));
    const imported=await importImageAsLayer(file('at-limit.png'),doc);
    doc.layers.push(imported.layer);
    expect(doc.layers).toHaveLength(MAX_DOCUMENT_LAYERS);
    m.decoder.mockClear();
    await expect(importImageAsLayer(file('over-limit.png'),doc)).rejects.toThrow('100-layer project limit');
    expect(m.decoder).not.toHaveBeenCalled();
    expect(doc.layers).toHaveLength(MAX_DOCUMENT_LAYERS);
  });
  it('rechecks the layer limit after image decoding before allocating an imported layer',async()=>{
    const setup=setupBitmap(8,8),bitmap=setup.bitmap,doc=createDocument(32,24);
    while(doc.layers.length<MAX_DOCUMENT_LAYERS-1)doc.layers.push(makeLayer(doc.width,doc.height,`Layer ${doc.layers.length+1}`));
    let finishDecode!:(value:typeof bitmap)=>void;
    vi.stubGlobal('createImageBitmap',()=>new Promise<typeof bitmap>(resolve=>{finishDecode=resolve;}));
    const pending=importImageAsLayer(file('racing.png'),doc);
    doc.layers.push(makeLayer(doc.width,doc.height,'Concurrent layer'));
    finishDecode(bitmap);
    await expect(pending).rejects.toThrow('100-layer project limit');
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(doc.layers).toHaveLength(MAX_DOCUMENT_LAYERS);
  });
  it('rejects unsupported and undecodable files with friendly errors',async()=>{
    const m=setupBitmap(10,10);await expect(openImageAsDocument(file('notes.txt','text/plain'))).rejects.toThrow('Choose a PNG, JPEG, or WebP');await expect(openImageAsDocument(file('renamed.jpg','image/gif'))).rejects.toThrow('Choose a PNG, JPEG, or WebP');expect(m.decoder).not.toHaveBeenCalled();
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>{throw new Error('bad image')}));await expect(openImageAsDocument(file('broken.webp'))).rejects.toThrow('could not be decoded');
  });
  it('rejects images beyond global document limits without resizing and releases the bitmap',async()=>{
    const m=setupBitmap(4097,20);await expect(openImageAsDocument(file('huge.png'))).rejects.toThrow('was not resized');expect(m.bitmap.close).toHaveBeenCalledOnce();expect(m.drawImage).not.toHaveBeenCalled();
  });
  it('makes imported layers a one-action undoable / redoable layer change',async()=>{
    const m=setupBitmap(8,8),doc=createDocument(32,24),{layer}=await importImageAsLayer(file('new.png'),doc),history=new HistoryManager(),before=captureLayerStructure(doc);
    doc.layers.push(layer);doc.activeId=layer.id;history.pushLayerState(before,doc);expect(history.undo(doc)).toBe(true);expect(doc.layers).toHaveLength(1);expect(history.redo(doc)).toBe(true);expect(doc.layers[1]).toBe(layer);expect(doc.activeId).toBe(layer.id);expect(m.drawImage).toHaveBeenCalled();
  });
  it('serializes imported content through the existing .seaglass layer format',async()=>{
    const m=setupBitmap(8,8),doc=createDocument(32,24,'Base'),{layer}=await importImageAsLayer(file('overlay.webp'),doc);doc.layers.push(layer);doc.activeId=layer.id;
    const archive=unzipSync(await encodeProject(doc)),manifest=JSON.parse(new TextDecoder().decode(archive['manifest.json']));
    expect(manifest.layers.map((entry:{name:string})=>entry.name)).toEqual(['Base','overlay']);expect(archive['layers/1.png']).toEqual(pngBytes);
  });
  it('prioritizes SeaGlass selection clipboard over system image paste',()=>{
    expect(clipboardPastePriority(true)).toBe('selection');expect(clipboardPastePriority(false)).toBe('system-image');
  });
});
