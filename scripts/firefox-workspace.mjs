import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {Builder,By,Key,Select,until}=require('selenium-webdriver');
const firefox=require('selenium-webdriver/firefox');
const temp=await mkdtemp(path.join(os.tmpdir(),'seaglass-firefox-workspace-'));
const profile=path.join(temp,'profile');
await mkdir(profile);
const url=process.env.SEAGLASS_TEST_URL??'http://127.0.0.1:4188/';
const screenshots=process.env.SEAGLASS_SCREENSHOT_DIR;
const expectedOrder=['effects','color','layers','presets','tool','style'];
let driver;
async function start(){
 const options=new firefox.Options().setBinary('C:\\Program Files\\Mozilla Firefox\\firefox.exe')
  .addArguments('-headless','-no-remote','-profile',profile);
 driver=await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
 await driver.manage().window().setRect({width:1366,height:853});
 await driver.get(url);
 await driver.wait(until.elementLocated(By.css('[data-testid=artwork-canvas]')),15000);
}
const element=selector=>driver.findElement(By.css(selector));
const click=async selector=>(await element(selector)).click();
const press=key=>driver.actions().sendKeys(key).perform();
const order=()=>driver.executeScript(()=>[...document.querySelectorAll('.inspector>[data-panel]')].map(panel=>panel.dataset.panel));
const height=async()=>Number(await (await element('.layers-resize')).getAttribute('aria-valuenow'));
const alpha=(x,y)=>driver.executeScript((x,y)=>document.querySelector('[data-testid=artwork-canvas]').getContext('2d').getImageData(x,y,1,1).data[3],x,y);
const key=async(letter)=>driver.actions().keyDown(Key.CONTROL).sendKeys(letter).keyUp(Key.CONTROL).perform();
const point=(x,y)=>driver.executeScript((x,y)=>{
 const canvas=document.querySelector('[data-testid=artwork-canvas]'),r=canvas.getBoundingClientRect();
 return {x:Math.round(r.left+x/canvas.width*r.width),y:Math.round(r.top+y/canvas.height*r.height),origin:'viewport'};
},x,y);

try{
 await start();
 await click('.workspace-arrange');
 await click('[aria-label="Pin Layer effects"]');
 await click('[aria-label="Move Color panel up"]');
 assert.deepEqual(await order(),expectedOrder);
 await click('.workspace-arrange');
 await click('[data-panel="effects"] .collapse-panel');
 assert.equal(await (await element('[data-panel="effects"] .collapse-panel')).getAttribute('aria-expanded'),'false');
 const grip=await element('.layers-resize');
 await grip.sendKeys(Key.ARROW_DOWN);
 assert.equal(await height(),264);
 await driver.wait(async()=>driver.executeScript(()=>{
  const saved=JSON.parse(localStorage.getItem('seaglass-workspace-v2')||'null');
  return saved?.layersHeight===264&&saved.pinned.includes('effects');
 }),3000);
 await driver.quit();
 driver=null;

 await start();
 assert.deepEqual(await order(),expectedOrder);
 assert.equal(await height(),264);
 assert.equal(await (await element('[data-panel="effects"] .collapse-panel')).getAttribute('aria-expanded'),'false');
 assert.equal(await driver.executeScript(()=>localStorage.getItem('seaglass-workspace-v2')!==null),true);
 await new Select(await element('[aria-label="Jump to panel"]')).selectByValue('effects');
 await click('[aria-label="Go to selected panel"]');
 await driver.wait(async()=>driver.executeScript(()=>document.activeElement?.closest('[data-panel]')?.getAttribute('data-panel')==='effects'),3000);
 assert.equal(await (await element('[data-panel="effects"] .collapse-panel')).getAttribute('aria-expanded'),'true');
 console.log('PASS workspace order, pin, list height, collapse and panel navigation across a full Firefox restart');

 await click('.menubar button[aria-label="Settings"]');
 await click('[role="menuitem"][aria-label="Keyboard Shortcuts\u2026"]');
 await click('[data-action="panel:effects"] .shortcut-change');
 await press('j');
 await driver.wait(async()=>await (await element('[data-action="panel:effects"] kbd')).getText()==='J',3000);
 await click('.shortcuts-dialog .dialog-actions .primary');
 await press('j');
 await driver.wait(async()=>await (await element('[data-panel="effects"] .collapse-panel')).getAttribute('aria-expanded')==='false',3000);
 await press('j');
 await driver.wait(async()=>await (await element('[data-panel="effects"] .collapse-panel')).getAttribute('aria-expanded')==='true',3000);
 console.log('PASS a configurable Workspace shortcut collapses and expands its panel');

 await driver.manage().window().setRect({width:1366,height:1000});
 const frame=await driver.executeAsyncScript(done=>{
  const frame=document.createElement('iframe');
  frame.style='position:fixed;left:0;top:0;width:390px;height:844px;border:0;z-index:1000';
  frame.addEventListener('load',()=>done(frame),{once:true});
  frame.src=location.href;
  document.body.append(frame);
 });
 await driver.switchTo().frame(frame);
 await driver.wait(until.elementLocated(By.css('[data-testid=artwork-canvas]')),15000);
 const narrow=await driver.executeScript(()=>{
  const stage=document.querySelector('.stage').getBoundingClientRect();
  return {viewport:[innerWidth,innerHeight],stageWidth:stage.width,
   workspaceOverflow:document.querySelector('.workspace').scrollWidth-document.querySelector('.workspace').clientWidth};
 });
 assert.deepEqual(narrow.viewport,[390,844]);
 assert.ok(narrow.stageWidth>350,JSON.stringify(narrow));
 assert.ok(narrow.workspaceOverflow<=1,JSON.stringify(narrow));
 await click('.menubar button[aria-label="Application menu"]');
 const popup=await driver.executeScript(()=>{
  const r=document.querySelector('#application-menu-popup').getBoundingClientRect();
  return {left:r.left,right:r.right,width:innerWidth};
 });
 assert.ok(popup.left>=0&&popup.right<=popup.width,JSON.stringify(popup));
 await press(Key.ESCAPE);
 await new Select(await element('[aria-label="Jump to panel"]')).selectByValue('layers');
 await click('[aria-label="Go to selected panel"]');
 const narrowGrip=await element('.layers-resize');
 const beforeResize=await height();
 await narrowGrip.sendKeys(Key.ARROW_UP);
 assert.equal(await height(),beforeResize-24);
 assert.equal(await driver.executeScript(()=>document.querySelector('.layer-list').clientHeight),beforeResize-24);
 await driver.switchTo().defaultContent();
 if(screenshots)await writeFile(path.join(screenshots,'seaglass-workspace-390.png'),await frame.takeScreenshot(true),'base64');
 await driver.executeScript(el=>el.remove(),frame);
 await driver.manage().window().setRect({width:1366,height:853});
 console.log('PASS narrow workspace and compact menus',JSON.stringify(narrow));

 await new Select(await element('[aria-label="Jump to panel"]')).selectByValue('layers');
 await click('[aria-label="Go to selected panel"]');
 for(let i=0;i<7;i++)await click('[aria-label="Add layer"]');
 const list=await element('.layer-list');
 await driver.executeScript(el=>el.scrollTop=0,list);
 const measured=async()=>driver.executeScript(()=>document.querySelector('.layer-list').clientHeight);
 assert.equal(await measured(),264);
 const handle=await element('.layers-resize');
 await driver.executeScript(el=>el.scrollIntoView({block:'center'}),handle);
 const box=await driver.executeScript(el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),origin:'viewport'};},handle);
 await driver.actions().move(box).press().move({...box,y:box.y+32}).release().perform();
 assert.equal(await height(),296);
 assert.equal(await measured(),296);

 const layer=await element('.layer-row.selected .layer-name');
 await driver.actions().doubleClick(layer).perform();
 const name=await element('input[aria-label="Layer name"]');
 await driver.executeScript(input=>input.select(),name);
 await name.sendKeys('Foreground reflected light');
 await name.sendKeys(Key.ENTER);
 const layerName=async()=>(await element('.layer-row.selected .layer-name')).getText();
 await driver.wait(async()=>await layerName()==='Foreground reflected light',5000);
 assert.equal(await (await element('.layer-row.selected .layer-name')).getAttribute('title'),'Foreground reflected light');
 await key('z');
 await driver.wait(async()=>await layerName()!=='Foreground reflected light',3000);
 await key('y');
 await driver.wait(async()=>await layerName()==='Foreground reflected light',3000);
 const toolbarPosition=new Select(await driver.findElement(By.xpath("//label[normalize-space(.)='Toolbar position']/following-sibling::select[1]")));
 await toolbarPosition.selectByValue('right');
 await driver.wait(async()=>driver.executeScript(()=>{
  const rect=selector=>document.querySelector(selector).getBoundingClientRect();
  return rect('.toolrail').left>=rect('.stage').right&&rect('.inspector').right<=rect('.stage').left;
 }),3000);
 await click('button[title="Fit canvas"]');
 await click('.toolrail button[aria-label="Paintbrush (B)"]');
 await driver.actions().move(await point(480,375)).press().move(await point(520,375)).release().perform();
 await driver.wait(async()=>await alpha(505,375)>0,5000);
 await key('z');await driver.wait(async()=>await alpha(505,375)===0,5000);
 await key('y');await driver.wait(async()=>await alpha(505,375)>0,5000);
 await toolbarPosition.selectByValue('top');
 await driver.wait(async()=>driver.executeScript(()=>{
  const rect=selector=>document.querySelector(selector).getBoundingClientRect();
  return rect('.toolrail').bottom<=rect('.stage').top;
 }),3000);
 await toolbarPosition.selectByValue('left');
 await new Select(await element('[aria-label="Jump to panel"]')).selectByValue('layers');
 await click('[aria-label="Go to selected panel"]');
 await click('[aria-label="Create layer group"]');
 await driver.wait(until.alertIsPresent(),3000);
 const group=await driver.switchTo().alert();
 await group.sendKeys('Workspace test group');await group.accept();
 await new Select(await element('#layer-group-select')).selectByVisibleText('Workspace test group');
 await driver.manage().window().setRect({width:700,height:853});
 const row=await driver.executeScript(()=>{
  const r=document.querySelector('.layer-row.selected');
  const rect=selector=>r.querySelector(selector).getBoundingClientRect();
  return {grouped:r.classList.contains('group-child'),
   reorderRight:rect('.layer-reorder').right,alphaLeft:rect('.alpha-toggle').left};
 });
 assert.ok(row.grouped&&row.reorderRight<=row.alphaLeft,JSON.stringify(row));
 await driver.manage().window().setRect({width:1366,height:853});
 if(screenshots)await writeFile(path.join(screenshots,'seaglass-workspace-1366.png'),await driver.takeScreenshot(),'base64');
 console.log('PASS Layers resize, rename, brush coordinates and pixel undo/redo after rearranging the workspace');
}finally{
 await driver?.quit().catch(()=>{});
 await rm(temp,{recursive:true,force:true});
}
