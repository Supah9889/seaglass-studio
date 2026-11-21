export const CURRENT_PACKAGE_VERSION='0.1.0-beta.5';
export const LAST_UPDATE_CHECK_KEY='seaglass-last-successful-update-check';
export const UPDATE_CHECK_INTERVAL_MS=24*60*60*1000;

export type UpdateChannel='beta'|'stable';
export function updateChannelForVersion(version:string):UpdateChannel{
 return /-(?:alpha|beta|rc)(?:[.-]|\d)/i.test(version)?'beta':'stable';
}
export function readLastSuccessfulUpdateCheck(storage:Pick<Storage,'getItem'>,key=LAST_UPDATE_CHECK_KEY):number|null{
 try{
  const raw=storage.getItem(key);if(!raw)return null;
  const value=Date.parse(raw);return Number.isFinite(value)&&value>0?value:null;
 }catch{return null;}
}
export function shouldAutoCheckForUpdate(lastCheck:number|null,now=Date.now(),interval=UPDATE_CHECK_INTERVAL_MS){
 return lastCheck===null||!Number.isFinite(lastCheck)||now-lastCheck>=interval;
}
export function recordSuccessfulUpdateCheck(storage:Pick<Storage,'setItem'>,date=new Date(),key=LAST_UPDATE_CHECK_KEY){
 try{storage.setItem(key,date.toISOString());return true;}catch{return false;}
}

export const IS_PRIVATE_BETA=(import.meta as {env?:{MODE?:string}}).env?.MODE==='private-beta';
export const UPDATE_HOST_CONFIGURED=false;
