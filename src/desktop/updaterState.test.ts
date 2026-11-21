import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {CURRENT_PACKAGE_VERSION,IS_PRIVATE_BETA,LAST_UPDATE_CHECK_KEY,UPDATE_CHECK_INTERVAL_MS,UPDATE_HOST_CONFIGURED,readLastSuccessfulUpdateCheck,recordSuccessfulUpdateCheck,shouldAutoCheckForUpdate,updateChannelForVersion} from './updaterState';

function storage(initial?:string){const values=new Map<string,string>();if(initial)values.set(LAST_UPDATE_CHECK_KEY,initial);return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},values};}

describe('desktop update state',()=>{
 it('matches the update gate to the actual Vite build mode',()=>{
  const mode=(import.meta as {env?:{MODE?:string}}).env?.MODE;
  expect(IS_PRIVATE_BETA).toBe(mode==='private-beta');
  expect(UPDATE_HOST_CONFIGURED).toBe(false);
 });
 it('isolates the beta install and disables update permissions',()=>{
  const base=JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8'));
  const beta=JSON.parse(readFileSync('src-tauri/tauri.private-beta.conf.json','utf8'));
  expect(base.identifier).not.toBe(beta.identifier);
  expect(base.productName).not.toBe(beta.productName);
  expect(beta.mainBinaryName).toBe('seaglass-public-beta');
  expect(beta.version??base.version).toBe(CURRENT_PACKAGE_VERSION);
  expect(beta.build.frontendDist).not.toBe(base.build.frontendDist);
  expect(beta.build.beforeBuildCommand).toContain('--mode private-beta');
  expect(beta.bundle.createUpdaterArtifacts).toBe(false);
  expect(beta.plugins.updater.endpoints).toEqual([]);
  expect(beta.app.security.capabilities).toMatchObject([{
   identifier:'private-beta',windows:['main'],permissions:['core:default','dialog:default','fs:allow-write-file'],
  }]);
  expect(base.plugins.updater.endpoints).toEqual([]);
  expect(base.plugins.updater.pubkey).toBe('');
  expect(beta.identifier).toBe('studio.seaglass.publicbeta');
  expect(base.bundle.resources['../LICENSE']).toBe('LICENSE');
  expect(base.bundle.resources['../THIRD-PARTY-NOTICES.txt']).toBe('THIRD-PARTY-NOTICES.txt');
 });
 it('identifies beta/stable channels and keeps the displayed version aligned with package metadata',()=>{expect(updateChannelForVersion('0.1.0-beta.1')).toBe('beta');expect(updateChannelForVersion('1.0.0-rc.2')).toBe('beta');expect(updateChannelForVersion('1.0.0')).toBe('stable');const pkg=JSON.parse(readFileSync('package.json','utf8')) as {version:string};expect(CURRENT_PACKAGE_VERSION).toBe(pkg.version);});
 it('checks at startup when no successful check exists and rate limits repeat checks for 24 hours',()=>{const now=Date.UTC(2026,10,15);expect(shouldAutoCheckForUpdate(null,now)).toBe(true);expect(shouldAutoCheckForUpdate(now-UPDATE_CHECK_INTERVAL_MS+1,now)).toBe(false);expect(shouldAutoCheckForUpdate(now-UPDATE_CHECK_INTERVAL_MS,now)).toBe(true);});
 it('persists only successful check timestamps and recovers from corrupted storage',()=>{const s=storage(),when=new Date('2026-11-15T12:00:00Z');expect(recordSuccessfulUpdateCheck(s,when)).toBe(true);expect(readLastSuccessfulUpdateCheck(s)).toBe(when.getTime());const broken=storage('not a date');expect(readLastSuccessfulUpdateCheck(broken)).toBe(null);});
 it('handles unavailable local storage without breaking offline drawing',()=>{const denied={getItem:()=>{throw new Error('denied')},setItem:()=>{throw new Error('denied')}};expect(readLastSuccessfulUpdateCheck(denied)).toBe(null);expect(recordSuccessfulUpdateCheck(denied)).toBe(false);});
 it('does not auto-check more than once when already checked recently',()=>{const now=Date.now(),spy=vi.fn();if(shouldAutoCheckForUpdate(now-1000,now))spy();expect(spy).not.toHaveBeenCalled();});
});
