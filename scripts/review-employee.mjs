import {createRequire} from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8000/#token='+process.env.SHIFT_REVIEW_TOKEN);
 await page.getByRole('heading',{name:'シフト希望を入力'}).waitFor();
 await page.screenshot({path:'artifacts/employee-v2-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'確定シフト',exact:true}).click();
 await page.screenshot({path:'artifacts/employee-v2-confirmed.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'希望を申請',exact:true}).click();
 await page.screenshot({path:'artifacts/employee-v2-mobile.png',fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile overflow');
 const response=await page.request.get('http://127.0.0.1:8000/api/state');
 if(response.status()!==401)throw new Error('Manager data leaked to employee');
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Employee desktop/mobile views and anonymous manager API denial verified. No user data changed.');
}finally{await browser.close()}
