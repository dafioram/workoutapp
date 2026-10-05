const { test, expect, serveExerciseData, waitForGenerator, addWorkouts, workoutRecord } = require('./helpers');

const PAGES = ['index.html', 'timer.html', 'history.html', 'analysis.html', 'exercises.html', 'warm_up.html'];

test('every page works offline once the app has loaded', async ({ page, context }) => {
  await page.goto('index.html');
  await waitForGenerator(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await addWorkouts(page, [workoutRecord()]);

  await context.setOffline(true);
  await serveExerciseData(context, { 'version.json': 'fail', 'exercises.json': 'fail' });

  for (const p of PAGES) {
    await page.goto(p);
    await page.waitForLoadState('load');
  }

  await page.goto('index.html');
  await waitForGenerator(page);
  await page.click('#generateBtn');
  expect(await page.locator('#sortable .exercise-card').count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => !!window.MobileDragDrop)).toBe(true);

  await page.goto('analysis.html');
  await page.waitForFunction(() => typeof trendChart !== 'undefined' && trendChart);
});

test.describe('phone layout', () => {
  test.use({ viewport: { width: 375, height: 667 }, serviceWorkers: 'block' });

  for (const p of PAGES) {
    test(`${p} fits a phone screen`, async ({ page }) => {
      await page.goto('index.html');
      await addWorkouts(page, [workoutRecord()]);
      await page.goto(p);
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);

      const viewport = await page.getAttribute('meta[name=viewport]', 'content');
      expect(viewport).toContain('width=device-width');
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(375);
    });
  }
});
