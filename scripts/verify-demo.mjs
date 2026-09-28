import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  await page.goto('http://127.0.0.1:8000');
  const state=await (await page.request.get('http://127.0.0.1:8000/api/state')).json();
  if(!state.store) await page.getByRole('button',{name:'セットアップを完了'}).click();
  else if(!state.periods.some(p=>p.id==='p-demo')) throw new Error('Demo data required. Existing store is preserved.');
  await page.getByRole('button',{name:'シフト案',exact:true}).click();
  await page.getByLabel('対象期間').selectOption('p-demo');
  await page.getByRole('button',{name:'シフト案を作成',exact:true}).click();
  await page.getByRole('button',{name:'3案を作成する'}).click();
  await expect(page.locator('.candidate')).toHaveCount((state.candidates?.filter(c=>c.period==='p-demo').length||0)+3,{timeout:180000});
  await page.screenshot({path:'artifacts/demo-schedule-desktop.png',fullPage:true});
  const result=await (await page.request.get('http://127.0.0.1:8000/api/state')).json();
  const candidates=result.candidates.filter(c=>c.period==='p-demo').slice(-3);
  for(const c of candidates){
    if(c.metrics.hard!==0 || !c.assignments.length)throw new Error('Demo must generate actual shifts without hard violations');
    const daily={};
    for(const a of c.assignments){const key=a.staff+':'+a.date;daily[key]=(daily[key]||0)+(a.end-a.start)/60;}
    for(const [key,hours] of Object.entries(daily)){const staff=result.staff.find(s=>key.startsWith(s.id+':'));if(hours>staff.day_max)throw new Error('Daily limit exceeded');}
    const sum=c.assignments.reduce((total,a)=>total+(a.end-a.start)/60,0);
    if(sum!==c.metrics.total_hours)throw new Error('Hours metric inconsistent');
  }
  await page.reload();
  await page.getByRole('button',{name:'シフト案',exact:true}).click();
  await expect(page.locator('.candidate')).toHaveCount(result.candidates.length);
  await page.getByRole('button',{name:'店舗設定',exact:true}).click();
  await page.getByRole('button',{name:'履歴を表示'}).click();
  await expect(page.getByRole('cell',{name:'3案を自動作成'})).toBeVisible();
  await page.screenshot({path:'artifacts/settings-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'概要',exact:true}).click();
  await page.screenshot({path:'artifacts/demo-dashboard-desktop.png',fullPage:true});
  if(errors.length)throw new Error(errors.join('\n'));
  const summary=candidates.map(c=>({name:c.name,assignments:c.assignments.length,solver:c.solver,...c.metrics}));
  await writeFile('artifacts/demo-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),consoleErrors:errors,candidates:summary},null,2));
  console.log(JSON.stringify(summary.map(({name,assignments,coverage,hard,total_hours})=>({name,assignments,coverage,hard,total_hours}))));
} finally {await browser.close();}
