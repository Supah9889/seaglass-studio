import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({isTauri:vi.fn(),save:vi.fn(),invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:mocks.isTauri,invoke:mocks.invoke}));
vi.mock('@tauri-apps/plugin-dialog',()=>({save:mocks.save}));

import {DesktopSaveError,saveDesktopFile} from './files';

const chosen='C:\\Art\\Untitled 12.seaglass';
const headersOf=(call:unknown[])=>(call[2] as {headers:Record<string,string>}).headers;

describe('desktop project writes',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.isTauri.mockReturnValue(true);mocks.save.mockResolvedValue(chosen);mocks.invoke.mockResolvedValue(undefined);});
 afterEach(()=>vi.unstubAllGlobals());

 it('reports save completion only after the atomic native write resolves',async()=>{
  let finishWrite:()=>void=()=>{};
  mocks.invoke.mockImplementation(()=>new Promise<void>(resolve=>{finishWrite=resolve;}));
  let completed=false;
  const bytes=new Uint8Array([1,2,3]);
  const saving=saveDesktopFile(bytes,'SeaGlass project','seaglass','Untitled 12.seaglass').then(result=>{completed=result;return result;});
  await vi.waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('save_file_atomically',bytes,expect.anything()));
  const headers=headersOf(mocks.invoke.mock.calls[0]);
  expect(decodeURIComponent(headers['approved-path'])).toBe(chosen);
  expect(decodeURIComponent(headers['target-path'])).toBe(chosen);
  expect(completed).toBe(false);
  finishWrite();
  await expect(saving).resolves.toBe(true);
  expect(completed).toBe(true);
 });

 it('sends the dialog path as approved and the normalized extension path as target',async()=>{
  mocks.save.mockResolvedValue('C:\\Art\\Sketch');
  await saveDesktopFile(new Uint8Array([1]),'SeaGlass project','seaglass','Sketch.seaglass');
  const headers=headersOf(mocks.invoke.mock.calls[0]);
  expect(decodeURIComponent(headers['approved-path'])).toBe('C:\\Art\\Sketch');
  expect(decodeURIComponent(headers['target-path'])).toBe('C:\\Art\\Sketch.seaglass');
 });

 it('keeps a case-different existing extension instead of appending another',async()=>{
  mocks.save.mockResolvedValue('C:\\Art\\Sketch.SEAGLASS');
  await saveDesktopFile(new Uint8Array([1]),'SeaGlass project','seaglass','Sketch.seaglass');
  expect(decodeURIComponent(headersOf(mocks.invoke.mock.calls[0])['target-path'])).toBe('C:\\Art\\Sketch.SEAGLASS');
 });

 it('does not write or report success when the native save dialog is canceled',async()=>{
  mocks.save.mockResolvedValue(null);
  await expect(saveDesktopFile(new Uint8Array([1]),'SeaGlass project','seaglass','Untitled.seaglass')).resolves.toBe(false);
  expect(mocks.invoke).not.toHaveBeenCalled();
 });

 it('surfaces the native failure message instead of reporting success',async()=>{
  mocks.invoke.mockRejectedValue('The existing file could not be replaced (the file is open in another program); it was left unchanged.');
  const failure=saveDesktopFile(new Uint8Array([1]),'SeaGlass project','seaglass','Untitled.seaglass');
  await expect(failure).rejects.toBeInstanceOf(DesktopSaveError);
  await expect(failure).rejects.toThrow('open in another program');
 });
});
