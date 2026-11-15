import { test, expect } from '@playwright/test';

function captureErrors(page) {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    if(message.type()==='error') errors.push(message.text());
  });
  return errors;
}

test('standalone weather playback supports speed, pause, one-minute step, and reset',async({page})=>{
  const errors=captureErrors(page);
  await page.goto('/weather-viewer.html');
  await expect(page.getByRole('heading',{name:'Tucson sample timeline'})).toBeVisible();
  await expect(page.locator('#playback-clock')).toHaveText('00:00');
  await expect(page.locator('#playback-speed')).toHaveValue('1');
  await expect(page.locator('#playback-frame')).toHaveText('1 of 8');

  await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect(page.locator('#playback-clock')).toHaveText('00:01',{timeout:3000});
  await expect(page.locator('#playback-event')).not.toHaveText('No event recorded');
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const pausedAt=await page.locator('#playback-clock').textContent();
  await page.waitForTimeout(300);
  await expect(page.locator('#playback-clock')).toHaveText(pausedAt);

  await page.getByRole('button',{name:'Step +1 minute',exact:true}).click();
  await expect(page.locator('#playback-clock')).toHaveText('00:02');
  await page.getByLabel('Playback speed').selectOption('5');
  await expect(page.locator('#playback-speed-label')).toContainText('5×');
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(page.locator('#playback-clock')).toHaveText('00:00');
  await expect(page.locator('#playback-event')).toHaveText('No event recorded');
  await expect(page.locator('#playback-status')).toHaveText('Paused');

  await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect(page.locator('#playback-clock')).toHaveText('00:01',{timeout:2000});
  expect(errors).toEqual([]);
});

test('paused Step advances one minute and the eight-frame timeline stops cleanly',async({page})=>{
  const errors=captureErrors(page);
  await page.goto('/weather-viewer.html');
  for(let index=0;index<7;index++) {
    await page.getByRole('button',{name:'Step +1 minute',exact:true}).click();
  }
  await expect(page.locator('#playback-clock')).toHaveText('00:07');
  await expect(page.locator('#playback-frame')).toHaveText('8 of 8');
  await expect(page.locator('#playback-status')).toHaveText('Complete');
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Step +1 minute',exact:true})).toBeDisabled();

  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(page.locator('#playback-clock')).toHaveText('00:00');
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  expect(errors).toEqual([]);
});
