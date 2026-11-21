// Generate THIRD-PARTY-NOTICES.txt for the Windows installer.
//
// Covers every Rust crate linked into the Windows application (normal, non-proc-macro
// dependencies of the app crate for x86_64-pc-windows-msvc) and every JavaScript package
// bundled into the frontend (production dependencies in package-lock.json). License texts are
// read from the local crate registry and node_modules; identical texts are printed once.
// A package that ships no license file uses an authoritative upstream text from
// scripts/notice-overrides/ (each records its source); the standard SPDX text naming the
// declared authors is only a last resort and is reported.
//
// Usage: node scripts/generate-notices.mjs [--check]
//   --check  exit non-zero if the committed file is out of date.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const output=path.join(root,'THIRD-PARTY-NOTICES.txt');
const check=process.argv.includes('--check');
const LICENSE_FILE=/^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i;

const MIT_TEXT=holders=>`MIT License

Copyright (c) ${holders}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const BSD3_TEXT=holders=>`BSD 3-Clause License

Copyright (c) ${holders}

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const MPL_NOTICE=()=>`This component is licensed under the Mozilla Public License, v. 2.0, and is distributed unmodified. Its source code is available from the repository listed for it in the component list, and the license text is available at https://mozilla.org/MPL/2.0/.`;

const FALLBACK={MIT:MIT_TEXT,'BSD-3-Clause':BSD3_TEXT,'MPL-2.0':MPL_NOTICE};
const OVERRIDE_DIR=path.join(root,'scripts','notice-overrides');
const readOverride=file=>readFileSync(path.join(OVERRIDE_DIR,file),'utf8').replace(/\r\n/g,'\n').trim();
/** Upstream license files for packages that do not include one in their published archive. */
const OVERRIDES={
 // Keyed by name@version so an upgraded crate never silently reuses an older text.
 'webview2-com@0.39.1':['webview2-rs.LICENSE'],
 'webview2-com-sys@0.39.1':['webview2-rs.LICENSE'],
 'alloc-stdlib@0.3.0':['alloc-stdlib.LICENSE'],
 'selectors@0.38.0':['MPL-2.0.txt'],
};
const holderNames=authors=>authors.map(author=>author.replace(/\s*<[^>]*>/,'').trim()).filter(Boolean);

function overrideTexts(pkg){
 return (OVERRIDES[`${pkg.name}@${pkg.version}`]??[]).map(file=>({file:`notice-overrides/${file}`,text:readOverride(file)}));
}

function fallbackText(pkg){
 const id=String(pkg.license).split(/\s+OR\s+|\//)[0].trim();
 const template=FALLBACK[id];
 if(!template)return [];
 const names=holderNames(pkg.authors??[]);
 const holders=names.length?names.join(', '):`the ${pkg.name} authors`;
 return [{file:`${id} standard text (the package ships no license file)`,text:template(holders)}];
}

function licenseTexts(dir){
 if(!dir||!existsSync(dir))return [];
 return readdirSync(dir,{withFileTypes:true})
  .filter(entry=>entry.isFile()&&LICENSE_FILE.test(entry.name))
  .sort((a,b)=>a.name.localeCompare(b.name))
  .map(entry=>({file:entry.name,text:readFileSync(path.join(dir,entry.name),'utf8').replace(/\r\n/g,'\n').trim()}));
}

function rustPackages(){
 const metadata=JSON.parse(execFileSync('cargo',['metadata','--format-version','1','--offline','--locked','--filter-platform','x86_64-pc-windows-msvc'],{cwd:path.join(root,'src-tauri'),encoding:'utf8',maxBuffer:256*1024*1024}));
 const byId=new Map(metadata.packages.map(pkg=>[pkg.id,pkg]));
 const nodes=new Map(metadata.resolve.nodes.map(node=>[node.id,node]));
 const rootId=metadata.resolve.root;
 const seen=new Set(),queue=[rootId];
 while(queue.length){
  const id=queue.shift();
  if(seen.has(id))continue;
  seen.add(id);
  for(const dep of nodes.get(id)?.deps??[]){
   // Only normal dependencies are linked into the shipped binary; build scripts and proc macros are not.
   if(!dep.dep_kinds.some(kind=>kind.kind===null))continue;
   const pkg=byId.get(dep.pkg);
   if(pkg&&!pkg.targets.every(target=>target.kind.includes('proc-macro')))queue.push(dep.pkg);
  }
 }
 seen.delete(rootId);
 const tree=new Set(execFileSync('cargo',['tree','--offline','--locked','--target','x86_64-pc-windows-msvc','-e','normal','--prefix','none','--format','{p}'],{cwd:path.join(root,'src-tauri'),encoding:'utf8',maxBuffer:64*1024*1024})
  .split(/\r?\n/).map(line=>line.replace(/ \(.*$/,'').trim()).filter(Boolean));
 return [...seen].map(id=>byId.get(id)).filter(pkg=>tree.has(`${pkg.name} v${pkg.version}`)).map(pkg=>({
  ecosystem:'Rust crate',name:pkg.name,version:pkg.version,license:pkg.license??'UNKNOWN',
  repository:pkg.repository??'',authors:pkg.authors??[],texts:licenseTexts(path.dirname(pkg.manifest_path)),
 }));
}

function npmPackages(){
 const lock=JSON.parse(readFileSync(path.join(root,'package-lock.json'),'utf8'));
 const packages=lock.packages;
 const resolve=(from,name)=>{
  // Walk up nested node_modules folders the way Node resolves packages.
  let base=from;
  for(;;){
   const candidate=`${base?`${base}/`:''}node_modules/${name}`;
   if(packages[candidate])return candidate;
   if(!base)return null;
   const index=base.lastIndexOf('/node_modules/');
   base=index<0?'':base.slice(0,index);
  }
 };
 const seen=new Set(),queue=Object.keys(packages[''].dependencies??{}).map(name=>resolve('',name)).filter(Boolean);
 while(queue.length){
  const key=queue.shift();
  if(seen.has(key))continue;
  seen.add(key);
  const entry=packages[key];
  for(const name of Object.keys({...entry.dependencies,...entry.optionalDependencies})){
   const next=resolve(key,name);
   if(next&&!packages[next].dev)queue.push(next);
  }
 }
 return [...seen].map(key=>{
  const entry=packages[key],dir=path.join(root,key);
  const manifest=existsSync(path.join(dir,'package.json'))?JSON.parse(readFileSync(path.join(dir,'package.json'),'utf8')):{};
  const repository=typeof manifest.repository==='string'?manifest.repository:manifest.repository?.url??'';
  const author=typeof manifest.author==='string'?manifest.author:manifest.author?.name;
  return {ecosystem:'JavaScript package',name:key.slice(key.lastIndexOf('node_modules/')+13),version:entry.version,license:entry.license??manifest.license??'UNKNOWN',repository,authors:author?[author]:[],texts:licenseTexts(dir)};
 });
}

const STATIC_NOTICES=()=>`
================================================================================
Installer and platform components
================================================================================

NSIS (Nullsoft Scriptable Install System)
  The Windows installer is built with NSIS. The NSIS installer runtime is licensed
  under the zlib/libpng license; its LZMA compression code is licensed under the
  Common Public License 1.0 with a special exception for installers, and its bzip2
  code under a BSD-style license. Full terms: https://nsis.sourceforge.io/License

Microsoft WebView2 SDK loader (statically linked)
  The application links WebView2LoaderStatic.lib from the Microsoft WebView2 SDK
  (Microsoft.Web.WebView2 NuGet package, vendored by webview2-com-sys 0.39.1). Its license
  and the package notice follow.

${readOverride('microsoft-webview2-sdk.LICENSE')}

${readOverride('microsoft-webview2-sdk.NOTICE')}

Microsoft Edge WebView2 Runtime
  SeaGlass Studio displays its interface with the Microsoft Edge WebView2 Runtime.
  On computers without it, the installer runs Microsoft's WebView2 bootstrapper,
  which downloads the runtime from Microsoft. WebView2 is distributed by Microsoft
  under its own license terms: https://developer.microsoft.com/microsoft-edge/webview2/
`;

const packages=[...rustPackages(),...npmPackages()]
 .map(pkg=>{
  if(pkg.texts.length)return pkg;
  const overrides=overrideTexts(pkg);
  return overrides.length?{...pkg,texts:overrides}:{...pkg,fallback:true,texts:fallbackText(pkg)};
 })
 .sort((a,b)=>a.ecosystem.localeCompare(b.ecosystem)||a.name.localeCompare(b.name)||a.version.localeCompare(b.version,undefined,{numeric:true}));
const missing=packages.filter(pkg=>!pkg.texts.length);
const fallbacks=packages.filter(pkg=>pkg.fallback&&pkg.texts.length);
const groups=new Map();
for(const pkg of packages){
 pkg.textIds=[];
 for(const {text} of pkg.texts){
  const hash=createHash('sha256').update(text).digest('hex').slice(0,12);
  if(!groups.has(hash))groups.set(hash,{text,users:[]});
  groups.get(hash).users.push(`${pkg.name} ${pkg.version}`);
  pkg.textIds.push(hash);
 }
}

const rustCount=packages.filter(pkg=>pkg.ecosystem==='Rust crate').length;
let out=`SeaGlass Studio - third-party notices
Generated by scripts/generate-notices.mjs from Cargo.lock (x86_64-pc-windows-msvc, crates
linked into the application) and package-lock.json (bundled production dependencies). Do not edit by hand.

${packages.length} components: ${rustCount} Rust crates, ${packages.length-rustCount} JavaScript packages.

================================================================================
Component list
================================================================================
`;
for(const pkg of packages){
 out+=`\n${pkg.ecosystem}: ${pkg.name} ${pkg.version}\n  License: ${pkg.license}\n`;
 const names=holderNames(pkg.authors??[]);
 if(names.length)out+=`  Authors: ${names.join(', ')}\n`;
 if(pkg.repository)out+=`  Source: ${pkg.repository}\n`;
 if(pkg.ecosystem==='Rust crate'&&pkg.license.includes('MPL-2.0')){
  out+=`  Versioned source archive: https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate\n`;
 }
 out+=pkg.textIds.length?`  License text: ${pkg.textIds.map(id=>`[${id}]`).join(' ')}${pkg.fallback?' (standard text; the package ships no license file)':''}\n`:'  License text: unavailable\n';
}
out+=`\n================================================================================\nLicense texts\n================================================================================\n`;
for(const [id,{text,users}] of [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
 out+=`\n--- [${id}] used by: ${users.join(', ')}\n\n${text}\n`;
}
out+=STATIC_NOTICES();

if(check){
 const current=existsSync(output)?readFileSync(output,'utf8').replace(/\r\n/g,'\n'):'';
 if(current!==out){console.error('THIRD-PARTY-NOTICES.txt is out of date. Run: node scripts/generate-notices.mjs');process.exitCode=1;}
 else console.log(`Notices are current (${packages.length} components, ${groups.size} distinct license texts).`);
}else{
 writeFileSync(output,out);
 console.log(`Wrote ${path.relative(root,output)}: ${packages.length} components, ${groups.size} distinct license texts.`);
}
if(fallbacks.length)console.log(`Standard SPDX text used for: ${fallbacks.map(p=>`${p.name} ${p.version} (${p.license})`).join(', ')}`);
if(missing.length){console.error(`No license text available for: ${missing.map(p=>`${p.name} ${p.version} (${p.license})`).join(', ')}`);process.exitCode=1;}
