import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const lock=JSON.parse(await readFile(resolve(root,'package-lock.json'),'utf8'));
const tauri=JSON.parse(await readFile(resolve(root,'src-tauri/tauri.conf.json'),'utf8'));
const cargo=await readFile(resolve(root,'src-tauri/Cargo.toml'),'utf8');
const updaterState=await readFile(resolve(root,'src/desktop/updaterState.ts'),'utf8');
const cargoVersion=cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const uiVersion=updaterState.match(/CURRENT_PACKAGE_VERSION='([^']+)'/)?.[1];
const versions={package:pkg.version,packageLock:lock.version,tauri:tauri.version,cargo:cargoVersion,updaterUi:uiVersion};
if(!Object.values(versions).every(value=>value===pkg.version)){
 console.error('SeaGlass release versions must match in package.json, package-lock.json, tauri.conf.json, and src-tauri/Cargo.toml.',versions);
 process.exit(1);
}
console.log(`Version alignment verified: ${pkg.version}`);
