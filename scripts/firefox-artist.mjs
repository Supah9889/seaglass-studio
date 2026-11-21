import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Builder,By,Key,until}=require('selenium-webdriver');
const firefox=require('selenium-webdriver/firefox');
const observe=process.argv.includes('--observe');
const driver=await new Builder().forBrowser('firefox').setFirefoxOptions(
 new firefox.Options().setBinary('C:\\Program Files\\Mozilla Firefox\\firefox.exe').addArguments('-headless')
  .setPreference('dom.indexedDB.enabled',false)).build();
const url=process.env.SEAGLASS_TEST_URL??'http://127.0.0.1:4188/';
const select=selector=>driver.findElement(By.css(selector));
const click=async selector=>(await select(selector)).click();
const key=value=>driver.actions().sendKeys(value).perform();
const activeName=()=>driver.executeScript(()=>document.querySelector('.layer-row.selected .layer-name')?.textContent);
const focusOnLayer=()=>driver.executeScript(()=>document.activeElement?.matches('.layer-name')&&document.activeElement.textContent==='Keyboard sketch');
const point=(x,y)=>driver.executeScript((x,y)=>{
 const canvas=document.querySelector('[data-testid="artwork-canvas"]'),r=canvas.getBoundingClientRect();
 return {origin:'viewport',x:Math.round(r.left+r.width*x/canvas.width),y:Math.round(r.top+r.height*y/canvas.height)};
},x,y);
const brushTitle=name=>`button[aria-label="${name}"]`;
const presetButton=(name)=>driver.findElement(By.xpath(`//div[contains(@class,'preset-actions')]//button[normalize-space(.)='${name}']`));
const names=()=>driver.executeScript(()=>[...document.querySelectorAll('.preset-card b')].map(el=>el.textContent));
const visit=async()=>{await driver.get(url);await driver.wait(until.elementLocated(By.css('.layer-row')),15000);};
async function prompt(name,element){
 await element.click();
 await driver.wait(until.alertIsPresent(),4000);
 const dialog=await driver.switchTo().alert();await dialog.sendKeys(name);await dialog.accept();
}

try{
 await driver.manage().window().setRect({width:1440,height:950});
 await visit();
 await click(brushTitle('Add layer'));
 const firstLayer=await select('.layer-row:last-child .layer-name');
 await driver.executeScript(el=>el.focus(),firstLayer);
 await key(Key.ENTER);
 const keyboardSelected=await activeName()==='Layer 1';
 await key(Key.F2);
 const layerInput=await driver.findElements(By.css('.layer-name-input'));
 const keyboardRename=layerInput.length===1;
 if(keyboardRename){
  await driver.executeScript(el=>el.select(),layerInput[0]);
  await layerInput[0].sendKeys('Keyboard sketch');await key(Key.ENTER);
  await driver.wait(async()=>await activeName()==='Keyboard sketch',3000);
  await driver.wait(focusOnLayer,3000,'Rename confirmation did not return focus to the layer.');
  await key(Key.F2);await key(Key.ESCAPE);
  await driver.wait(focusOnLayer,3000,'Rename cancellation did not return focus to the layer.');
 }
 await click(brushTitle('Rectangular selection (M)'));
 const [a,b]=await Promise.all([point(340,300),point(520,445)]);
 await driver.actions().move(a).press().move(b).release().perform();
 const handle=await point(520,300);
 await driver.actions().move(handle).perform();
 const selectionCursor=await driver.executeScript(()=>document.querySelector('[data-testid="artwork-canvas"]').style.cursor);
 await click(brushTitle('Paintbrush (B)'));
 await driver.wait(async()=>await driver.executeScript(()=>document.querySelector('.toolrail .tool-button.active')?.getAttribute('aria-label'))==='Paintbrush (B)',3000);
 await driver.actions().move({...handle,x:handle.x+6}).move(handle).perform();
 const brushCursor=await driver.executeScript(()=>document.querySelector('[data-testid="artwork-canvas"]').style.cursor);
 await key(Key.ESCAPE);
 await click(brushTitle('Eraser (E)'));
 const save=await presetButton('Save current');
 const unsupportedEnabled=await save.isEnabled();
 let presetLost=null;
 if(unsupportedEnabled){
  await prompt('Eraser retention probe',save);
  await driver.wait(async()=> (await names()).includes('Eraser retention probe'),3000);
  await driver.wait(async()=>driver.executeScript(()=>localStorage.getItem('seaglass-brush-preferences-v1')?.includes('Eraser retention probe')),3000);
  await visit();
  presetLost=!(await names()).includes('Eraser retention probe');
 }
 console.log(JSON.stringify({keyboardSelected,keyboardRename,selectionCursor,brushCursor,unsupportedEnabled,presetLost}));
 if(!observe){
  assert.equal(keyboardSelected,true);
  assert.equal(keyboardRename,true);
  assert.match(selectionCursor,/resize/);
  assert.equal(brushCursor,'crosshair');
  assert.equal(unsupportedEnabled,false);
  await click(brushTitle('Paintbrush (B)'));
  await prompt('Private beta ink',await presetButton('Save current'));
  await driver.wait(async()=>driver.executeScript(()=>localStorage.getItem('seaglass-brush-preferences-v1')?.includes('Private beta ink')),3000);
  await visit();
  assert.ok((await names()).includes('Private beta ink'));
  await click(brushTitle('Eraser (E)'));
  const size=await select('input[aria-label="Brush size or spray radius"]');
  await size.sendKeys(Key.ARROW_RIGHT);
  assert.equal(await (await presetButton('Update saved')).isEnabled(),false);
  console.log('PASS custom presets survive reload and invalid updates stay disabled.');
 }
}finally{await driver.quit();}
