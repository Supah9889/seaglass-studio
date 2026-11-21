import {useCallback,useEffect,useRef,useState} from 'react';
import {getVersion} from '@tauri-apps/api/app';
import {check,type Update} from '@tauri-apps/plugin-updater';
import {isDesktopRuntime} from '../desktop/files';
import {CURRENT_PACKAGE_VERSION,readLastSuccessfulUpdateCheck,recordSuccessfulUpdateCheck,shouldAutoCheckForUpdate,UPDATE_HOST_CONFIGURED,updateChannelForVersion} from '../desktop/updaterState';

type Phase='idle'|'checking'|'current'|'available'|'downloading'|'downloaded'|'installing'|'error';
type Props={dirty:boolean;drawing:boolean;saveBeforeUpdate:()=>Promise<boolean>};
const safeLocalStorage={getItem:(key:string)=>{try{return window.localStorage.getItem(key)}catch{return null}},setItem:(key:string,value:string)=>{try{window.localStorage.setItem(key,value)}catch{/* update status remains usable if preferences are unavailable */}}};

export default function UpdateSettings({dirty,drawing,saveBeforeUpdate}:Props){
 const desktop=isDesktopRuntime(),[version,setVersion]=useState(CURRENT_PACKAGE_VERSION),[phase,setPhase]=useState<Phase>('idle'),[message,setMessage]=useState(''),[lastCheck,setLastCheck]=useState<number|null>(()=>readLastSuccessfulUpdateCheck(safeLocalStorage)),[update,setUpdate]=useState<Update|null>(null),[downloaded,setDownloaded]=useState(0),[contentLength,setContentLength]=useState<number|null>(null);
 const updateRef=useRef<Update|null>(null),checkingRef=useRef(false),mountedRef=useRef(true),downloadedRef=useRef(false);
 const clearUpdate=useCallback(async()=>{const old=updateRef.current;updateRef.current=null;setUpdate(null);downloadedRef.current=false;setDownloaded(0);setContentLength(null);if(old){try{await old.close()}catch{/* resource may already have closed during installation */}}},[]);
 const runCheck=useCallback(async()=>{
  if(!desktop){setMessage('Automatic updates are available in the Windows desktop app.');setPhase('error');return;}
  if(!UPDATE_HOST_CONFIGURED){setMessage('The update host has not been configured for this build yet.');setPhase('error');return;}
  if(checkingRef.current)return;checkingRef.current=true;setMessage('Checking the signed update feed…');setPhase('checking');
  try{
   const result=await check({timeout:12000});
   const now=Date.now();recordSuccessfulUpdateCheck(safeLocalStorage,new Date(now));setLastCheck(now);
   await clearUpdate();
   if(result){updateRef.current=result;setUpdate(result);setMessage('A signed update is available.');setPhase('available');}
   else{setMessage('SeaGlass Studio is up to date.');setPhase('current');}
  }catch(error){console.error('Update check failed',error);if(mountedRef.current){setMessage('Could not check for updates. Check your connection and try again.');setPhase('error');}}
  finally{checkingRef.current=false;}
 },[desktop,clearUpdate]);
 useEffect(()=>{
  mountedRef.current=true;
  if(desktop){void getVersion().then(value=>{if(mountedRef.current)setVersion(value)}).catch(error=>console.error('Could not read desktop version',error));const previous=readLastSuccessfulUpdateCheck(safeLocalStorage);if(UPDATE_HOST_CONFIGURED&&shouldAutoCheckForUpdate(previous))void runCheck();}
  return()=>{mountedRef.current=false;const current=updateRef.current;updateRef.current=null;if(current)void current.close().catch(()=>{});};
 },[]);
 const confirmSaveIfNeeded=async()=>{
  if(!dirty)return true;
  if(!window.confirm('Your artwork has unsaved changes. Save the project before installing this update? Cancel keeps the update from installing.')){setMessage('Update canceled; your artwork is unchanged.');return false;}
  const saved=await saveBeforeUpdate();
  if(!saved){setMessage('Update paused because the project was not fully saved.');return false;}
  return true;
 };
 const startDownload=async()=>{
  if(drawing){setMessage('Finish the active stroke before starting the update.');return;}
  const current=updateRef.current;if(!current)return;
  setDownloaded(0);setContentLength(null);setPhase('downloading');setMessage(`Downloading SeaGlass Studio ${current.version}…`);
  try{
   await current.download(event=>{
    if(!mountedRef.current)return;
    if(event.event==='Started'){setContentLength(event.data.contentLength??null);setDownloaded(0);}
    else if(event.event==='Progress')setDownloaded(value=>value+event.data.chunkLength);
    else if(event.event==='Finished')setMessage('Download complete. Review and install when you are ready.');
   });
   downloadedRef.current=true;setPhase('downloaded');
  }catch(error){console.error('Update download failed',error);setMessage('Update download failed. Your installed app and artwork are unchanged.');setPhase('error');}
 };
 const installUpdate=async()=>{
  if(drawing){setMessage('Finish the active stroke before installing.');return;}
  if(!(await confirmSaveIfNeeded()))return;
  const current=updateRef.current;if(!current||!downloadedRef.current){setMessage('Download the update before installing it.');return;}
  setPhase('installing');setMessage(`Installing SeaGlass Studio ${current.version}…`);
  try{await current.install({restartAfterInstall:true});}
  catch(error){console.error('Update installation failed',error);setMessage('Update installation failed. Your current installation is still available.');setPhase('error');}
 };
 const cancelUpdate=async()=>{await clearUpdate();setPhase('idle');setMessage('Update canceled. The installed app and artwork are unchanged.');};
 const later=()=>setMessage(`Update ${update?.version??''} is available in Settings when you are ready.`);
 const progress=contentLength&&contentLength>0?Math.min(100,Math.round(downloaded/contentLength*100)):null;
 const lastCheckLabel=lastCheck?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(lastCheck):'Never';
 if(!UPDATE_HOST_CONFIGURED)return <details className="update-settings">
  <summary>Public beta <span>{version}</span></summary>
  <p className="update-settings-body">Download installers manually from GitHub Releases.</p>
 </details>;
 return <details className="update-settings"><summary>Updates <span>{version} · {updateChannelForVersion(version)}</span></summary><div className="update-settings-body"><div className="update-version-row"><span>Current version</span><b>{version}</b></div><div className="update-version-row"><span>Update channel</span><b>{updateChannelForVersion(version)}</b></div><div className="update-version-row"><span>Last successful check</span><b>{lastCheckLabel}</b></div><button className="update-check" disabled={phase==='checking'||phase==='downloading'||phase==='installing'} onClick={()=>void runCheck()}>Check for Updates</button>{update&&<><div className="update-release"><strong>Version {update.version} is available</strong>{update.date&&<small>{update.date}</small>}<p>{update.body||'No release notes were provided.'}</p></div>{phase==='available'&&<div className="update-actions"><button className="primary" disabled={drawing} onClick={()=>void startDownload()}>Update Now</button><button onClick={later}>Remind Me Later</button></div>}{phase==='downloading'&&<div className="update-progress"><span>{progress===null?`${Math.round(downloaded/1024)} KiB downloaded`:`Downloading · ${progress}%`}</span><progress max="100" value={progress??0}/></div>}{phase==='downloaded'&&<div className="update-actions"><button className="primary" disabled={drawing} onClick={()=>void installUpdate()}>Install Update</button><button onClick={()=>void cancelUpdate()}>Cancel Update</button></div>}</>}{message&&<p className={`update-message ${phase==='error'?'error':''}`} role="status">{message}</p>}{!desktop&&<small className="update-offline-note">Offline drawing remains available in the browser build.</small>}</div></details>;
}
