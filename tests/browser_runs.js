'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {playwright,launchOptions}=require('./browser_runtime');
const {project,run}=require('./runs_fixture')();

async function main(){
 const root=path.join(__dirname,'..'),qa=path.join(root,'qa');
 fs.mkdirSync(qa,{recursive:true});
 const tmp=fs.mkdtempSync(path.join(qa,'runs-')),xml=path.join(tmp,'Проверка.xml');
 const browser=await playwright.chromium.launch(launchOptions);
 try{
  const ctx=await browser.newContext({acceptDownloads:true,viewport:{width:1450,height:880}});
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.goto(pathToFileURL(path.join(root,'Pipeline-Studio.html')).href);
  await page.locator('#home-open').waitFor();
  await page.evaluate(project=>Studio.activateDocument(project),project);
  await page.getByRole('navigation',{name:'Листы документа'}).getByRole('button',{name:'Подробности'}).click();
  await page.locator('[data-node="description"]').waitFor();
  await page.locator('#show-runs').click();
  await page.getByRole('button',{name:'Запустить',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.run-marker').length===2);
  await page.getByRole('button',{name:'Пауза',exact:true}).click();
  assert.equal(await page.locator('#sheet-bar [aria-current=page]').innerText(),'Развилка');
  const next=page.getByRole('button',{name:'Следующий шаг',exact:true});
  for(let i=0;i<3&&await next.isEnabled();i++)await next.click();
  assert.equal(await page.locator('#run-stage-title').innerText(),'Прогон завершён');
  assert.equal(await page.locator('[data-node="end"].run-current').count(),1);
  assert.ok(await page.locator('[data-node="left"].run-visited').count());
  assert.ok(await page.locator('[data-node="right"].run-visited').count());

  await page.getByRole('button',{name:'＋ Новый прогон',exact:true}).click();
  await page.locator('#run-title').fill('Только левая ветка');
  await page.locator('#run-start').selectOption('start');
  await page.locator('.run-choices label').filter({hasText:'Левая ветка'}).locator('input').check();
  await page.locator('#run-append').click();
  await page.locator('#run-save').click();
  assert.equal(await page.evaluate(()=>Studio.state.project.runs.length),2);
  await page.locator('#top-actions [data-action="menu"]').click();
  const [download]=await Promise.all([
   page.waitForEvent('download'),page.getByRole('button',{name:'XML с прогонами',exact:true}).click(),
  ]);
  await download.saveAs(xml);
  const restored=await page.evaluate(text=>Studio.parseDocumentText(text).runs,fs.readFileSync(xml,'utf8'));
  assert.deepEqual(restored[0],run);
  assert.equal(restored[1].title,'Только левая ветка');
  assert.deepEqual(restored[1].steps,[[{from:'start',edgeId:'to-left'}]]);

  const exported=await ctx.newPage();
  exported.on('pageerror',err=>errors.push(err.message));
  await exported.goto(pathToFileURL(xml).href);
  const findViewer=()=>exported.frames().find(frame=>frame.url()==='about:srcdoc');
  for(let i=0;i<35&&!findViewer();i++)await exported.waitForTimeout(100);
  const viewer=findViewer();
  assert.ok(viewer,'XML opens a standalone viewer');
  assert.equal(await viewer.locator('#run-panel .run-option').count(),2);
  await viewer.getByRole('button',{name:'Запустить',exact:true}).click();
  await viewer.waitForFunction(()=>document.querySelectorAll('.run-marker').length>0);
  assert.deepEqual(errors,[]);
  console.log('Browser verified sheet tabs, parallel playback, authoring a run and offline playback from exported XML.');
 }finally{
  await browser.close();
  if(fs.existsSync(xml))fs.unlinkSync(xml);
  fs.rmdirSync(tmp);
 }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
