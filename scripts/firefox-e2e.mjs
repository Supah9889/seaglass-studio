import {execFileSync} from 'node:child_process';
import {mkdtemp,readdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {strToU8,unzipSync,zipSync} from 'fflate';

const require=createRequire(import.meta.url);
const {Builder,Button,By,Key,Select,until}=require('selenium-webdriver');
const firefox=require('selenium-webdriver/firefox');
const root=process.cwd(),tmp=await mkdtemp(path.join(os.tmpdir(),'seaglass-firefox-e2e-'));
const downloadDir=path.join(tmp,'downloads');
await (await import('node:fs/promises')).mkdir(downloadDir);
const url=process.env.SEAGLASS_TEST_URL??'http://127.0.0.1:4187/';
let driver,step='setup';
const report={browser:'Firefox',checks:[],performance:[],memoryObservations:[]};
const record=(name,detail='passed')=>report.checks.push({name,result:detail});
const waitForServer=async()=>{for(let i=0;i<80;i++){try{const response=await fetch(url);if(response.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}throw new Error('Vite test server did not become ready.');};
const click=async(selector)=>driver.findElement(By.css(selector)).click();
const openFileNew=async()=>{
 const compact=await driver.executeScript("return matchMedia('(max-width: 680px)').matches");
 const label=compact?'Application menu':'File';
 const trigger=await driver.wait(until.elementLocated(By.css(`.menubar button[aria-label="${label}"]`)),3000);
 await trigger.click();
 if(compact)await click('[role="menuitem"][aria-label="File"]');
 await click('[role="menuitem"][aria-label="New\u2026"]');
};
const clickTextButton=async(text)=>driver.findElement(By.xpath(`//button[contains(normalize-space(.), '${text}')]`)).click();
const status=()=>driver.executeScript("return (document.querySelector('.save-state')?.innerText||'')+' '+(document.querySelector('.statusbar')?.innerText||'')");
const getPixel=async(x,y)=>driver.executeScript("const c=document.querySelector('[data-testid=artwork-canvas]'),p=c.getContext('2d').getImageData(arguments[0],arguments[1],1,1).data;return Array.from(p)",x,y);
const canvasPng=()=>driver.executeScript("return document.querySelector('[data-testid=artwork-canvas]').toDataURL('image/png').split(',')[1]");
const alphaBounds=async(x,y,w,h)=>driver.executeScript("const c=document.querySelector('[data-testid=artwork-canvas]'),d=c.getContext('2d').getImageData(arguments[0],arguments[1],arguments[2],arguments[3]).data;let n=0,minX=arguments[2],minY=arguments[3],maxX=-1,maxY=-1;for(let yy=0;yy<arguments[3];yy++)for(let xx=0;xx<arguments[2];xx++)if(d[(yy*arguments[2]+xx)*4+3]){n++;minX=Math.min(minX,xx);minY=Math.min(minY,yy);maxX=Math.max(maxX,xx);maxY=Math.max(maxY,yy)}return {n,bounds:n?{x:minX+arguments[0],y:minY+arguments[1],right:maxX+arguments[0],bottom:maxY+arguments[1]}:null}",x,y,w,h);
const firstOpaque=async(x,y,w,h)=>driver.executeScript("const c=document.querySelector('[data-testid=artwork-canvas]'),d=c.getContext('2d').getImageData(arguments[0],arguments[1],arguments[2],arguments[3]).data;for(let yy=0;yy<arguments[3];yy++)for(let xx=0;xx<arguments[2];xx++)if(d[(yy*arguments[2]+xx)*4+3])return{x:xx+arguments[0],y:yy+arguments[1]};return null",x,y,w,h);
const canvasSize=async()=>driver.executeScript("const c=document.querySelector('[data-testid=artwork-canvas]');return [c.width,c.height]");
const canvasPoint=async(x,y)=>driver.executeScript("const c=document.querySelector('[data-testid=artwork-canvas]'),r=c.getBoundingClientRect(),px=arguments[0],py=arguments[1];return {x:r.left+px/c.width*r.width,y:r.top+py/c.height*r.height}",x,y);
const setColor=async(hex)=>driver.executeScript("const e=document.querySelector('[aria-label=\"Choose color\"]');e.value=arguments[0];e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));",hex);
const dragCanvas=async(points,release=true)=>{
 const [first,...rest]=await Promise.all(points.map(([x,y])=>canvasPoint(x,y)));
 const actions=driver.actions({async:true}).move({...first,origin:'viewport'}).press();
 for(const point of rest)actions.move({...point,origin:'viewport'});
 if(release)actions.release();
 await actions.perform();
};
const draw=(x1,y1,x2,y2)=>dragCanvas([[x1,y1],[x2,y2]]);
const waitPixelAlpha=async(x,y,alpha)=>driver.wait(async()=>{const pixel=await getPixel(x,y);return alpha==='positive'?pixel[3]>0:pixel[3]===alpha;},5000);
const downloadFile=async(predicate,timeout=15000,after=0)=>{const end=Date.now()+timeout;while(Date.now()<end){const names=await readdir(downloadDir);const candidates=await Promise.all(names.filter(name=>predicate(name)&&!name.endsWith('.part')).map(async name=>({name,info:await stat(path.join(downloadDir,name))})));const match=candidates.filter(item=>item.info.size>0&&item.info.mtimeMs>=after).sort((a,b)=>b.info.mtimeMs-a.info.mtimeMs)[0];if(match)return path.join(downloadDir,match.name);await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('Expected browser download did not complete.');};
const exposeFileInput=async(selector,file)=>{const input=await driver.findElement(By.css(selector));await driver.executeScript(el=>{el.hidden=false;el.style.display='block';el.style.position='fixed';el.style.left='0';el.style.top='0';el.style.width='2px';el.style.height='2px';},input);await input.sendKeys(file);};
const firefoxProcesses=()=>{try{const result=execFileSync('powershell.exe',['-NoProfile','-Command','Get-Process firefox -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64 | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true}).trim();if(!result)return[];const parsed=JSON.parse(result);return Array.isArray(parsed)?parsed:[parsed];}catch{return[];}};
const baselineFirefoxIds=new Set(firefoxProcesses().map(process=>Number(process.Id)));
const processMemoryMiB=()=>{const bytes=firefoxProcesses().filter(process=>!baselineFirefoxIds.has(Number(process.Id))).reduce((sum,process)=>sum+Number(process.WorkingSet64||0),0);return bytes?Math.round(bytes/104857.6)/10:null;};
const createDocument=async(preset)=>{const start=performance.now();await openFileNew();await driver.wait(until.elementLocated(By.css('#document-preset')),4000);await new Select(await driver.findElement(By.css('#document-preset'))).selectByValue(preset);await click('.new-document-dialog button.primary');await driver.wait(async()=>{const size=await canvasSize();return size[0]===Number(preset.split('x')[0])&&size[1]===Number(preset.split('x')[1]);},10000);return Math.round(performance.now()-start);};

try{
 await waitForServer();
 const options=new firefox.Options().setBinary('C:\\Program Files\\Mozilla Firefox\\firefox.exe').addArguments('-headless');
 options.setPreference('browser.download.folderList',2).setPreference('browser.download.dir',downloadDir).setPreference('browser.download.useDownloadDir',true).setPreference('browser.helperApps.neverAsk.saveToDisk','application/octet-stream,image/png');
 driver=await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
 await driver.manage().setTimeouts({implicit:0,pageLoad:20000,script:15000});
 const firefoxMemoryStart=processMemoryMiB();await driver.get(url);const canvas=await driver.wait(until.elementLocated(By.css('[data-testid=artwork-canvas]')),15000);await driver.wait(async()=>Boolean(await canvas.getAttribute('width')),5000);record('Firefox application startup and real canvas render');
 await click('[aria-label="Pencil (P)"]');const presetBadge=await driver.findElement(By.css('.preset-panel .pill')).getText();if(presetBadge.toLowerCase().includes('modified'))throw new Error('Changing the active tool incorrectly marks the selected brush preset as modified.');await click('[aria-label="Paintbrush (B)"]');record('Changing tools does not mark the selected brush preset as modified');
 report.memoryObservations.push({stage:'Firefox session startup',seleniumFirefoxWorkingSetMiB:firefoxMemoryStart,scope:'New Firefox process IDs created by this test; excludes Firefox instances that were already open.'});

 // Paint, verify real canvas bytes, then exercise undo/redo and erasing.
 step='brush and eraser';
 await click('button[aria-label="Paintbrush (B)"]');await draw(180,160,220,160);await waitPixelAlpha(200,160,'positive');record('Brush stroke creates nontransparent canvas pixels');
 await driver.actions().keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();await waitPixelAlpha(200,160,0);await driver.actions().keyDown(Key.CONTROL).sendKeys('y').keyUp(Key.CONTROL).perform();await waitPixelAlpha(200,160,'positive');record('Undo/redo restores actual stroke pixels');
 await click('button[aria-label="Eraser (E)"]');await draw(180,160,220,160);await waitPixelAlpha(200,160,0);await driver.actions().keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();await waitPixelAlpha(200,160,'positive');record('Eraser removes pixels and undo restores them');

 // New layer, visibility, alpha lock, and clipping all checked through rendered composite pixels.
 step='layer visibility and raster properties';
 await click('button[aria-label="Add layer"]');await click('button[aria-label="Paintbrush (B)"]');await draw(300,260,330,260);await waitPixelAlpha(315,260,'positive');
 const selectedRow=()=>driver.findElement(By.css('.layer-row.selected'));
 await (await selectedRow()).findElement(By.css('button[aria-label="Hide layer"]')).click();await waitPixelAlpha(315,260,0);await (await selectedRow()).findElement(By.css('button[aria-label="Show layer"]')).click();await waitPixelAlpha(315,260,'positive');record('Layer visibility changes the composited pixels');
 await (await selectedRow()).findElement(By.css('button[aria-label="Enable Alpha Lock"]')).click();await draw(360,260,380,260);await waitPixelAlpha(370,260,0);await (await selectedRow()).findElement(By.css('button[aria-label="Disable Alpha Lock"]')).click();record('Alpha Lock blocks paint outside existing alpha');
 await (await selectedRow()).findElement(By.css('button[aria-label="Clip layer to layer below"]')).click();await draw(400,260,420,260);await waitPixelAlpha(410,260,0);await (await selectedRow()).findElement(By.css('button[aria-label="Unclip layer"]')).click();record('Clipping masks child pixels to the lower base');

 // Create and assign a group, verify group visibility through its child pixels.
 step='layer groups';
 await click('button[aria-label="Create layer group"]');await driver.wait(until.alertIsPresent(),4000);const prompt=await driver.switchTo().alert();await prompt.sendKeys('Firefox E2E Group');await prompt.accept();
 const groupSelect=await driver.findElement(By.css('#layer-group-select'));await new Select(groupSelect).selectByVisibleText('Firefox E2E Group');await draw(500,260,525,260);await waitPixelAlpha(512,260,'positive');
 const groupHeader=await driver.findElement(By.xpath("//div[contains(@class,'group-header-row')][.//*[text()='Firefox E2E Group']]"));await groupHeader.findElement(By.css('button[aria-label="Hide group"]')).click();await waitPixelAlpha(512,260,0);await groupHeader.findElement(By.css('button[aria-label="Show group"]')).click();await waitPixelAlpha(512,260,'positive');record('Layer groups preserve membership and control visibility');

 // Rectangular selection move is checked at source and destination pixels.
 step='selection movement';
 await click('button[aria-label="Rectangular selection (M)"]');const a=await canvasPoint(480,230),b=await canvasPoint(540,290),actions=driver.actions({async:true});await actions.move({x:a.x,y:a.y,origin:'viewport'}).press().move({x:b.x,y:b.y,origin:'viewport'}).release().perform();
 const source=await canvasPoint(510,260),destination=await canvasPoint(560,310);await driver.actions({async:true}).move({x:source.x,y:source.y,origin:'viewport'}).press().move({x:destination.x,y:destination.y,origin:'viewport'}).release().perform();await waitPixelAlpha(512,260,0);await waitPixelAlpha(562,310,'positive');record('Rectangular selection movement changes only selected composite pixels');

 // Save group membership, clipping, and Alpha Lock properties in the native project.
 await click('button[aria-label="Add layer"]');await click('button[aria-label="Paintbrush (B)"]');await setColor('#EF3340');await (await selectedRow()).findElement(By.css('button[aria-label="Clip layer to layer below"]')).click();await draw(562,310,565,310);await waitPixelAlpha(563,310,'positive');await draw(700,310,720,310);await waitPixelAlpha(710,310,0);
 await (await selectedRow()).findElement(By.css('button[aria-label="Enable Alpha Lock"]')).click();await draw(750,310,770,310);await waitPixelAlpha(760,310,0);record('Clipped and Alpha-Locked layer workflows retain their pixel constraints');

 // Save a native project, modify, reload it, then verify the saved pixels return.
 await clickTextButton('Save project');const projectPath=await downloadFile(name=>name.endsWith('.seaglass'));const savedProject=await readFile(projectPath);if(savedProject.length<100)throw new Error('Downloaded project archive is unexpectedly small.');const savedManifest=JSON.parse(new TextDecoder().decode(unzipSync(savedProject)['manifest.json']));if(savedManifest.groups.length!==1||!savedManifest.layers.some(layer=>layer.clipped&&layer.alphaLocked&&layer.groupId===savedManifest.groups[0].id))throw new Error('Saved project manifest lost its group, clipping, or Alpha Lock properties.');const savedRed=await getPixel(563,310);if(savedRed[0]<180||savedRed[1]>100)throw new Error('Clipped color layer did not composite over its base.');
 await (await selectedRow()).findElement(By.css('button[aria-label="Disable Alpha Lock"]')).click();await click('button[aria-label="Eraser (E)"]');await draw(552,310,572,310);await waitPixelAlpha(562,310,'positive');if((await getPixel(563,310))[0]>100)throw new Error('Eraser did not reveal the base layer beneath the clipped artwork.');
 await exposeFileInput('input[accept=".seaglass"]',projectPath);await driver.wait(until.alertIsPresent(),5000);await driver.switchTo().alert().accept();await driver.wait(async()=>JSON.stringify(await getPixel(563,310))===JSON.stringify(savedRed),5000,'Project reopen did not restore the saved clipped pixel.');record('Saved project reopens with pixel data and layer/group state intact');
 await clickTextButton('PNG');const pngPath=await downloadFile(name=>name.toLowerCase().endsWith('.png'));const png=await readFile(pngPath);if(png.readUInt32BE(16)!==1024||png.readUInt32BE(20)!==768)throw new Error('PNG export dimensions do not match the document.');record('PNG export downloads at the artwork dimensions');

 // Invalid project/image failures must preserve the visible artwork.
 const invalidProject=path.join(tmp,'broken.seaglass');await (await import('node:fs/promises')).writeFile(invalidProject,'not a zip');const beforeFailure=await getPixel(562,310);await exposeFileInput('input[accept=".seaglass"]',invalidProject);await driver.wait(async()=>String(await status()).includes('Project archive is damaged or incomplete'),5000);if(JSON.stringify(await getPixel(562,310))!==JSON.stringify(beforeFailure))throw new Error('Failed project open changed visible artwork.');record('Invalid project load leaves current artwork unchanged');
 const invalidImage=path.join(tmp,'broken.png');await (await import('node:fs/promises')).writeFile(invalidImage,'not an image');await exposeFileInput('input[accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"]',invalidImage);await driver.wait(async()=>String(await status()).includes('image could not be decoded'),5000);if(JSON.stringify(await getPixel(562,310))!==JSON.stringify(beforeFailure))throw new Error('Failed image import changed visible artwork.');record('Invalid image import leaves current artwork unchanged');

 step='layer limit feedback';
 const layerFixture=path.join(tmp,'layer-limit.seaglass'), imageFixture=path.join(tmp,'layer-limit.png');
 const fixtureImages=await driver.executeScript(()=>{
  const image=document.createElement('canvas');
  image.width=image.height=64;
  const blank=image.toDataURL('image/png').split(',')[1];
  const context=image.getContext('2d');
  context.fillStyle='#124e60';
  context.fillRect(10,10,12,12);
  return {blank,painted:image.toDataURL('image/png').split(',')[1]};
 });
 const fixtureLayers=Array.from({length:99},(_,i)=>({id:`fixture-${i+1}`,name:`Fixture layer ${i+1}`,path:i===98?'painted.png':'blank.png'}));
 const paintedImage=Buffer.from(fixtureImages.painted,'base64');
 await writeFile(layerFixture,zipSync({
  'manifest.json':strToU8(JSON.stringify({version:2,width:64,height:64,layers:fixtureLayers,activeId:'fixture-99',groups:[]})),
  'blank.png':Buffer.from(fixtureImages.blank,'base64'),
  'painted.png':paintedImage,
 }));
 await writeFile(imageFixture,paintedImage);
 await exposeFileInput('input[accept=".seaglass"]',layerFixture);
 const layerCount=async()=>(await driver.findElements(By.css('.layer-row'))).length;
 await driver.wait(async()=>await layerCount()===99&&String(await status()).includes('Project opened'),5000);
 await waitPixelAlpha(15,15,'positive');
 const fixturePixel=await getPixel(15,15);
 if(fixturePixel[3]!==255)throw new Error('Layer limit fixture did not open with its painted pixel.');
 const limitNotice=await driver.findElement(By.css('.statusbar [role="status"]'));
 const hasLimitNotice=async()=>String(await limitNotice.getText()).includes('100-layer project limit');
 const expectLimitNotice=async()=>{
  try{await driver.wait(hasLimitNotice,5000,'The layer limit message was not visible.');}
  catch(error){throw new Error(`${error.message}\nCurrent status: ${await driver.findElement(By.css('.save-state')).getAttribute('title')}`);}
  if(await layerCount()!==100||JSON.stringify(await getPixel(15,15))!==JSON.stringify(fixturePixel))throw new Error('A rejected layer operation changed the document.');
 };
 step='adding at the layer limit';
 await click('button[aria-label="Add layer"]');
 await driver.wait(async()=>await layerCount()===100,5000);
 await click('button[aria-label="Add layer"]');
 await expectLimitNotice();
 if(await driver.findElement(By.css('.save-state')).getText()!=='Unsaved')throw new Error('The layer limit message replaced the unsaved indicator.');
 step='duplicating at the layer limit in a narrow window';
 const wideWindow=await driver.manage().window().getRect();
 await driver.manage().window().setRect({width:800,height:wideWindow.height});
 if(await driver.findElement(By.css('.save-state')).isDisplayed())throw new Error('Firefox did not enter the narrow workspace layout.');
 await click('.layer-row.selected .layer-name');
 await click('button[aria-label="Duplicate selected layer"]');
 await expectLimitNotice();
 if(!(await limitNotice.getText()).includes('Unsaved'))throw new Error('The narrow layer limit message hid the unsaved indicator.');
 step='importing at the layer limit';
 await driver.manage().window().setRect({width:wideWindow.width,height:wideWindow.height});
 await click('.layer-row.selected .layer-name');
 await exposeFileInput('.top-actions input[type="file"]:last-child',imageFixture);
 await expectLimitNotice();
 step='pasting an image at the layer limit';
 await click('.layer-row.selected .layer-name');
 const pastedImageHandled=await driver.executeScript(base64=>{
  const file=new File([Uint8Array.from(atob(base64),character=>character.charCodeAt(0))],'pasted.png',{type:'image/png'});
  const event=new Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:{items:[{kind:'file',type:file.type,getAsFile:()=>file}]}});
  return !document.body.dispatchEvent(event);
 },fixtureImages.painted);
 if(!pastedImageHandled)throw new Error('The simulated system image paste was not handled.');
 await expectLimitNotice();
 step='pasting a copied selection at the layer limit';
 await click('.layer-row:nth-child(2) .layer-name');
 await click('button[aria-label="Rectangular selection (M)"]');
 await draw(8,8,24,24);
 await driver.actions().keyDown(Key.CONTROL).sendKeys('c').keyUp(Key.CONTROL).perform();
 await driver.wait(async()=>!await hasLimitNotice(),5000);
 await driver.actions().keyDown(Key.CONTROL).sendKeys('v').keyUp(Key.CONTROL).perform();
 await expectLimitNotice();
 if(await (await selectedRow()).findElement(By.css('.layer-name')).getText()!=='Fixture layer 99')throw new Error('Rejected selection paste changed the active layer.');
 step='undo, redo, save and reopen at the layer limit';
 await driver.actions().keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();
 await driver.wait(async()=>await layerCount()===99,5000,'Undo did not undo the last successful layer operation.');
 await driver.actions().keyDown(Key.CONTROL).sendKeys('y').keyUp(Key.CONTROL).perform();
 await driver.wait(async()=>await layerCount()===100,5000);
 const layerSaveStart=Date.now();
 await clickTextButton('Save project');
 const limitProject=await downloadFile(name=>name.startsWith('layer-limit')&&name.endsWith('.seaglass'),15000,layerSaveStart);
 await exposeFileInput('input[accept=".seaglass"]',limitProject);
 await driver.wait(async()=>String(await status()).includes('Project opened'),5000);
 if(await layerCount()!==100||JSON.stringify(await getPixel(15,15))!==JSON.stringify(fixturePixel))throw new Error('The 100-layer project did not reopen with its artwork.');
 record('The 100-layer cap preserves artwork and reports blocked adds, duplicates, imports and pastes at wide and narrow widths');

 step='rejecting stale project encoding';
 await createDocument('1024x768');
 await click('button[aria-label="Add layer"]');
 const beforeStaleSave=(await readdir(downloadDir)).filter(name=>name.endsWith('.seaglass')).sort();
 await driver.executeScript(()=>{
  const original=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,...args){
   HTMLCanvasElement.prototype.toBlob=original;
   return original.call(this,blob=>{
    window.__finishSeaGlassPng=()=>{delete window.__finishSeaGlassPng;callback(blob);};
   },...args);
  };
  document.querySelector('.top-actions button.primary').click();
 });
 await driver.wait(()=>driver.executeScript(()=>typeof window.__finishSeaGlassPng==='function'),5000);
 await driver.actions().doubleClick(await (await selectedRow()).findElement(By.css('.layer-name'))).perform();
 const nameInput=await driver.findElement(By.css('input[aria-label="Layer name"]'));
 await driver.executeScript(input=>input.select(),nameInput);
 await nameInput.sendKeys('Edited while encoding');
 await nameInput.sendKeys(Key.ENTER);
 await driver.wait(async()=>await (await selectedRow()).findElement(By.css('.layer-name')).getText()==='Edited while encoding',5000,'The test layer rename did not commit.');
 await click('button[aria-label="Paintbrush (B)"]');
 await draw(270,220,300,220);
 await waitPixelAlpha(285,220,'positive');
 await driver.executeScript(()=>window.__finishSeaGlassPng());
 await driver.wait(async()=>String(await status()).includes('Artwork changed while preparing the save'),5000);
 const afterStaleSave=(await readdir(downloadDir)).filter(name=>name.endsWith('.seaglass')).sort();
 if(JSON.stringify(afterStaleSave)!==JSON.stringify(beforeStaleSave))throw new Error('A stale manual save downloaded an archive.');
 if(await driver.findElement(By.css('.save-state')).getText()!=='Unsaved')throw new Error('A stale manual save cleared the unsaved indicator.');
 record('A delayed PNG callback and subsequent rename and paint reject the save before any download');

 step='preserving the revision while the native save picker is pending';
 await driver.executeScript(()=>{
  const mock={pickers:0,writes:[],finish:null};
  window.__seaGlassSaveMock=mock;
  window.isTauri=true;
  window.__TAURI_INTERNALS__={invoke(command,argument){
   if(command==='plugin:dialog|save'){
    mock.pickers++;
    return new Promise(resolve=>{mock.finish=path=>{mock.finish=null;resolve(path);};});
   }
   if(command==='save_file_atomically'){mock.writes.push(Array.from(argument));return Promise.resolve();}
   return Promise.reject(new Error(`Unexpected desktop command: ${command}`));
  }};
 });
 const waitForPicker=()=>driver.wait(()=>driver.executeScript(()=>!!window.__seaGlassSaveMock.finish),5000);
 const finishPicker=path=>driver.executeScript(value=>window.__seaGlassSaveMock.finish(value),path);
 await clickTextButton('Save project');
 await waitForPicker();
 await clickTextButton('Save project');
 await driver.wait(async()=>String(await status()).includes('A project save is already in progress'),5000);
 await draw(390,320,420,320);
 await waitPixelAlpha(405,320,'positive');
 await finishPicker('Untitled.seaglass');
 await driver.wait(async()=>String(await status()).includes('Earlier revision saved'),5000);
 const desktopSave=await driver.executeScript(()=>({pickers:window.__seaGlassSaveMock.pickers,writes:window.__seaGlassSaveMock.writes}));
 if(desktopSave.pickers!==1||desktopSave.writes.length!==1)throw new Error('Concurrent saves opened multiple pickers or writes.');
 const earlierArchive=unzipSync(new Uint8Array(desktopSave.writes[0])),earlierManifest=JSON.parse(new TextDecoder().decode(earlierArchive['manifest.json']));
 if(earlierManifest.layers[1].name!=='Edited while encoding')throw new Error(`The desktop archive has unexpected layer names: ${earlierManifest.layers.map(layer=>layer.name).join(', ')}`);
 const earlierAlpha=await driver.executeAsyncScript(async (layerPng,done)=>{
  try{
   const bitmap=await createImageBitmap(new Blob([new Uint8Array(layerPng)],{type:'image/png'}));
   const canvas=document.createElement('canvas');
   canvas.width=bitmap.width;canvas.height=bitmap.height;
   const context=canvas.getContext('2d');
   context.drawImage(bitmap,0,0);bitmap.close();
   done([context.getImageData(285,220,1,1).data[3],context.getImageData(405,320,1,1).data[3]]);
  }catch(error){done(error.message);}
 },Array.from(earlierArchive['layers/1.png']));
 if(!Array.isArray(earlierAlpha)||earlierAlpha[0]===0||earlierAlpha[1]!==0)throw new Error('The desktop archive pixels do not match the earlier revision.');
 // SG-03: the earlier save must not retire recovery for the stroke painted while the picker was open.
 const recoveryLayerAlpha=async(layerIndex,x,y)=>{
  const stored=await driver.executeAsyncScript(done=>{
   const request=indexedDB.open('seaglass-studio-recovery',1);
   request.onerror=()=>done(null);
   request.onsuccess=()=>{const db=request.result,get=db.transaction('session').objectStore('session').getAll(IDBKeyRange.bound('doc:','doc:\uffff'));get.onsuccess=()=>{const value=get.result.filter(item=>item&&item.bytes).sort((a,b)=>b.savedAt-a.savedAt)[0];db.close();done(value?{revision:value.revision,bytes:Array.from(value.bytes)}:null);};get.onerror=()=>{db.close();done(null);};};
  });
  if(!stored)return null;
  const layerPng=unzipSync(new Uint8Array(stored.bytes))[`layers/${layerIndex}.png`];
  if(!layerPng)return null;
  return driver.executeAsyncScript(async(png,px,py,done)=>{try{const bitmap=await createImageBitmap(new Blob([new Uint8Array(png)],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();done(context.getImageData(px,py,1,1).data[3]);}catch{done(null);}},Array.from(layerPng),x,y);
 };
 await driver.wait(async()=>(await recoveryLayerAlpha(1,405,320))>0,8000,'Recovery for the stroke painted during the picker was missing after the earlier save.');
 record('An earlier-revision save leaves recovery for newer work in IndexedDB');
 await clickTextButton('Save project');
 await waitForPicker();
 await finishPicker(null);
 await driver.wait(async()=>(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Project save canceled'),5000);
 const totalWrites=await driver.executeScript(()=>window.__seaGlassSaveMock.writes.length);
 if(totalWrites!==1||await driver.findElement(By.css('.save-state')).getText()!=='Unsaved')throw new Error('A canceled save wrote an archive or cleared the latest edits.');
 await driver.executeScript(()=>{
  delete window.isTauri;delete window.__TAURI_INTERNALS__;delete window.__seaGlassSaveMock;
 });
 await clickTextButton('Save project');
 await driver.wait(async()=>String(await status()).includes('Project saved'),5000);
 record('A simulated native picker writes one coherent earlier archive and leaves later edits dirty through a canceled retry');

 step='blocking persistence during a staged transform';
 await draw(480,350,515,350);
 await waitPixelAlpha(500,350,'positive');
 await click('button[aria-label="Rectangular selection (M)"]');
 await draw(465,335,535,365);
 await click('button[title="Rotate 90 degrees clockwise"]');
 await driver.wait(until.elementLocated(By.css('.transform-apply')),5000);
 const stagedDownloads=(await readdir(downloadDir)).filter(name=>name.endsWith('.seaglass')).length;
 await driver.executeScript(()=>{
  window.__seaGlassStagedEncodes=0;
  const original=HTMLCanvasElement.prototype.toBlob;
  window.__restoreSeaGlassPng=()=>{HTMLCanvasElement.prototype.toBlob=original;};
  HTMLCanvasElement.prototype.toBlob=function(...args){window.__seaGlassStagedEncodes++;return original.apply(this,args);};
 });
 await clickTextButton('Save project');
 await driver.wait(async()=>String(await status()).includes('Finish the current edit'),5000);
 await driver.sleep(2200);
 if(await driver.executeScript(()=>window.__seaGlassStagedEncodes)!==0)throw new Error('A staged transform started manual or recovery PNG encoding.');
 if((await readdir(downloadDir)).filter(name=>name.endsWith('.seaglass')).length!==stagedDownloads)throw new Error('A staged transform produced a project download.');
 await click('button[title="Cancel transform (Escape)"]');
 await driver.wait(()=>driver.executeScript(()=>window.__seaGlassStagedEncodes>0),8000,'Recovery did not resume once the transform was canceled.');
 await driver.executeScript(()=>window.__restoreSeaGlassPng());
 await clickTextButton('Save project');
 await driver.wait(async()=>String(await status()).includes('Project saved'),5000);
 record('A staged transform blocks manual and recovery writes until editing resumes');
/^>>>>>>> theirs$/d
 step='selection preview group and clipping';
 const previewFixture=path.join(tmp,'preview-parity.seaglass');
 const fixturePaint=await driver.executeScript(()=>{
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=256;
  const context=canvas.getContext('2d');
  const rectangle=(fill,x,y,width,height)=>{
   context.clearRect(0,0,256,256);
   context.fillStyle=fill;
   context.fillRect(x,y,width,height);
   return canvas.toDataURL('image/png').split(',')[1];
  };
  return [
   rectangle('rgba(30,70,100,.5)',0,0,256,256),
   rectangle('#ea6d37',20,20,120,120),
   rectangle('#11e2a0',60,60,110,40),
   rectangle('#fc21b7',180,100,50,45),
  ];
 });
 const previewGroups=[
  {id:'visible',name:'Translucent group',visible:true,locked:false,opacity:.5},
  {id:'hidden',name:'Hidden group',visible:false,locked:false,opacity:1},
 ];
 const previewLayers=[
  {id:'backdrop',name:'Translucent backdrop'},
  {id:'base',name:'Clipping base',groupId:'visible'},
  {id:'child',name:'Clipped child',groupId:'visible',clipped:true,opacity:.65},
  {id:'hidden-paint',name:'Hidden paint',groupId:'hidden'},
 ].map((layer,index)=>({opacity:1,...layer,path:`layers/${index}.png`}));
 const previewManifest={version:2,width:256,height:256,layers:previewLayers,groups:previewGroups,activeId:'child'};
 const previewEntries=Object.fromEntries(previewLayers.map((layer,index)=>[layer.path,Buffer.from(fixturePaint[index],'base64')]));
 await writeFile(previewFixture,zipSync({'manifest.json':strToU8(JSON.stringify(previewManifest)),...previewEntries}));
 await exposeFileInput('input[accept=".seaglass"]',previewFixture);
 await driver.wait(async()=>String(await status()).includes('Project opened')&&(await canvasSize())[0]===256,5000);
 await click('button[title="Fit canvas"]');
 await click('button[aria-label="Rectangular selection (M)"]');
 const originalPreviewArtwork=await canvasPng();
 const expectOriginalPreviewArtwork=async()=>{
  if(await canvasPng()!==originalPreviewArtwork)throw new Error('The original composite changed after cancellation or Undo.');
 };
 const undoPreviewEdit=async()=>{
  await driver.actions().keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();
  await expectOriginalPreviewArtwork();
  await driver.actions().sendKeys(Key.ESCAPE).perform();
 };
 const moveAndCompare=async(selection,move,checkExport=false)=>{
  await dragCanvas(selection);
  await dragCanvas(move,false);
  // SG-09 presents previews on the next animation frame; let the final offset render first.
  await driver.executeAsyncScript("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done()))");
  const staged=await canvasPng();
  if(staged===originalPreviewArtwork)throw new Error('The staged move did not change the composite.');
  if(checkExport){
   const began=Date.now();
   await driver.executeScript(()=>[...document.querySelectorAll('.top-actions button')].find(button=>button.textContent.trim()==='PNG').click());
   const exported=await readFile(await downloadFile(name=>name.endsWith('.png'),15000,began));
   if(!exported.equals(Buffer.from(originalPreviewArtwork,'base64')))throw new Error('PNG export included staged selection pixels.');
  }
  await driver.actions({async:true}).release().perform();
  if(await canvasPng()!==staged)throw new Error('The staged move did not match the committed composite.');
  await undoPreviewEdit();
 };
 const untouchedBackground=await getPixel(8,8);
 const hiddenArtworkArea=await getPixel(200,120);
 if(untouchedBackground[3]!==128||JSON.stringify(hiddenArtworkArea)!==JSON.stringify(untouchedBackground)){
  throw new Error('The fixture must start with a translucent backdrop and invisible hidden-group artwork.');
 }
 await moveAndCompare([[55,55],[175,105]],[[95,80],[135,100]],true);
 await driver.findElement(By.xpath("//*[contains(@class,'layer-name') and text()='Clipping base']")).click();
 await moveAndCompare([[10,10],[145,145]],[[40,60],[95,80]]);
 record('Clipped child and base move previews match Apply, omit hidden groups, and stay out of PNG exports');

 step='nearest and smooth lasso transform preview';
 await click('button[aria-label="Freehand lasso (Q)"]');
 const pendingLasso=await canvasPoint(35,35);
 await driver.executeScript(()=>{
  const canvas=document.querySelector('[data-testid=artwork-canvas]');
  canvas.addEventListener('pointerdown',event=>{canvas.dataset.testPointer=String(event.pointerId);},{once:true});
 });
 await driver.actions({async:true}).move({x:Math.round(pendingLasso.x),y:Math.round(pendingLasso.y),origin:'viewport'}).press().perform();
 const canceledOutline=await driver.executeAsyncScript(done=>{
  const canvas=document.querySelector('[data-testid=artwork-canvas]');
  const {left,top}=canvas.getBoundingClientRect();
  const pointer={pointerId:Number(canvas.dataset.testPointer),pointerType:'mouse',isPrimary:true,bubbles:true};
  canvas.dispatchEvent(new PointerEvent('pointermove',{...pointer,clientX:left+75,clientY:top+75,buttons:1}));
  canvas.dispatchEvent(new PointerEvent('pointercancel',pointer));
  requestAnimationFrame(()=>requestAnimationFrame(()=>done(document.querySelector('.lasso-preview').getAttribute('d'))));
 });
 await driver.actions({async:true}).release().perform();
 if(canceledOutline!==''||await canvasPng()!==originalPreviewArtwork)throw new Error('A canceled lasso left a queued preview or changed pixels.');
 record('Canceling a lasso before its next frame clears the preview and preserves artwork');
 await dragCanvas([[35,35],[156,44],[124,124],[46,136],[35,35]]);
 const setResampling=async(value)=>new Select(await driver.findElement(By.css('[aria-label="Transform resampling"]'))).selectByValue(value);
 await setResampling('nearest');
 await click('button[title="Rotate 90 degrees clockwise"]');
 await driver.wait(until.elementLocated(By.css('.transform-apply')),5000);
 const nearest=await canvasPng();
 if(nearest===originalPreviewArtwork)throw new Error('The nearest-neighbor preview did not change the composite.');
 await click('button[title="Cancel transform (Escape)"]');
 await expectOriginalPreviewArtwork();
 await click('button[title="Rotate 90 degrees clockwise"]');
 await click('.transform-apply');
 if(await canvasPng()!==nearest)throw new Error('Nearest-neighbor lasso rotation did not match its preview.');
 await undoPreviewEdit();

 await dragCanvas([[35,35],[156,44],[124,124],[46,136],[35,35]]);
 await setResampling('smooth');
 await draw(156,85,181,90);
 await driver.wait(until.elementLocated(By.css('.transform-apply')),5000);
 const smooth=await canvasPng();
 if(smooth===originalPreviewArtwork)throw new Error('The smooth resize preview did not change the composite.');
 await click('.transform-apply');
 if(await canvasPng()!==smooth)throw new Error('Smooth lasso resize did not match its preview.');
 if(JSON.stringify(await getPixel(8,8))!==JSON.stringify(untouchedBackground))throw new Error('The transform changed an unselected background pixel.');
 await undoPreviewEdit();
 await driver.actions().keyDown(Key.CONTROL).sendKeys('y').keyUp(Key.CONTROL).perform();
 if(await canvasPng()!==smooth)throw new Error('Redo did not restore the committed smooth transform.');
 await clickTextButton('Save project');
 await downloadFile(name=>name.startsWith('preview-parity')&&name.endsWith('.seaglass'));
 record('Lasso rotation and fractional resize match raster previews and support cancel, single-step Undo and Redo');

 step='guarding delayed document replacement';
 {
  const acceptAlertIfPresent=async()=>{try{await driver.wait(until.alertIsPresent(),1500);await driver.switchTo().alert().accept();}catch{}};
  const newDocumentConfirmed=async(preset)=>{
   await openFileNew();
   await driver.wait(until.elementLocated(By.css('#document-preset')),4000);
   await new Select(await driver.findElement(By.css('#document-preset'))).selectByValue(preset);
   await click('.new-document-dialog button.primary');
   await acceptAlertIfPresent();
   const [w,h]=preset.split('x').map(Number);
   await driver.wait(async()=>{const size=await canvasSize();return size[0]===w&&size[1]===h;},10000);
  };
  const saveTitle=async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title'));
  // Hold File reads (the project archive) until the test releases them; canvas blobs still flow.
  await driver.executeScript(()=>{
   const original=Blob.prototype.arrayBuffer;
   window.__seaGlassHeldOpen=null;
   window.__restoreArrayBuffer=()=>{Blob.prototype.arrayBuffer=original;};
   Blob.prototype.arrayBuffer=function(){
    if(!(this instanceof File))return original.call(this);
    const blob=this;
    return new Promise(resolve=>{window.__seaGlassHeldOpen=()=>{window.__seaGlassHeldOpen=null;resolve(original.call(blob));};});
   };
  });
  const waitHeld=()=>driver.wait(()=>driver.executeScript(()=>!!window.__seaGlassHeldOpen),5000,'The project read was not held.');
  const releaseHeld=()=>driver.executeScript(()=>window.__seaGlassHeldOpen());

  await newDocumentConfirmed('1920x1080');
  await exposeFileInput('input[accept=".seaglass"]',projectPath);
  await acceptAlertIfPresent();
  await waitHeld();
  await click('button[aria-label="Paintbrush (B)"]');
  await draw(300,300,340,300);
  await waitPixelAlpha(320,300,'positive');
  await releaseHeld();
  await driver.wait(async()=>(await saveTitle()).includes('Artwork changed while the file was opening'),5000,'A delayed open did not report the intervening edit.');
  if(JSON.stringify(await canvasSize())!=='[1920,1080]'||(await getPixel(320,300))[3]===0)throw new Error('A delayed open replaced artwork painted while it was decoding.');
  record('A delayed project open followed by painting keeps the newer artwork');

  await exposeFileInput('input[accept=".seaglass"]',projectPath);
  await acceptAlertIfPresent();
  await waitHeld();
  await newDocumentConfirmed('2048x2048');
  await releaseHeld();
  await driver.sleep(800);
  if(JSON.stringify(await canvasSize())!=='[2048,2048]'||(await saveTitle()).includes('Project opened'))throw new Error('A superseded open replaced the newer document.');
  record('A delayed project open cannot replace a document created after it');

  await driver.executeScript(()=>window.__restoreArrayBuffer());
  await exposeFileInput('input[accept=".seaglass"]',projectPath);
  await acceptAlertIfPresent();
  await driver.wait(async()=>String(await status()).includes('Project opened'),10000);
  if(JSON.stringify(await canvasSize())!=='[1024,768]')throw new Error('An undelayed open did not replace the document.');
  record('An undelayed project open still replaces the document through the guarded path');
 }

 step='finishing interrupted gestures';
 {
  await driver.executeScript(()=>{window.__lastPointerId=null;window.addEventListener('pointerdown',e=>{window.__lastPointerId=e.pointerId;},true);});
  const cancelActivePointer=()=>driver.executeScript(()=>{document.querySelector('[data-testid=artwork-canvas]').dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__lastPointerId,bubbles:true}));});
  const viewport=async(x,y)=>{const q=await canvasPoint(x,y);return {x:Math.round(q.x),y:Math.round(q.y),origin:'viewport'};};

  // A stroke keeps painting the layer captured at pointer-down.
  await click('button[aria-label="Add layer"]');
  await click('button[aria-label="Paintbrush (B)"]');
  if((await getPixel(670,640))[3]!==0)throw new Error('The cross-layer fixture area is not empty.');
  await driver.actions({async:true}).move(await viewport(600,640)).press().move(await viewport(630,640)).perform();
  await driver.executeScript(()=>{[...document.querySelectorAll('.layer-row')].find(row=>!row.classList.contains('selected')).click();});
  await driver.actions({async:true}).move(await viewport(650,640)).move(await viewport(680,640)).release().perform();
  await waitPixelAlpha(670,640,'positive');
  await (await driver.findElement(By.css('.layer-row.selected'))).findElement(By.css('button[aria-label="Hide layer"]')).click();
  const afterHide=await getPixel(670,640);
  await (await driver.findElement(By.css('.layer-row.selected'))).findElement(By.css('button[aria-label="Show layer"]')).click();
  if(afterHide[3]===0)throw new Error('Part of the stroke moved to the layer selected mid-stroke.');
  record('A stroke stays on its pointer-down layer when the active layer changes mid-stroke');

  // An interrupted transform drag reverts that drag and leaves the transform usable.
  await driver.executeScript(()=>{[...document.querySelectorAll('.layer-row')].find(row=>row.querySelector('button[aria-label="Hide layer"]')&&!row.classList.contains('selected'))?.click();});
  await click('button[aria-label="Rectangular selection (M)"]');
  await draw(590,625,690,655);
  await click('button[title="Rotate 90 degrees clockwise"]');
  await driver.wait(until.elementLocated(By.css('.transform-apply')),5000);
  const beforeDrag=await canvasPng();
  await driver.actions({async:true}).move(await viewport(640,640)).press().move(await viewport(700,700)).perform();
  await driver.sleep(150);
  if(await canvasPng()===beforeDrag)throw new Error('The transform drag did not change the preview.');
  await cancelActivePointer();
  await driver.sleep(150);
  if(await canvasPng()!==beforeDrag)throw new Error('An interrupted transform drag kept its partial position.');
  await driver.actions({async:true}).move(await viewport(760,720)).release().perform();
  await driver.sleep(150);
  if(await canvasPng()!==beforeDrag)throw new Error('A transform handle stayed stuck after interruption.');
  if((await driver.findElements(By.css('.transform-apply'))).length!==1)throw new Error('The staged transform was lost after interruption.');
  await click('button[title="Cancel transform (Escape)"]');
  record('An interrupted transform drag reverts and leaves the staged transform usable');

  // An interrupted spray stops depositing paint.
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await click('button[aria-label="Spray Paint (S)"]');
  await driver.actions({async:true}).move(await viewport(300,700)).press().perform();
  await driver.sleep(250);
  await cancelActivePointer();
  const afterCancel=await canvasPng();
  await driver.sleep(500);
  const later=await canvasPng();
  await driver.actions({async:true}).release().perform();
  if(later!==afterCancel)throw new Error('Spray kept painting after the pointer was canceled.');
  record('A canceled spray gesture stops painting immediately');
  await clickTextButton('Save project');
  await driver.wait(async()=>String(await status()).includes('Project saved'),5000);
 }

 step='combining selections';
 {
  const accept=async()=>{try{await driver.wait(until.alertIsPresent(),1500);await driver.switchTo().alert().accept();}catch{}};
  await openFileNew();
  await driver.wait(until.elementLocated(By.css('#document-preset')),4000);
  await new Select(await driver.findElement(By.css('#document-preset'))).selectByValue('1024x768');
  await click('.new-document-dialog button.primary');
  await accept();
  await driver.wait(async()=>JSON.stringify(await canvasSize())==='[1024,768]',10000);
  // Fill the layer so selection deletes are visible.
  await setColor('#1f8fb0');
  await click('button[title="Paint Bucket (G)"]');
  const fillPoint=await canvasPoint(500,400);
  await driver.actions({async:true}).move({x:Math.round(fillPoint.x),y:Math.round(fillPoint.y),origin:'viewport'}).click().perform();
  await accept();
  await waitPixelAlpha(500,400,255);
  const mode=value=>driver.executeScript("const e=document.querySelector('#selection-mode');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(e,arguments[0]);e.dispatchEvent(new Event('change',{bubbles:true}));",value);
  await click('button[aria-label="Rectangular selection (M)"]');
  await mode('replace');
  await draw(100,100,200,200);
  await mode('add');
  await draw(400,100,500,200);
  await driver.actions().sendKeys(Key.DELETE).perform();
  await waitPixelAlpha(150,150,0);
  await waitPixelAlpha(450,150,0);
  if((await getPixel(300,150))[3]!==255)throw new Error('Add mode cleared pixels between the two rectangles.');
  record('Add mode combines disjoint rectangles; Delete clears both and nothing between');
  await mode('replace');
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await draw(100,300,400,600);
  await mode('subtract');
  await draw(200,400,300,500);
  await driver.actions().sendKeys(Key.DELETE).perform();
  await waitPixelAlpha(120,320,0);
  if((await getPixel(250,450))[3]!==255)throw new Error('Subtract mode did not protect the inner hole.');
  record('Subtract mode leaves a protected hole inside the selection');
  await mode('replace');
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await draw(500,300,700,500);
  await mode('intersect');
  const strayClick=await canvasPoint(900,700);
  await driver.actions({async:true}).move({x:Math.round(strayClick.x),y:Math.round(strayClick.y),origin:'viewport'}).click().perform();
  await draw(600,400,800,600);
  await driver.actions().sendKeys(Key.DELETE).perform();
  await waitPixelAlpha(650,450,0);
  if((await getPixel(550,350))[3]!==255||(await getPixel(750,550))[3]!==255)throw new Error('Intersect mode affected pixels outside the overlap, or a stray click discarded the selection.');
  record('Intersect mode keeps only the overlap and ignores a stray click');
  // Move the combined selection in Replace mode and undo it as one step.
  await mode('replace');
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await draw(600,100,700,200);
  await mode('add');
  await draw(800,100,900,200);
  await mode('replace');
  const before=await canvasPng();
  const from=await canvasPoint(650,150),to=await canvasPoint(650,350);
  await driver.actions({async:true}).move({x:Math.round(from.x),y:Math.round(from.y),origin:'viewport'}).press().move({x:Math.round(to.x),y:Math.round(to.y),origin:'viewport',duration:100}).release().perform();
  // Both islands moved down: their original areas are now empty.
  await waitPixelAlpha(650,150,0);
  await waitPixelAlpha(850,150,0);
  if((await getPixel(750,150))[3]!==255||(await getPixel(750,350))[3]!==255)throw new Error('Moving a combined selection changed pixels outside its mask.');
  await driver.actions().keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();
  await driver.wait(async()=>await canvasPng()===before,5000,'Undo did not restore the combined-selection move in one step.');
  record('A combined selection moves as one undoable edit without touching pixels outside its mask');
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await clickTextButton('Save project');
  await driver.wait(async()=>String(await status()).includes('Project saved'),5000);
 }

 step='layer effects';
 {
  const accept=async()=>{try{await driver.wait(until.alertIsPresent(),1500);await driver.switchTo().alert().accept();}catch{}};
  const setControl=(selector,value,proto)=>driver.executeScript("const e=document.querySelector(arguments[0]);const set=Object.getOwnPropertyDescriptor(window[arguments[2]].prototype,'value').set;set.call(e,arguments[1]);e.dispatchEvent(new Event(arguments[2]==='HTMLSelectElement'?'change':'input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));",selector,String(value),proto);
  const isGray=p=>p[0]===p[1]&&p[1]===p[2];
  await openFileNew();
  await driver.wait(until.elementLocated(By.css('#document-preset')),4000);
  await new Select(await driver.findElement(By.css('#document-preset'))).selectByValue('1024x768');
  await click('.new-document-dialog button.primary');
  await accept();
  await driver.wait(async()=>JSON.stringify(await canvasSize())==='[1024,768]',10000);
  await setColor('#d83a2a');
  await click('button[title="Paint Bucket (G)"]');
  const fillAt=await canvasPoint(500,400);
  await driver.actions({async:true}).move({x:Math.round(fillAt.x),y:Math.round(fillAt.y),origin:'viewport'}).click().perform();
  await accept();
  await waitPixelAlpha(500,400,255);
  const original=await getPixel(500,400);
  // Preview: the displayed composite changes; the layer, and so a saved file, does not.
  await setControl('#effect-kind','grayscale','HTMLSelectElement');
  await driver.wait(async()=>isGray(await getPixel(500,400)),5000,'The grayscale preview did not appear.');
  const draftPoint=await canvasPoint(300,300);
  await click('button[aria-label="Paintbrush (B)"]');
  await driver.actions({async:true}).move({x:Math.round(draftPoint.x),y:Math.round(draftPoint.y),origin:'viewport'}).press().move({x:Math.round(draftPoint.x)+40,y:Math.round(draftPoint.y),origin:'viewport'}).release().perform();
  await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Apply or cancel the effect preview first'),5000,'Painting was not blocked during an effect preview.');
  await clickTextButton('Cancel');
  await driver.wait(async()=>JSON.stringify(await getPixel(500,400))===JSON.stringify(original),5000,'Cancel did not restore the original pixels.');
  record('An effect preview changes only the display, blocks painting, and Cancel restores the layer');
  // Apply is one undoable edit.
  await setControl('#effect-kind','grayscale','HTMLSelectElement');
  await driver.wait(async()=>isGray(await getPixel(500,400)),5000);
  await clickTextButton('Apply');
  await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Effect applied'),5000);
  const applied=await getPixel(500,400);
  if(!isGray(applied))throw new Error('Apply did not keep the grayscale result.');
  await driver.actions().keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();
  await driver.wait(async()=>JSON.stringify(await getPixel(500,400))===JSON.stringify(original),5000,'Undo did not restore the original color.');
  await driver.actions().keyDown(Key.CONTROL).sendKeys('y').keyUp(Key.CONTROL).perform();
  await driver.wait(async()=>JSON.stringify(await getPixel(500,400))===JSON.stringify(applied),5000,'Redo did not restore the effect.');
  record('Apply makes one undoable edit with exact undo and redo');
  await driver.actions().keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();
  // Constrained to a selection: outside pixels keep their exact bytes.
  await click('button[aria-label="Rectangular selection (M)"]');
  await draw(100,100,300,300);
  await setControl('#effect-kind','brightness-contrast','HTMLSelectElement');
  await setControl('input[aria-label="Brightness"]',60,'HTMLInputElement');
  await driver.wait(async()=>JSON.stringify(await getPixel(200,200))!==JSON.stringify(original),5000,'The brightness preview did not appear inside the selection.');
  await clickTextButton('Apply');
  await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Effect applied'),5000);
  if(JSON.stringify(await getPixel(500,400))!==JSON.stringify(original))throw new Error('The effect changed pixels outside the selection.');
  if(JSON.stringify(await getPixel(200,200))===JSON.stringify(original))throw new Error('The effect did not change pixels inside the selection.');
  record('An effect applied inside a selection leaves pixels outside it untouched');
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await clickTextButton('Save project');
  await driver.wait(async()=>String(await status()).includes('Project saved'),5000);
 }

 step='layer blend modes';
 {
  const accept=async()=>{try{await driver.wait(until.alertIsPresent(),1500);await driver.switchTo().alert().accept();}catch{}};
  const setBlend=value=>driver.executeScript("const e=document.querySelector('#active-layer-blend');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(e,arguments[0]);e.dispatchEvent(new Event('change',{bubbles:true}));",value);
  const fillAt=async(x,y)=>{const p=await canvasPoint(x,y);await driver.actions({async:true}).move({x:Math.round(p.x),y:Math.round(p.y),origin:'viewport'}).click().perform();await accept();};
  const near=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<=2);
  await openFileNew();
  await driver.wait(until.elementLocated(By.css('#document-preset')),4000);
  await new Select(await driver.findElement(By.css('#document-preset'))).selectByValue('1024x768');
  await click('.new-document-dialog button.primary');
  await accept();
  await driver.wait(async()=>JSON.stringify(await canvasSize())==='[1024,768]',10000);
  await click('button[title="Paint Bucket (G)"]');
  await fillAt(500,400);
  await waitPixelAlpha(500,400,255);
  const bottom=await getPixel(500,400);
  await click('button[aria-label="Add layer"]');
  // The expected blends are computed from the measured bottom and top colors.
  await setColor('#40c0ff');
  await fillAt(500,400);
  await waitPixelAlpha(500,400,255);
  const top=await getPixel(500,400);
  await setBlend('multiply');
  const multiplied=[0,1,2].map(i=>Math.round(bottom[i]*top[i]/255)).concat(255);
  await driver.wait(async()=>near(await getPixel(500,400),multiplied),5000,`Multiply composite was not the channel product ${multiplied}.`);
  await setBlend('screen');
  const screened=[0,1,2].map(i=>Math.round(255-(255-bottom[i])*(255-top[i])/255)).concat(255);
  await driver.wait(async()=>near(await getPixel(500,400),screened),5000,`Screen composite was not ${screened}.`);
  record('Multiply and Screen layers composite with the expected blend math');
  await setBlend('multiply');
  await driver.wait(async()=>near(await getPixel(500,400),multiplied),5000);
  const savedAt=Date.now();
  await clickTextButton('Save project');
  const file=await downloadFile(name=>name.endsWith('.seaglass'),15000,savedAt);
  const manifest=JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(file)))['manifest.json']));
  if(manifest.version!==3||manifest.layers[1].blendMode!=='multiply')throw new Error('A blended project was not saved as version 3 with its mode.');
  await exposeFileInput('input[accept=".seaglass"]',file);
  await accept();
  await driver.wait(async()=>String(await status()).includes('Project opened'),10000);
  await driver.wait(async()=>near(await getPixel(500,400),multiplied),5000,'The reopened project lost its blend mode.');
  record('A blended project saves as format version 3 and reopens with the same composite');
  await setBlend('normal');
  await driver.wait(async()=>near(await getPixel(500,400),top),5000);
  await driver.actions().keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();
  await driver.wait(async()=>near(await getPixel(500,400),multiplied),5000,'Undo did not restore the blend mode.');
  record('Blend mode changes are undoable');
  await clickTextButton('Save project');
  await driver.wait(async()=>String(await status()).includes('Project saved'),5000);
 }

 step='stabilized stroke end';
 {
  const accept=async()=>{try{await driver.wait(until.alertIsPresent(),1500);await driver.switchTo().alert().accept();}catch{}};
  await openFileNew();
  await driver.wait(until.elementLocated(By.css('#document-preset')),4000);
  await new Select(await driver.findElement(By.css('#document-preset'))).selectByValue('1024x768');
  await click('.new-document-dialog button.primary');
  await accept();
  await driver.wait(async()=>JSON.stringify(await canvasSize())==='[1024,768]',10000);
  await click('button[aria-label="Paintbrush (B)"]');
  await driver.executeScript("const e=document.querySelector('input[aria-label=\"Stroke stabilization\"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,'60');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));");
  const from=await canvasPoint(200,384),to=await canvasPoint(800,384);
  await driver.actions({async:true}).move({x:Math.round(from.x),y:Math.round(from.y),origin:'viewport'}).press().move({x:Math.round(to.x),y:Math.round(to.y),origin:'viewport',duration:120}).release().perform();
  await driver.wait(async()=>(await getPixel(795,384))[3]>0,5000,'A heavily stabilized fast stroke did not reach its release point.');
  record('A stabilized fast stroke finishes at the release point');
  await clickTextButton('Save project');
  await driver.wait(async()=>String(await status()).includes('Project saved'),5000);
 }

 step='even ink spacing';
 {
  const accept=async()=>{try{await driver.wait(until.alertIsPresent(),1500);await driver.switchTo().alert().accept();}catch{}};
  await openFileNew();
  await driver.wait(until.elementLocated(By.css('#document-preset')),4000);
  await new Select(await driver.findElement(By.css('#document-preset'))).selectByValue('1024x768');
  await click('.new-document-dialog button.primary');
  await accept();
  await driver.wait(async()=>JSON.stringify(await canvasSize())==='[1024,768]',10000);
  await driver.executeScript("document.querySelector('.preset-card[title^=\"Apply Even Ink\"]').click()");
  await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Even Ink selected'),5000,'The Even Ink preset could not be selected.');
  // Sparse samples (large jumps) must still produce continuous coverage up to the end point.
  const points=[[150,300],[400,300],[650,300],[850,300]];
  let actions=driver.actions({async:true});
  const first=await canvasPoint(...points[0]);
  actions=actions.move({x:Math.round(first.x),y:Math.round(first.y),origin:'viewport'}).press();
  for(const [x,y] of points.slice(1)){const p=await canvasPoint(x,y);actions=actions.move({x:Math.round(p.x),y:Math.round(p.y),origin:'viewport'});}
  await actions.release().perform();
  await waitPixelAlpha(845,300,'positive');
  const gaps=await driver.executeScript("const d=document.querySelector('[data-testid=artwork-canvas]').getContext('2d').getImageData(150,300,700,1).data;let gaps=0;for(let x=0;x<700;x++)if(d[x*4+3]===0)gaps++;return gaps;");
  if(gaps!==0)throw new Error(`Even Ink left ${gaps} uncovered pixels along a sparsely sampled stroke.`);
  record('Even Ink spaces dabs evenly across sparse samples and reaches the end point');
  await clickTextButton('Save project');
  await driver.wait(async()=>String(await status()).includes('Project saved'),5000);
  await driver.executeScript("document.querySelector('.preset-card[title^=\"Apply Smooth Ink\"]').click()");
 }

 step='middle-mouse panning';
 {
  await click('button[aria-label="Paintbrush (B)"]');
  await clickTextButton('Save project');
  await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Project saved'),5000);
  await driver.executeScript("window.__middleDown=[];window.addEventListener('pointerdown',e=>{if(e.button===1)window.__middleDown.push(e.defaultPrevented)});window.addEventListener('mousedown',e=>{if(e.button===1)window.__middleDown.push(e.defaultPrevented)});window.addEventListener('auxclick',e=>{if(e.button===1)window.__middleDown.push(e.defaultPrevented)});");
  const rect=()=>driver.executeScript("const r=document.querySelector('[data-testid=artwork-canvas]').getBoundingClientRect();return {x:r.left,y:r.top}");
  const inked=()=>driver.executeScript("const c=document.querySelector('[data-testid=artwork-canvas]'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n");
  const before=await rect(),inkBefore=await inked(),start=await canvasPoint(512,600);
  await driver.actions({async:true}).move({x:Math.round(start.x),y:Math.round(start.y),origin:'viewport'}).press(Button.MIDDLE).move({x:Math.round(start.x)+90,y:Math.round(start.y)-45,origin:'viewport',duration:150}).release(Button.MIDDLE).perform();
  await driver.wait(async()=>{const now=await rect();return Math.abs(now.x-before.x-90)<=1.5&&Math.abs(now.y-before.y+45)<=1.5;},5000,'Holding the middle button did not pan the canvas with the brush selected.');
  if(await inked()!==inkBefore)throw new Error('A middle-button pan painted on the canvas.');
  const middleDown=await driver.executeScript('return window.__middleDown');
  if(!middleDown.length||middleDown.some(prevented=>prevented!==true))throw new Error('The browser middle-click default (autoscroll) was not suppressed.');
  if(!String(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Project saved'))throw new Error('A middle-button pan marked the document as changed.');
  record('Holding the middle mouse button pans with any tool, without painting or autoscroll');
  // The Hand tool still pans with the left button and the Brush still paints afterwards.
  await click('button[aria-label="Hand tool (H)"]');
  const handBefore=await rect(),handStart=await canvasPoint(512,600);
  await driver.actions({async:true}).move({x:Math.round(handStart.x),y:Math.round(handStart.y),origin:'viewport'}).press().move({x:Math.round(handStart.x)-90,y:Math.round(handStart.y)+45,origin:'viewport',duration:150}).release().perform();
  await driver.wait(async()=>{const now=await rect();return Math.abs(now.x-handBefore.x+90)<=1.5&&Math.abs(now.y-handBefore.y-45)<=1.5;},5000,'The Hand tool no longer pans with the left button.');
  if(await inked()!==inkBefore)throw new Error('The Hand tool painted on the canvas.');
  await click('button[aria-label="Paintbrush (B)"]');
  await draw(300,650,360,650);
  await waitPixelAlpha(330,650,'positive');
  record('The Hand tool still pans and the brush still paints after a middle-button pan');
  await clickTextButton('Save project');
  await driver.wait(async()=>String(await status()).includes('Project saved'),5000);
 }

 step='keyboard shortcuts';
 {
  const activeTool=()=>driver.executeScript("return document.querySelector('.toolrail .tool-button.active')?.getAttribute('aria-label')||''");
  const blur=()=>driver.executeScript('document.activeElement?.blur()');
  const press=async(keys)=>{await driver.actions({async:true}).sendKeys(keys).perform();};
  const dialogMessage=()=>driver.executeScript("return document.querySelector('.shortcuts-feedback')?.textContent||''");
  const row=(action)=>`.shortcut-row[data-action="${action}"]`;
  // Open Settings → Keyboard Shortcuts from the menu bar with the keyboard.
  const settingsButton=await driver.findElement(By.css('.menubar button[aria-label="Settings"]'));
  await settingsButton.click();
  await driver.wait(until.elementLocated(By.css('[role="menu"][aria-label="Settings"] [role="menuitem"]')),3000);
  await press(Key.ARROW_DOWN);
  if(!(await driver.executeScript("return document.activeElement?.textContent||''")).includes('Keyboard Shortcuts'))throw new Error('Arrow keys do not move through the Settings menu.');
  await press(Key.ENTER);
  await driver.wait(until.elementLocated(By.css('.shortcuts-dialog[role=dialog]')),3000);
  if(!(await driver.findElement(By.css(row('tool:brush')+' kbd')).getText()).includes('B'))throw new Error('The dialog does not show the current Paintbrush key.');
  // Keys pressed in the dialog never switch tools.
  await click(row('tool:pencil')+' .shortcut-change');await press(Key.ESCAPE);
  const toolBefore=await activeTool();await press('e');
  if(await activeTool()!==toolBefore)throw new Error('A tool shortcut fired while the shortcuts dialog was open.');
  // Conflicts and reserved combinations are refused.
  await click(row('tool:brush')+' .shortcut-change');
  await press('e');
  await driver.wait(async()=>(await dialogMessage()).includes('Eraser'),3000,'Assigning a key already in use was not reported as a conflict.');
  await driver.actions({async:true}).keyDown(Key.CONTROL).sendKeys('b').keyUp(Key.CONTROL).perform();
  await driver.wait(async()=>(await dialogMessage()).includes('reserved'),3000,'A Ctrl combination was not refused.');
  if(!(await driver.findElement(By.css(row('tool:brush')+' kbd')).getText()).includes('Press a key'))throw new Error('A refused key ended recording.');
  await press('k');
  await driver.wait(async()=>(await driver.findElement(By.css(row('tool:brush')+' kbd')).getText())==='K',3000,'Recording a new key did not reassign Paintbrush.');
  if(await driver.findElement(By.css(row('tool:eraser')+' kbd')).getText()!=='E')throw new Error('A refused conflict changed the Eraser shortcut.');
  await click(row('tool:hand')+' .shortcut-clear');
  if(!(await driver.executeScript("return !!document.activeElement?.closest('.shortcuts-dialog')")))throw new Error('Clearing a shortcut moved keyboard focus out of the dialog.');
  await click(row('swap-colors')+' .shortcut-change');
  await press('v');
  await press(Key.ESCAPE);
  await driver.wait(async()=>(await driver.findElements(By.css('.shortcuts-dialog'))).length===0,3000,'Esc did not close the shortcuts dialog.');
  record('Keyboard Shortcuts shows current keys, records a new key and refuses conflicts and Ctrl combinations');
  await click('.menubar button[aria-label="Edit"]');
  const swap=await driver.findElement(By.css('[role="menuitem"][aria-label="Swap colors"]'));
  if(await swap.findElement(By.css('kbd')).getText()!=='V'||!await swap.getAttribute('aria-describedby'))throw new Error('Edit menu did not expose the changed custom shortcut.');
  await press(Key.ESCAPE);
  // The new key works, the old one no longer does, and tooltips follow.
  await click('button[aria-label="Pencil (P)"]');await blur();
  await press('k');
  await driver.wait(async()=>(await activeTool())==='Paintbrush (K)',3000,'The reassigned Paintbrush key did not select the brush.');
  await click('button[aria-label="Pencil (P)"]');await blur();await press('b');
  if(await activeTool()!=='Pencil (P)')throw new Error('The old Paintbrush key still selects the brush.');
  await press('h');
  if(await activeTool()!=='Pencil (P)')throw new Error('A cleared shortcut still selects its tool.');
  const stored=await driver.executeScript("return JSON.parse(localStorage.getItem('seaglass-keybindings-v1')||'null')");
  if(stored?.version!==1||stored.bindings['tool:brush']!=='K'||stored.bindings['tool:hand']!==null)throw new Error('Shortcut changes were not saved for the next session.');
  record('A reassigned key selects its tool, the old and cleared keys do nothing, and the change is saved');
  // Typing in a field never switches tools; Ctrl+S there saves the project instead of the page.
  const hex=await driver.findElement(By.css('input[aria-label="Hex color"]'));
  await hex.click();await press('ek');
  if(await activeTool()!=='Pencil (P)')throw new Error('Typing in a text field switched tools.');
  await driver.executeScript("const e=document.querySelector('input[aria-label=\"Hex color\"]');e.blur();");
  await click('button[aria-label="Pencil (P)"]');await draw(420,700,470,700);await waitPixelAlpha(445,700,'positive');
  await hex.click();await driver.actions({async:true}).keyDown(Key.CONTROL).sendKeys('s').keyUp(Key.CONTROL).perform();
  await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Project saved'),5000,'Ctrl+S inside a text field did not save the project.');
  await blur();
  record('Typing in text fields never runs tool shortcuts, and Ctrl+S still saves from a field');
  // Restore Defaults brings back the original keys.
  await click('.menubar button[aria-label="Settings"]');
  await driver.wait(until.elementLocated(By.css('[role="menu"][aria-label="Settings"]')),3000);
  await clickTextButton('Keyboard Shortcuts');
  await driver.wait(until.elementLocated(By.css('.shortcuts-dialog')),3000);
  await clickTextButton('Restore Defaults');
  await driver.wait(async()=>(await driver.findElement(By.css(row('tool:brush')+' kbd')).getText())==='B',3000,'Restore Defaults did not restore the Paintbrush key.');
  await clickTextButton('Done');
  await blur();await press('h');
  await driver.wait(async()=>(await activeTool())==='Hand tool (H)',3000,'The restored Hand tool key does not work.');
  await press('b');
  await driver.wait(async()=>(await activeTool())==='Paintbrush (B)',3000,'The restored Paintbrush key does not work.');
  record('Restore Defaults returns every shortcut to its original key');
  // No canvas command runs behind an open dialog: Delete and Ctrl+Z leave selected artwork alone.
  await press('m');await draw(400,680,490,720);
  await driver.wait(async()=>String(await status()).includes('Selection created'),3000);
  await openFileNew();
  await driver.wait(until.elementLocated(By.css('.new-document-dialog')),3000);
  await driver.executeScript("document.querySelector('.new-document-dialog .dialog-actions button').focus()");
  await press(Key.DELETE);await driver.actions({async:true}).keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();await press(Key.BACK_SPACE);
  await click('.new-document-dialog .dialog-actions button');
  if((await getPixel(445,700))[3]===0)throw new Error('A key pressed while a dialog was open erased or undid artwork.');
  if((await driver.findElement(By.css('.save-state')).getText()).includes('Unsaved'))throw new Error('Keys pressed behind a dialog changed the document.');
  await blur();await press(Key.ESCAPE);await press('b');
  record('Delete, Backspace and Ctrl+Z never reach the canvas while a dialog is open');
 }

 step='application menus';
 {
  const before=await canvasPng();
  const focusLabel=()=>driver.executeScript("return document.activeElement?.getAttribute('aria-label')");
  const press=key=>driver.actions().sendKeys(key).perform();
  await click('.menubar button[aria-label="File"]');
  if(await focusLabel()!=='New\u2026')throw new Error('File menu did not focus its first command.');
  await press(Key.ARROW_RIGHT);await press(Key.END);
  if(await focusLabel()!=='Reset colors')throw new Error('Right and End did not reach the last Edit menu command.');
  await press(Key.HOME);
  if(await focusLabel()!=='Undo')throw new Error('Home did not return to Undo.');
  const cut=await driver.findElement(By.css('[role="menuitem"][aria-label="Cut selection"]'));
  if(await cut.getAttribute('aria-disabled')!=='true')throw new Error('Cut was enabled without a selection.');
  await driver.executeScript('arguments[0].focus()',cut);await press(Key.ENTER);
  if(await focusLabel()!=='Cut selection')throw new Error('A disabled command activated.');
  await press(Key.DELETE);await press('e');
  await driver.actions().keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();
  await press(Key.ESCAPE);
  if(await focusLabel()!=='Edit')throw new Error('Escape did not restore focus to the active menu button.');
  await click('.menubar button[aria-label="File"]');await draw(450,430,485,450);
  if(await driver.findElements(By.css('#application-menu-popup')).then(elements=>elements.length))throw new Error('Clicking outside did not dismiss the menu.');
  if(await canvasPng()!==before)throw new Error('A key or outside pointer gesture behind a menu changed pixels.');
  if(await driver.executeScript("return document.querySelector('.toolrail .tool-button.active').getAttribute('aria-label')")!=='Paintbrush (B)')throw new Error('A tool shortcut fired behind the menu.');
  const bounds=await driver.manage().window().getRect();
  await driver.manage().window().setRect({width:500,height:844});
  const compactMenu=await driver.wait(until.elementLocated(By.css('.menubar button[aria-label="Application menu"]')),3000);
  await compactMenu.click();
  await click('[role="menu"][aria-label="Application menu"] [role="menuitem"]:first-child');
  await driver.wait(until.elementLocated(By.css('[role="menu"][aria-label="File"] [role="menuitem"][aria-label="New\u2026"]')),3000);
  await press(Key.ESCAPE);
  if(await focusLabel()!=='Application menu')throw new Error('The compact menu did not restore its focus.');
  await driver.manage().window().setRect({width:bounds.width,height:bounds.height});
  if(bounds.width>680)await driver.wait(until.elementLocated(By.css('.menubar button[aria-label="File"]')),3000);
  record('Desktop and compact menus support keyboard navigation, disabled commands and safe outside dismissal');
 }

 step='editable text';
 {
  const accept=async()=>{try{await driver.wait(until.alertIsPresent(),1500);await driver.switchTo().alert().accept();}catch{}};
  const activeTool=()=>driver.executeScript("return document.querySelector('.toolrail .tool-button.active')?.getAttribute('aria-label')||''");
  const press=async(keys)=>{await driver.actions({async:true}).sendKeys(keys).perform();};
  const ctrl=async(key)=>{await driver.actions({async:true}).keyDown(Key.CONTROL).sendKeys(key).keyUp(Key.CONTROL).perform();};
  const editor=()=>driver.findElements(By.css('.text-editor'));
  const editorValue=()=>driver.executeScript("return document.querySelector('.text-editor')?.value??null");
  const editorFocused=()=>driver.executeScript("return document.activeElement?.classList.contains('text-editor')===true");
  const inkIn=(x,y,w,h)=>alphaBounds(x,y,w,h);
  const at=async(x,y)=>{const p=await canvasPoint(x,y);return {x:Math.round(p.x),y:Math.round(p.y),origin:'viewport'};};
  const clickAt=async(x,y)=>driver.actions({async:true}).move(await at(x,y)).press().release().perform();
  const doubleClickAt=async(x,y)=>driver.actions({async:true}).move(await at(x,y)).doubleClick().perform();
  const dragFrom=async(x1,y1,x2,y2)=>driver.actions({async:true}).move(await at(x1,y1)).press().move({...(await at(x2,y2)),duration:150}).release().perform();
  const badges=async()=>(await driver.findElements(By.css('.layer-row .text-layer-badge'))).length;
  await openFileNew();
  await driver.wait(until.elementLocated(By.css('#document-preset')),4000);
  await new Select(await driver.findElement(By.css('#document-preset'))).selectByValue('1024x768');
  await click('.new-document-dialog button.primary');await accept();
  await driver.wait(async()=>JSON.stringify(await canvasSize())==='[1024,768]',10000);
  await setColor('#123456');
  await driver.executeScript('document.activeElement?.blur()');
  await press('t');
  await driver.wait(async()=>(await activeTool())==='Text (T)',3000,'The T shortcut did not select the Text tool.');
  record('The Text tool is on the toolbar and selected with its T shortcut');

  // Click to create a box, type multiline text; tool keys typed in the box never switch tools.
  const layersBefore=await layerCount();
  await clickAt(200,200);
  await driver.wait(async()=>(await editor()).length===1&&await editorFocused(),3000,'Clicking with the Text tool did not open a focused text box.');
  await press('Hello SeaGlass');await press(Key.ENTER);await press('bel two');
  if(await activeTool()!=='Text (T)')throw new Error('Typing B, E or L in a text box switched tools.');
  await driver.wait(async()=>(await inkIn(190,190,500,140)).n>200,3000,'Typed text was not drawn on the canvas while editing.');
  await press(Key.ESCAPE);
  await driver.wait(async()=>(await editor()).length===0,3000,'Esc did not finish the text box.');
  if(await layerCount()!==layersBefore+1||await badges()!==1)throw new Error('Finishing a text box did not leave one text layer.');
  const layerName=await driver.executeScript("return document.querySelector('.layer-row.selected .layer-name')?.textContent||''");
  if(layerName!=='Hello SeaGlass')throw new Error('The text layer was not named after its first line: '+layerName);
  const textTooltip=await driver.findElement(By.css('.layer-row.selected .text-layer-badge')).getAttribute('title');
  if(textTooltip!=='Hello SeaGlass')throw new Error('The text layer tooltip did not show only the first line.');
  const firstInk=await inkIn(150,150,700,300);
  if(firstInk.n<400||firstInk.bounds.y>215)throw new Error('The finished text was not rendered at the click position.');
  const textPixel=await firstOpaque(150,150,700,300);
  record('Clicking adds a text box; multiline typing renders live and never triggers tool shortcuts');

  // Undo removes the new text layer; redo restores it with its text.
  await ctrl('z');
  await driver.wait(async()=>await layerCount()===layersBefore&&(await inkIn(150,150,700,300)).n===0,4000,'Undo did not remove the new text layer.');
  await ctrl('y');
  await driver.wait(async()=>await layerCount()===layersBefore+1&&(await inkIn(150,150,700,300)).n===firstInk.n,4000,'Redo did not restore the text layer.');
  record('Undo and redo remove and restore a new text layer with its text');

  // Double-click edits the existing text as text, not pixels; undo returns the previous wording.
  await doubleClickAt(textPixel.x+2,textPixel.y+4);
  await driver.wait(async()=>(await editorValue())==='Hello SeaGlass\nbel two',3000,'Double-click did not reopen the existing text for editing.');
  await driver.executeScript("const t=document.querySelector('.text-editor');t.setSelectionRange(0,t.value.length)");
  await press('Edited words wrap inside this box');
  await press(Key.ESCAPE);
  await driver.wait(async()=>(await editor()).length===0,3000);
  const edited=await inkIn(150,150,700,400);
  if(edited.n===firstInk.n)throw new Error('Editing the text did not change the rendered layer.');
  await ctrl('z');
  await driver.wait(async()=>(await inkIn(150,150,700,300)).n===firstInk.n,4000,'Undo did not restore the previous text.');
  await doubleClickAt(textPixel.x+2,textPixel.y+4);
  await driver.wait(async()=>(await editorValue())==='Hello SeaGlass\nbel two',3000,'Undo did not restore the editable source text.');
  await press(Key.ESCAPE);
  await ctrl('y');
  await driver.wait(async()=>(await inkIn(150,150,700,400)).n===edited.n,4000,'Redo did not reapply the text edit.');
  record('Double-click edits existing text, and undo/redo step through text edits');

  // Move by dragging the box, then resize it narrower so the text rewraps.
  const beforeMove=(await inkIn(0,0,1024,768)).bounds;
  await dragFrom(beforeMove.x+20,beforeMove.y+10,beforeMove.x+120,beforeMove.y+110);
  await driver.wait(async()=>{const b=(await inkIn(0,0,1024,768)).bounds;return b&&Math.abs(b.x-beforeMove.x-100)<=2&&Math.abs(b.y-beforeMove.y-100)<=2;},4000,'Dragging the text box did not move the text.');
  const moved=(await inkIn(0,0,1024,768)).bounds;
  // The box is 480 px wide at 48 px and now starts at (300, 300); drag its top-right handle left.
  const boxX=300,boxRight=boxX+480,boxTop=300,tallBefore=moved.bottom-moved.y;
  await dragFrom(boxRight,boxTop,boxRight-260,boxTop);
  await driver.wait(async()=>{const b=(await inkIn(0,0,1024,768)).bounds;return b&&b.right<=boxX+240&&b.bottom-b.y>tallBefore;},4000,'Resizing the text box did not rewrap the text inside the narrower box.');
  await ctrl('z');
  await driver.wait(async()=>{const b=(await inkIn(0,0,1024,768)).bounds;return b&&b.right===moved.right&&b.bottom===moved.bottom;},4000,'Undo did not restore the text box size.');
  record('Text boxes move and resize with the Text tool, rewrap, and undo restores them');

  // Raster tools leave text layers alone and explain why; Rasterize makes it paintable, undo restores text.
  await driver.executeScript('document.activeElement?.blur()');
  await press('b');
  const inkBeforeBrush=(await inkIn(0,0,1024,768)).n;
  await draw(100,650,300,650);
  await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title')).toLowerCase().includes('text layer'),3000,'Painting on a text layer did not explain why it was refused.');
  if(!(await driver.findElement(By.css('.statusbar')).getText()).includes('Rasterize'))throw new Error('The text-layer refusal was not shown in the footer.');
  if((await inkIn(0,0,1024,768)).n!==inkBeforeBrush)throw new Error('A brush stroke changed a text layer.');
  await clickTextButton('Rasterize');
  await driver.wait(async()=>await badges()===0,3000,'Rasterize did not convert the text layer.');
  await draw(100,650,300,650);await waitPixelAlpha(200,650,'positive');
  await ctrl('z');await ctrl('z');
  await driver.wait(async()=>await badges()===1&&(await getPixel(200,650))[3]===0,4000,'Undo did not restore the editable text layer after rasterizing.');
  record('Raster tools refuse text layers with a reason; Rasterize and its undo work');

  // Switching tools while typing keeps the text; layer visibility applies to text layers.
  await press('t');
  await clickAt(120,40);
  await driver.wait(async()=>await editorFocused(),3000);
  await press('Keep me');
  await click('button[aria-label="Paintbrush (B)"]');
  await driver.wait(async()=>(await editor()).length===0&&await badges()===2,3000,'Switching tools while typing lost the text box.');
  if((await inkIn(110,30,400,70)).n===0)throw new Error('Text typed before switching tools was not kept.');
  await click('.layer-row.selected .visibility');
  await driver.wait(async()=>(await inkIn(110,30,400,70)).n===0,3000,'Hiding a text layer did not hide its text.');
  await click('.layer-row.selected .visibility');
  await driver.wait(async()=>(await inkIn(110,30,400,70)).n>0,3000);
  record('Switching tools keeps typed text, and layer visibility applies to text layers');

  // Save, reopen and keep editing; the PNG export includes the text.
  const composite=await canvasPng();
  const saveStart=Date.now();
  await ctrl('s');
  const textProject=await downloadFile(name=>name.startsWith('Untitled')&&name.endsWith('.seaglass'),15000,saveStart);
  const manifest=JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(textProject)))['manifest.json']));
  const textLayers=manifest.layers.filter(layer=>layer.text);
  if(manifest.version!==4||textLayers.length!==2||!textLayers.some(layer=>layer.text.text==='Edited words wrap inside this box'))throw new Error('The saved project did not keep editable text.');
  await openFileNew();
  await driver.wait(until.elementLocated(By.css('#document-preset')),4000);
  await click('.new-document-dialog button.primary');await accept();
  await driver.wait(async()=>(await inkIn(0,0,1024,768)).n===0,5000);
  await exposeFileInput('input[accept=".seaglass"]',textProject);
  await driver.wait(async()=>String(await status()).includes('Project opened'),5000,'The text project did not reopen.');
  if(await canvasPng()!==composite)throw new Error('The reopened text project does not match the saved artwork.');
  if(await badges()!==2)throw new Error('Reopened text layers are no longer editable text.');
  await press('t');
  const reopenedPixel=await firstOpaque(250,250,700,300);
  await doubleClickAt(reopenedPixel.x+2,reopenedPixel.y+4);
  await driver.wait(async()=>(await editorValue())==='Edited words wrap inside this box',3000,'Reopened text could not be edited.');
  await press(Key.ESCAPE);
  const exportStart=Date.now();
  await clickTextButton('PNG');
  const png=await downloadFile(name=>name.startsWith('seaglass-artwork')&&name.endsWith('.png'),15000,exportStart);
  const exported=(await readFile(png)).toString('base64');
  if(exported!==await canvasPng())throw new Error('The PNG export does not match the composited artwork with text.');
  record('Text projects save as format 4, reopen identically and stay editable; PNG export includes the text');

  // 4K: typing cost and memory.
  await openFileNew();
  await driver.wait(until.elementLocated(By.css('#document-preset')),4000);
  await new Select(await driver.findElement(By.css('#document-preset'))).selectByValue('3840x2160');
  await click('.new-document-dialog button.primary');await accept();
  await driver.wait(async()=>JSON.stringify(await canvasSize())==='[3840,2160]',10000);
  await press('t');
  const memoryBefore=processMemoryMiB();
  await clickAt(400,400);
  await driver.wait(async()=>await editorFocused(),3000);
  const sample='SeaGlass text on a 4K canvas ';
  const typingStart=Date.now();
  for(let i=0;i<4;i++)await press(sample);
  const typed=sample.length*4,typingMs=Date.now()-typingStart;
  await driver.wait(async()=>(await editorValue())?.length===typed,5000,'Typing on the 4K canvas dropped characters.');
  await press(Key.ESCAPE);
  const memoryAfter=processMemoryMiB();
  report.performance.push({scenario:'Typing into a text box on a 3840 x 2160 canvas (WebDriver key events)',characters:typed,totalMs:typingMs,msPerCharacter:Math.round(typingMs/typed*10)/10});
  report.memoryObservations.push({stage:'4K text editing',beforeMiB:memoryBefore,afterMiB:memoryAfter,scope:'Firefox processes started by this test'});
  record('Text editing on a 3840 x 2160 canvas keeps every character');
  await ctrl('s');
  await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Project saved'),8000);
  await press('b');
 }

 step='text above a clipping run';
 {
  const accept=async()=>{try{await driver.wait(until.alertIsPresent(),1500);await driver.switchTo().alert().accept();}catch{}};
  await openFileNew();
  await driver.wait(until.elementLocated(By.css('#document-preset')),4000);
  await new Select(await driver.findElement(By.css('#document-preset'))).selectByValue('1024x768');
  await click('.new-document-dialog button.primary');await accept();
  await driver.wait(async()=>JSON.stringify(await canvasSize())==='[1024,768]',10000);
  await click('button[aria-label="Paintbrush (B)"]');
  const hex=async(value)=>{const input=await driver.findElement(By.css('input[aria-label="Hex color"]'));await input.click();await driver.executeScript('arguments[0].select()',input);await input.sendKeys(value,Key.ENTER);await driver.executeScript('document.activeElement?.blur()');};
  await hex('CC0000');await draw(100,500,300,500);await waitPixelAlpha(200,500,'positive');
  await click('button[aria-label="Add layer"]');
  await hex('0000CC');await draw(100,500,300,500);
  await driver.wait(async()=>(await getPixel(200,500))[2]>150,3000).catch(async()=>{throw new Error('blue layer pixel '+JSON.stringify(await getPixel(200,500)))});
  await click('.layer-row.selected .clip-toggle');
  await click('button.layer-name[aria-label="Select layer Layer 1"]');
  await driver.executeScript('document.activeElement?.blur()');
  await driver.actions({async:true}).sendKeys('t').perform();
  const p=await canvasPoint(600,100);
  await driver.actions({async:true}).move({x:Math.round(p.x),y:Math.round(p.y),origin:'viewport'}).press().release().perform();
  await driver.wait(async()=>(await driver.findElements(By.css('.text-editor'))).length===1,3000);
  await driver.actions({async:true}).sendKeys('Clip').perform();
  await driver.actions({async:true}).sendKeys(Key.ESCAPE).perform();
  const pixel=await getPixel(200,500);
  if(pixel[2]<150||pixel[0]>60)throw new Error('Adding text while a clipping base was selected hid its clipped layer: '+JSON.stringify(pixel));
  record('New text is placed above a clipping run, so clipped artwork stays visible');
  await clickTextButton('Save project');
  await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Project saved'),8000);
  await driver.actions({async:true}).sendKeys('b').perform();
 }

 // Representative safe performance run at each requested resolution.
 let memoryAtStart=processMemoryMiB();
 for(const preset of ['1024x768','1920x1080','3840x2160']){
  const [width,height]=preset.split('x').map(Number),createMs=await createDocument(preset),addLayersStart=Date.now();
  for(let i=0;i<3;i++)await click('button[aria-label="Add layer"]');const addLayersMs=Date.now()-addLayersStart;
  await click('button[aria-label="Spray Paint (S)"]');
  const sizeRange=await driver.findElement(By.css('input[aria-label="Brush size or spray radius"]'));
  await driver.executeScript(el=>{el.value='120';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},sizeRange);
  const density=await driver.findElement(By.css('input[aria-label="Particle density"]'));
  await driver.executeScript(el=>{el.value='80';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},density);
  const sprayStart=Date.now();await draw(Math.round(width*.48),Math.round(height*.5),Math.round(width*.51),Math.round(height*.52));const sprayMs=Date.now()-sprayStart;
  const undoStart=Date.now();await driver.actions().keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();await driver.actions().keyDown(Key.CONTROL).sendKeys('y').keyUp(Key.CONTROL).perform();const undoRedoMs=Date.now()-undoStart;
  const visiblePoint=await firstOpaque(Math.round(width*.4),Math.round(height*.4),Math.round(width*.2),Math.round(height*.2));if(!visiblePoint)throw new Error(`Dense spray created no readable pixels at ${preset}.`);
  const selectedBenchLayer=()=>driver.findElement(By.css('.layer-row.selected'));
  const hideStart=Date.now();await (await selectedBenchLayer()).findElement(By.css('button[aria-label="Hide layer"]')).click();await waitPixelAlpha(visiblePoint.x,visiblePoint.y,0);const hideCompositeMs=Date.now()-hideStart;
  const showStart=Date.now();await (await selectedBenchLayer()).findElement(By.css('button[aria-label="Show layer"]')).click();await waitPixelAlpha(visiblePoint.x,visiblePoint.y,'positive');const showCompositeMs=Date.now()-showStart;
  const compositeStart=Date.now();await driver.executeScript("document.querySelector('[data-testid=artwork-canvas]').getContext('2d').getImageData(arguments[0],arguments[1],1,1)",Math.round(width*.5),Math.round(height*.51));const compositeSampleMs=Date.now()-compositeStart;
  const saveStart=Date.now();await clickTextButton('Save project');const largeProjectPath=await downloadFile(name=>name.endsWith('.seaglass'),30000,saveStart);const saveMs=Date.now()-saveStart;
  const reopenStart=Date.now();await exposeFileInput('input[accept=".seaglass"]',largeProjectPath);await driver.wait(async()=>String(await status()).includes('Project opened'),30000);const reopenMs=Date.now()-reopenStart;
  const sizeMiB=Math.round(width*height*4*4/1048576),workingSet=processMemoryMiB();
  report.performance.push({document:preset,rasterLayers:4,createMs,addThreeLayersMs:addLayersMs,denseSprayStrokeMs:sprayMs,undoRedoMs,hideCompositeUpdateMs:hideCompositeMs,showCompositeUpdateMs:showCompositeMs,compositePixelReadMs:compositeSampleMs,projectSaveMs:saveMs,projectReopenMs:reopenMs,estimatedRasterLayerMiB:sizeMiB});
  report.memoryObservations.push({stage:`${preset}, four layers`,seleniumFirefoxWorkingSetMiB:workingSet,deltaFromPriorSampleMiB:workingSet!==null&&memoryAtStart!==null?Math.round((workingSet-memoryAtStart)*10)/10:null,note:'Working set sums Firefox process IDs created by this test; raster estimate counts four RGBA layer surfaces only.'});memoryAtStart=workingSet;
 }
 step='IndexedDB failure handling';await driver.executeScript(()=>{window.__seaglassOriginalIDBOpen=IDBFactory.prototype.open;IDBFactory.prototype.open=function(){throw new DOMException('blocked for recovery test','UnknownError')};});
 await click('button[aria-label="Paintbrush (B)"]');await draw(1000,1000,1020,1010);await waitPixelAlpha(1010,1005,'positive');
 await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getText()).includes('Recovery unavailable'),12000);
 await driver.executeScript(()=>{IDBFactory.prototype.open=window.__seaglassOriginalIDBOpen});record('IndexedDB failure is reported without losing the current stroke');
 step='restoring recovery after a page reload';
 await draw(1040,1000,1060,1010);await waitPixelAlpha(1050,1005,'positive');
 await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Recovery saved locally'),12000,'Recovery was not written once storage became available again.');
 const beforeReload=await getPixel(1050,1005);
 const idsBeforeReload=await driver.executeAsyncScript(done=>{const request=indexedDB.open('seaglass-studio-recovery',1);request.onsuccess=()=>{const db=request.result,keys=db.transaction('session').objectStore('session').getAllKeys(IDBKeyRange.bound('meta:','meta:\uffff'));keys.onsuccess=()=>{db.close();done(keys.result);};};request.onerror=()=>done([]);});
 await driver.navigate().refresh();
 await driver.wait(until.alertIsPresent(),10000,'No recovery prompt appeared after reload.');
 await driver.switchTo().alert().accept();
 await driver.wait(async()=>String(await driver.findElement(By.css('.save-state')).getAttribute('title')).includes('Recovered session'),10000,'The recovered session status did not appear.');
 const afterReload=await getPixel(1050,1005);
 if(JSON.stringify(afterReload)!==JSON.stringify(beforeReload))throw new Error(`Recovered pixel ${afterReload} differs from ${beforeReload}.`);
 if(String(await driver.findElement(By.css('.save-state')).getText())!=='Unsaved')throw new Error('A recovered session was not marked unsaved.');
 record('A reloaded page restores the latest recovery record with identical pixels and unsaved state');
 step='keeping recovery separate across tabs';
 {
  const recoveryIds=()=>driver.executeAsyncScript(done=>{const request=indexedDB.open('seaglass-studio-recovery',1);request.onsuccess=()=>{const db=request.result,keys=db.transaction('session').objectStore('session').getAllKeys(IDBKeyRange.bound('meta:','meta:\uffff'));keys.onsuccess=()=>{db.close();done(keys.result);};};request.onerror=()=>done([]);});
  let firstTabId;
  await driver.wait(async()=>{const ids=await recoveryIds();const own=ids.filter(id=>!idsBeforeReload.includes(id));if(own.length===1&&ids.every(id=>!idsBeforeReload.includes(id))){firstTabId=own[0];return true;}return false;},8000,'The restored session did not write its own record and supersede its origin.');
  const firstTab=await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  await driver.get(url);
  await driver.wait(until.elementLocated(By.css('[data-testid=artwork-canvas]')),15000);
  let offered=false;
  try{await driver.wait(until.alertIsPresent(),2500);offered=true;await driver.switchTo().alert().dismiss();}catch{}
  if(offered)throw new Error("A second tab offered to restore the first tab's live session.");
  await click('button[aria-label="Paintbrush (B)"]');
  await draw(200,200,240,210);
  await waitPixelAlpha(220,205,'positive');
  await driver.wait(async()=>{const ids=await recoveryIds();return ids.length===2&&ids.includes(firstTabId);},8000,"The second tab's recovery record replaced or blocked the first tab's record.");
  await driver.close();
  await driver.switchTo().window(firstTab);
  if((await getPixel(1050,1005))[3]===0)throw new Error('The first tab lost its restored artwork.');
 }
 record("A second tab keeps its own recovery record and never offers the first tab's live session");
 console.log(JSON.stringify({status:'passed',...report},null,2));
}catch(error){let failureDetails={};if(driver)try{failureDetails={stage:step,uiStatus:await status(),pixels:{source:await getPixel(512,260),destination:await getPixel(562,310)},nearbyAlpha:await alphaBounds(480,240,150,120)}}catch{}console.error(JSON.stringify({status:'failed',error:error instanceof Error?error.message:String(error),...failureDetails,...report},null,2));process.exitCode=1;}
finally{if(driver)try{await driver.quit()}catch{}await rm(tmp,{recursive:true,force:true});}
