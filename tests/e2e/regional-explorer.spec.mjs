import { test, expect } from '@playwright/test';
import { pointResponse, hourlyResponse } from './fixtures.mjs';

const nowMs=Date.parse('2026-11-15T18:10:00Z');
async function mockWeather(page,{nwsStatus=200,stationStatus=200}={}) {
  await page.clock.install({time:new Date(nowMs)});
  await page.route('https://api.weather.gov/**',route=>route.fulfill({status:nwsStatus,json:
    route.request().url().includes('/points/')?pointResponse():hourlyResponse({nowMs})}));
  await page.route('https://api.azmet.arizona.edu/**',route=>{
    const id=route.request().url().match(/15min\/(az\d+)/)?.[1];
    return route.fulfill({status:stationStatus,json:{data:[{
      datetime:'2026-11-15 11:04:01',meta_needs_review:'0',meta_station_id:id,meta_station_name:'Yuma Valley',
      relative_humidity:'40',temp_airC:'25',wind_2min_spd_mean_mps:'2',wind_2min_vector_dir:'286'
    }]}});
  });
}

test('regional explorer loads real-source forecasts by default and filters the shared locations',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await mockWeather(page);
  await page.goto('/weather-viewer.html');
  await expect(page.locator('#weather-values')).toContainText('70.0 °F');
  await expect(page.locator('#forecast-times')).toContainText('National Weather Service');
  await expect(page.locator('#forecast-times')).toContainText('PST');
  await expect(page.locator('#playback-panel')).toBeHidden();
  await expect(page.locator('#quality-panel')).toBeHidden();
  await expect(page.locator('#station-status')).toContainText('No station observation');
  await expect(page.locator('#location-list button')).toHaveCount(12);
  await expect(page.locator('.map-marker')).toHaveCount(12);
  await expect(page.locator('[data-state="AZ"]')).toHaveAttribute('d',/^M/);
  await page.getByRole('button',{name:'Arizona',exact:true}).click();
  await expect(page.locator('#location-list button')).toHaveCount(6);
  await expect(page.locator('.map-marker')).toHaveCount(6);
  await expect(page.locator('#selected-name')).toHaveText('Yuma Valley, AZ');
  await expect(page.locator('#station-values')).toContainText('77.0 °F');
  await expect(page.locator('#weather-values')).toContainText('70.0 °F');
  await expect(page.locator('#station-times')).toContainText('MST');
  await expect(page.locator('#station-heights')).toBeVisible();
  await page.locator('#location-list').getByRole('button',{name:'Willcox Bench, AZ',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Refresh',exact:true}).focus();
  await expect(page.locator('#map-points [data-location="willcox_bench"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#location-list [data-location="willcox_bench"]')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'California',exact:true}).click();
  await expect(page.locator('#selected-name')).toHaveText('Fresno, CA');
  await expect(page.locator('#station-values')).toBeEmpty();
  await expect(page.locator('#station-heights')).toBeHidden();
  expect(errors).toEqual([]);
});

test('weather refreshes after 30 seconds and can also be refreshed manually',async({page})=>{
  await mockWeather(page);
  let requests=0;
  page.on('request',request=>{if(request.url().includes('api.weather.gov/points/')) requests++;});
  await page.goto('/weather-viewer.html');
  await expect(page.locator('#load-status')).toContainText('Updated');
  expect(requests).toBe(1);
  await page.clock.fastForward(30000);
  await expect.poll(()=>requests).toBe(2);
  await expect(page.locator('#load-status')).toContainText('Updated');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect.poll(()=>requests).toBe(3);
});

test('NWS failure keeps valid AZMET observations and never substitutes demo records',async({page})=>{
  await mockWeather(page,{nwsStatus:503});
  await page.goto('/weather-viewer.html?location=yuma_valley');
  await expect(page.locator('#forecast-status')).toContainText('Forecast unavailable');
  await expect(page.locator('#weather-values')).toBeEmpty();
  await expect(page.locator('#station-values')).toContainText('77.0 °F');
  await expect(page.locator('#playback-panel')).toBeHidden();
  await expect(page.locator('#mode-notice')).not.toContainText('synthetic');
});

test('AZMET failure leaves the regional forecast available',async({page})=>{
  await mockWeather(page,{stationStatus:503});
  await page.goto('/weather-viewer.html?location=yuma_valley');
  await expect(page.locator('#station-status')).toContainText('Station observation unavailable');
  await expect(page.locator('#station-values')).toBeEmpty();
  await expect(page.locator('#weather-values')).toContainText('70.0 °F');
});

test('an older location request cannot overwrite a newer selection',async({page})=>{
  await mockWeather(page);
  let delayed;
  await page.route('https://api.weather.gov/points/36.7378,-119.7871',async route=>{
    delayed=route;
  });
  await page.goto('/weather-viewer.html');
  await expect.poll(()=>Boolean(delayed)).toBe(true);
  await page.locator('#location-list').getByRole('button',{name:'Chico, CA',exact:true}).click();
  await expect(page.locator('#load-status')).toContainText('Updated');
  await delayed.fulfill({json:pointResponse()});
  await expect(page.locator('#selected-name')).toHaveText('Chico, CA');
  await expect(page).toHaveURL(/location=chico/);
  await expect(page.locator('#weather-values')).toContainText('70.0 °F');
});

test('explicit demo is offline and selection updates and resets the same playback record',async({page})=>{
  const external=[];
  await page.route('https://**/*',route=>{external.push(route.request().url());return route.abort();});
  await page.goto('/weather-viewer.html?mode=demo');
  await expect(page.locator('#quality-count')).toHaveText('12/12 valid');
  await expect(page.locator('#playback-title')).toHaveText('Fresno, CA sample timeline');
  await page.getByRole('button',{name:'Step +1 minute',exact:true}).click();
  await page.getByRole('button',{name:'Step +1 minute',exact:true}).click();
  await expect(page.locator('#weather-values')).toContainText('69.0 °F');
  await expect(page.locator('#playback-temperature')).toHaveText('69 °F');
  await page.locator('#location-list').getByRole('button',{name:'Modesto, CA',exact:true}).click();
  await expect(page.locator('#playback-title')).toHaveText('Modesto, CA sample timeline');
  await expect(page.locator('#playback-clock')).toHaveText('00:00');
  await expect(page.locator('#weather-values')).toContainText('66.0 °F');
  expect(external).toEqual([]);
});

test('mobile maps keep distinct usable markers and an accessible location list',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/weather-viewer.html?mode=demo');
  for (const filter of ['Both states','Arizona','California']) {
    await page.getByRole('button',{name:filter,exact:true}).click();
    const metrics=await page.evaluate(()=>({
      overflow:document.documentElement.scrollWidth>innerWidth,
      markers:[...document.querySelectorAll('.map-marker')].map(el=>{
        const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width};
      }),
      selectorHeight:document.querySelector('#location-select').getBoundingClientRect().height
    }));
    expect(metrics.overflow).toBe(false);
    expect(metrics.selectorHeight).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#location-select option')).toHaveCount(filter==='Both states'?12:6);
    for(let i=0;i<metrics.markers.length;i++) {
      expect(metrics.markers[i].width).toBeGreaterThanOrEqual(32);
      for(let j=i+1;j<metrics.markers.length;j++) {
        expect(Math.hypot(metrics.markers[i].x-metrics.markers[j].x,metrics.markers[i].y-metrics.markers[j].y)).toBeGreaterThan(35);
      }
    }
  }
  await page.getByRole('button',{name:'Both states',exact:true}).click();
  await page.getByRole('combobox',{name:'Location',exact:true}).selectOption('willcox_bench');
  await expect(page.locator('#selected-name')).toHaveText('Willcox Bench, AZ');
  await expect(page.locator('#selected-weather-link')).toContainText('Willcox Bench, AZ');
  await page.locator('#selected-weather-link').click();
  await expect(page.locator('#selected-name')).toBeInViewport();
  await page.screenshot({path:testInfo.outputPath('regional-explorer-mobile.png'),fullPage:true});
});
