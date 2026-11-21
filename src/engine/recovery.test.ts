import 'fake-indexeddb/auto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {MAX_RECOVERY_RECORDS,clearRecovery,listRecoveryRecords,loadRecovery,releaseRecoveryClaim,retireRecovery,saveRecovery,setRecoveryOrigin,type RecoveryRecord} from './project';
import type {DocumentModel,Layer} from './document';
import {unzipSync} from 'fflate';

const pixelBytes=new Uint8Array([137,80,78,71,7,6,5]);
const instantCanvas=()=>({toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([pixelBytes],{type:'image/png'}))}) as unknown as HTMLCanvasElement;

/** A canvas whose PNG callback waits until the test releases it. */
function delayedCanvas(){
 let release:()=>void=()=>{};
 const canvas={toBlob:(cb:(b:Blob)=>void)=>{release=()=>cb(new Blob([pixelBytes],{type:'image/png'}));}} as unknown as HTMLCanvasElement;
 return {canvas,release:()=>release()};
}

function makeDoc(name='Recovery test',canvas=instantCanvas()):DocumentModel{
 return {width:64,height:48,activeId:'layer-a',layers:[{id:'layer-a',name,visible:true,locked:false,opacity:1,canvas} as unknown as Layer]};
}
const rename=(doc:DocumentModel,name:string,canvas=instantCanvas())=>{doc.layers=[{...doc.layers[0],name,canvas}];};
const layerName=(record:{bytes:Uint8Array}|undefined)=>JSON.parse(new TextDecoder().decode(unzipSync(record!.bytes)['manifest.json'])).layers[0].name;
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

function openRaw(){return new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('seaglass-studio-recovery',1);req.onupgradeneeded=()=>req.result.createObjectStore('session');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function emptyStore(){
 await new Promise<void>((resolve,reject)=>{const req=indexedDB.deleteDatabase('seaglass-studio-recovery');req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);req.onblocked=()=>resolve();});
}
async function putRaw(key:string,value:unknown){
 const db=await openRaw();
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('session','readwrite');tx.objectStore('session').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
 finally{db.close();}
}
async function getRaw(key:string){
 const db=await openRaw();
 try{return await new Promise<unknown>((resolve,reject)=>{const req=db.transaction('session').objectStore('session').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
 finally{db.close();}
}
/** Every stored archive record, newest first, read straight from IndexedDB. */
async function stored():Promise<RecoveryRecord[]>{
 const db=await openRaw();
 try{
  const values=await new Promise<unknown[]>((resolve,reject)=>{const req=db.transaction('session').objectStore('session').getAll(IDBKeyRange.bound('doc:','doc:￿'));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  return (values as RecoveryRecord[]).sort((a,b)=>b.savedAt-a.savedAt||b.revision-a.revision);
 }finally{db.close();}
}
async function only(){const records=await stored();expect(records).toHaveLength(1);return records[0];}
/** Simulate another tab holding a document's lease. */
function holdInOtherTab(documentId:string){
 let release:()=>void=()=>{};
 const held=new Promise<void>(done=>{release=done;});
 const acquired=new Promise<void>(ready=>{void navigator.locks.request(`seaglass-recovery:${documentId}`,()=>{ready();return held;});});
 return acquired.then(()=>release);
}

describe('local crash recovery storage',()=>{
 beforeEach(emptyStore);
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

 it('persists a recoverable project snapshot with its identity and revision, then clears it',async()=>{
  const doc=makeDoc();
  expect(await saveRecovery(doc,1)).toBe(true);
  const record=await only();
  expect(record.revision).toBe(1);
  expect(record.documentId).toMatch(/\S+/);
  expect(record.savedAt).toBeGreaterThan(0);
  expect(unzipSync(record.bytes)['layers/0.png']).toEqual(pixelBytes);
  expect(layerName(record)).toBe('Recovery test');
  expect(await clearRecovery(doc,1)).toBe(true);
  expect(await stored()).toEqual([]);
  expect(await listRecoveryRecords()).toEqual([]);
 });

 it('keeps the latest of repeated sequential recovery saves',async()=>{
  const doc=makeDoc();
  await saveRecovery(doc,1);
  rename(doc,'Latest session');
  await saveRecovery(doc,2);
  expect(layerName(await only())).toBe('Latest session');
 });

 it('does not let a slower stale snapshot overwrite a newer recovery save',async()=>{
  const slow=delayedCanvas(),doc=makeDoc('Older',slow.canvas);
  const pending=saveRecovery(doc,1);
  await flush();
  rename(doc,'Newer');
  expect(await saveRecovery(doc,2)).toBe(true);
  slow.release();
  expect(await pending).toBe(false);
  const record=await only();
  expect(record.revision).toBe(2);
  expect(layerName(record)).toBe('Newer');
 });

 it('refuses a recovery request for a revision older than one already requested',async()=>{
  const doc=makeDoc('Newer');
  await saveRecovery(doc,5);
  rename(doc,'Older');
  expect(await saveRecovery(doc,4)).toBe(false);
  expect(layerName(await only())).toBe('Newer');
 });

 it('keeps newer recovery when an earlier manual save finishes afterwards',async()=>{
  const doc=makeDoc('Saved revision');
  await saveRecovery(doc,1);
  rename(doc,'Painted during picker');
  await saveRecovery(doc,2);
  expect(await clearRecovery(doc,1)).toBe(true);
  const record=await only();
  expect(record.revision).toBe(2);
  expect(layerName(record)).toBe('Painted during picker');
 });

 it('lets a newer write proceed while a clear for an older revision is in flight',async()=>{
  const doc=makeDoc('Saved');
  await saveRecovery(doc,1);
  rename(doc,'After save');
  const clearing=clearRecovery(doc,1),writing=saveRecovery(doc,2);
  await clearing;
  expect(await writing).toBe(true);
  expect((await only()).revision).toBe(2);
 });

 it('does not allow an in-flight write for a cleared revision to recreate recovery',async()=>{
  const slow=delayedCanvas(),doc=makeDoc('Pending',slow.canvas);
  const pending=saveRecovery(doc,3);
  await flush();
  expect(await clearRecovery(doc,3)).toBe(true);
  slow.release();
  expect(await pending).toBe(false);
  expect(await stored()).toEqual([]);
 });

 it('blocks stale writes after explicit discard but still records later edits',async()=>{
  const slow=delayedCanvas(),doc=makeDoc('Discarded',slow.canvas);
  const pending=saveRecovery(doc,2);
  await flush();
  await clearRecovery(doc,2);
  slow.release();
  expect(await pending).toBe(false);
  expect(await saveRecovery(doc,2)).toBe(false);
  rename(doc,'Edited after a failed close');
  expect(await saveRecovery(doc,3)).toBe(true);
  expect(layerName(await only())).toBe('Edited after a failed close');
 });

 it('retires every write from a replaced document',async()=>{
  const slow=delayedCanvas(),old=makeDoc('Replaced',slow.canvas);
  const pending=saveRecovery(old,7);
  await flush();
  await retireRecovery(old);
  slow.release();
  expect(await pending).toBe(false);
  expect(await saveRecovery(old,99)).toBe(false);
  expect(await stored()).toEqual([]);
 });

 it('skips the clear when the caller is no longer current',async()=>{
  const doc=makeDoc();
  await saveRecovery(doc,1);
  expect(await clearRecovery(doc,1,()=>false)).toBe(false);
  expect((await only()).revision).toBe(1);
 });

 describe('separate documents',()=>{
  it('stores each document separately so neither overwrites the other',async()=>{
   const a=makeDoc('Document A'),b=makeDoc('Document B');
   await saveRecovery(a,1);
   await saveRecovery(b,1);
   rename(a,'Document A, later');
   await saveRecovery(a,2);
   expect((await stored()).map(layerName).sort()).toEqual(['Document A, later','Document B']);
  });

  it('clears only the saving document\'s record',async()=>{
   const other=makeDoc('Other document'),doc=makeDoc('Saved document');
   await saveRecovery(other,4);
   await saveRecovery(doc,9);
   expect(await clearRecovery(doc,10)).toBe(true);
   expect(layerName(await only())).toBe('Other document');
  });

  it('keeps a bounded number of records, evicting the oldest closed sessions first',async()=>{
   const orphans=MAX_RECOVERY_RECORDS+1;
   for(let i=0;i<orphans;i++){
    await putRaw(`doc:closed-${i}`,{documentId:`closed-${i}`,revision:1,savedAt:100+i,bytes:pixelBytes});
    await putRaw(`meta:closed-${i}`,{documentId:`closed-${i}`,revision:1,savedAt:100+i});
   }
   const live=makeDoc('Open document');
   await saveRecovery(live,1);
   const ids=(await stored()).map(record=>record.documentId);
   expect(ids).toHaveLength(MAX_RECOVERY_RECORDS);
   expect(ids.filter(id=>!id.startsWith('closed-'))).toHaveLength(1); // the open document kept its record
   expect(ids).not.toContain('closed-0');
   expect(ids).not.toContain('closed-1');
   expect(ids).toContain(`closed-${orphans-1}`);
  });

  it('never evicts a document that is still open, even beyond the bound',async()=>{
   const open=Array.from({length:MAX_RECOVERY_RECORDS+2},(_,i)=>makeDoc(`Open ${i}`));
   for(const doc of open)await saveRecovery(doc,1);
   expect(await stored()).toHaveLength(open.length);
  });
 });

 describe('restoring',()=>{
  it('offers an orphaned record and not a live document from this tab',async()=>{
   const live=makeDoc('Still open');
   await saveRecovery(live,3);
   await putRaw('doc:crashed',{documentId:'crashed',revision:2,savedAt:1,bytes:(await only()).bytes});
   await putRaw('meta:crashed',{documentId:'crashed',revision:2,savedAt:1});
   const offered=await loadRecovery();
   expect(offered?.documentId).toBe('crashed');
   releaseRecoveryClaim(offered!);
  });

  it('never offers a session another tab is still editing',async()=>{
   const crashed=makeDoc('Crashed session');
   await saveRecovery(crashed,2);
   const {documentId,bytes,revision}=await only();
   await retireRecovery(crashed); // releases this tab's lease but also deletes; put the record back as an orphan
   await putRaw(`doc:${documentId}`,{documentId,revision,savedAt:5,bytes});
   await putRaw(`meta:${documentId}`,{documentId,revision,savedAt:5});
   const release=await holdInOtherTab(documentId);
   expect(await loadRecovery({busyRetryMs:0})).toBeUndefined();
   release();
   await flush();
   expect((await loadRecovery())?.documentId).toBe(documentId);
  });

  it('lets only one tab claim a session, and releases a declined claim',async()=>{
   await putRaw('doc:orphan',{documentId:'orphan',revision:1,savedAt:3,bytes:pixelBytes});
   await putRaw('meta:orphan',{documentId:'orphan',revision:1,savedAt:3});
   const first=await loadRecovery();
   expect(first?.documentId).toBe('orphan');
   expect(await loadRecovery({busyRetryMs:0})).toBeUndefined();
   releaseRecoveryClaim(first!);
   await flush();
   expect((await loadRecovery())?.documentId).toBe('orphan');
  });

  it('waits for a busy newer session instead of offering an older one',async()=>{
   for(const [id,savedAt] of [['older',10],['reloading',20]] as const){
    await putRaw(`doc:${id}`,{documentId:id,revision:1,savedAt,bytes:pixelBytes});
    await putRaw(`meta:${id}`,{documentId:id,revision:1,savedAt});
   }
   const release=await holdInOtherTab('reloading');
   setTimeout(release,300); // the reloading page lets go shortly after
   const offered=await loadRecovery({busyRetryMs:1500});
   expect(offered?.documentId).toBe('reloading');
   releaseRecoveryClaim(offered!);
  });

  it('offers the newest orphaned session first',async()=>{
   for(const [id,savedAt] of [['older',10],['newest',30],['middle',20]] as const){
    await putRaw(`doc:${id}`,{documentId:id,revision:1,savedAt,bytes:pixelBytes});
    await putRaw(`meta:${id}`,{documentId:id,revision:1,savedAt});
   }
   const offered=await loadRecovery();
   expect(offered?.documentId).toBe('newest');
   releaseRecoveryClaim(offered!);
  });

  it('supersedes the source record on the restored document\'s first write',async()=>{
   await putRaw('doc:crashed',{documentId:'crashed',revision:3,savedAt:1,bytes:pixelBytes});
   await putRaw('meta:crashed',{documentId:'crashed',revision:3,savedAt:1});
   const record=(await loadRecovery())!;
   const restored=makeDoc('Restored');
   setRecoveryOrigin(restored,record);
   await saveRecovery(restored,1);
   const remaining=await only();
   expect(layerName(remaining)).toBe('Restored');
   expect(await getRaw('meta:crashed')).toBeUndefined();
  });

  it('lets a restored document retire exactly the record it came from',async()=>{
   await putRaw('doc:crashed',{documentId:'crashed',revision:3,savedAt:1,bytes:pixelBytes});
   await putRaw('meta:crashed',{documentId:'crashed',revision:3,savedAt:1});
   const record=(await loadRecovery())!;
   const restored=makeDoc('Restored');
   setRecoveryOrigin(restored,record);
   expect(await clearRecovery(restored,1)).toBe(true);
   expect(await stored()).toEqual([]);
  });

  it('does not let a restored document retire a newer record from its source session',async()=>{
   await putRaw('doc:crashed',{documentId:'crashed',revision:3,savedAt:1,bytes:pixelBytes});
   await putRaw('meta:crashed',{documentId:'crashed',revision:3,savedAt:1});
   const record=(await loadRecovery())!;
   const restored=makeDoc('Restored');
   setRecoveryOrigin(restored,record);
   await putRaw('meta:crashed',{documentId:'crashed',revision:4,savedAt:2});
   await clearRecovery(restored,1);
   expect(await getRaw('meta:crashed')).toEqual({documentId:'crashed',revision:4,savedAt:2});
  });
 });

 describe('records from earlier versions',()=>{
  it('migrates a raw pre-identity recovery archive in place',async()=>{
   const legacy=makeDoc('Legacy session');
   await saveRecovery(legacy,1);
   const bytes=(await only()).bytes;
   await emptyStore();
   await putRaw('latest',bytes);
   const migrated=await loadRecovery();
   expect(migrated?.revision).toBe(0);
   expect(migrated?.documentId).toMatch(/\S+/);
   expect(layerName(migrated)).toBe('Legacy session');
   expect(await getRaw('latest')).toBeUndefined();
   releaseRecoveryClaim(migrated!);
   // A second read returns the same migrated identity rather than inventing a new one.
   expect((await loadRecovery())?.documentId).toBe(migrated?.documentId);
  });

  it('migrates a single-slot identity record written by the previous version',async()=>{
   await putRaw('latest',{documentId:'previous-version',revision:6,bytes:pixelBytes});
   const migrated=await loadRecovery();
   expect(migrated).toMatchObject({documentId:'previous-version',revision:6,savedAt:0});
   expect(await getRaw('doc:previous-version')).toBeDefined();
   expect(await getRaw('latest')).toBeUndefined();
  });

  it('does not let a legacy value replace a newer keyed record for the same document',async()=>{
   await putRaw('doc:same',{documentId:'same',revision:9,savedAt:50,bytes:new Uint8Array([9])});
   await putRaw('meta:same',{documentId:'same',revision:9,savedAt:50});
   await putRaw('latest',{documentId:'same',revision:3,bytes:new Uint8Array([3])});
   await listRecoveryRecords();
   expect(await getRaw('meta:same')).toEqual({documentId:'same',revision:9,savedAt:50});
   expect(await getRaw('latest')).toBeUndefined();
  });

  it('leaves an unreadable stored value untouched and still offers valid sessions',async()=>{
   await putRaw('latest',{unexpected:true});
   await putRaw('doc:valid',{documentId:'valid',revision:1,savedAt:1,bytes:pixelBytes});
   await putRaw('meta:valid',{documentId:'valid',revision:1,savedAt:1});
   expect((await loadRecovery())?.documentId).toBe('valid');
   expect(await getRaw('latest')).toEqual({unexpected:true});
  });
 });

 describe('storage failures',()=>{
  it('surfaces unavailable browser storage as a failed save without mutating artwork',async()=>{
   const doc=makeDoc();
   vi.stubGlobal('indexedDB',{open:()=>{throw new DOMException('disabled','UnknownError')}});
   await expect(saveRecovery(doc,1)).rejects.toThrow();
   expect(doc.layers[0].name).toBe('Recovery test');
  });

  it('surfaces a quota failure and keeps the previous record',async()=>{
   const doc=makeDoc('Before quota');
   await saveRecovery(doc,1);
   vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError');});
   rename(doc,'Too large');
   await expect(saveRecovery(doc,2)).rejects.toThrow('full');
   vi.restoreAllMocks();
   const record=await only();
   expect(record.revision).toBe(1);
   expect(layerName(record)).toBe('Before quota');
  });
 });
});
