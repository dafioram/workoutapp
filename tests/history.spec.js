const fs = require('fs');
const { test, expect, addWorkouts, workoutRecord } = require('./helpers');

// Times are checked in a fixed time zone (UTC-4 in October)
test.use({ timezoneId: 'America/New_York' });

test('shows every workout in local time, including ones saved with a name', async ({ page }) => {
  await page.goto('history.html');
  await addWorkouts(page, [
    // Saved by older versions: UTC without a "Z", and a username field
    workoutRecord({ username: 'Bruno', timestamp: '2026-10-05T00:00:00' }),
    workoutRecord({ timestamp: '2026-10-06T12:30:00.000Z', notes: 'Ended early', num_sets: 1 }),
  ]);
  await page.reload();

  const cards = page.locator('#historyContainer article');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('2026-10-06 08:30');
  await expect(cards.nth(0)).toContainText('Ended early');
  await expect(cards.nth(0)).toContainText('1 set ·');
  await expect(cards.nth(1)).toContainText('2026-10-04 20:00');
  await expect(page.locator('body')).not.toContainText('Bruno');
});

test('export and import round trip, skipping duplicates', async ({ page }) => {
  await page.goto('history.html');
  await addWorkouts(page, [
    workoutRecord({ timestamp: '2026-10-01T10:00:00.000Z' }),
    workoutRecord({ timestamp: '2026-10-02T10:00:00.000Z' }),
  ]);
  await page.reload();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('text=Export history'),
  ]);
  expect(download.suggestedFilename()).toMatch(/^workout_log_\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).workouts).toHaveLength(2);

  await page.setInputFiles('#importFile', file);
  await expect(page.locator('#backupStatus')).toContainText('Imported 0 workouts (2 already here or invalid)');

  await page.evaluate(() => new Promise(async (resolve) => {
    const db = await dbPromise;
    const tx = db.transaction('workouts', 'readwrite');
    tx.objectStore('workouts').clear();
    tx.oncomplete = resolve;
  }));
  await page.setInputFiles('#importFile', file);
  await expect(page.locator('#backupStatus')).toContainText('Imported 2 workouts');
});

test('Repeat loads the same workout and settings into the timer', async ({ page }) => {
  await page.goto('history.html');
  await addWorkouts(page, [workoutRecord({ num_sets: 3, exercise_duration: 25, rest_duration: 5, set_rest: 45 })]);
  await page.reload();

  await page.click('[data-repeat]');
  await page.waitForURL('**/timer.html');
  await expect(page.locator('#startBtn')).toBeVisible();
  const loaded = await page.evaluate(() => ({
    names: workout.map((e) => e.name),
    hasDescription: !!workout[0].description,
    numSets, exDuration, restDuration, setRest,
  }));
  expect(loaded).toEqual({
    names: ['Push Ups', 'Squats'],
    hasDescription: true,
    numSets: 3, exDuration: 25, restDuration: 5, setRest: 45,
  });
});

test('analysis shows local, oldest-first trend labels', async ({ page }) => {
  await page.goto('analysis.html');
  await addWorkouts(page, [
    workoutRecord({ timestamp: '2026-10-06T12:30:00.000Z' }),
    workoutRecord({ username: 'Bruno', timestamp: '2026-10-05T00:00:00' }),
  ]);
  await page.reload();
  await page.waitForFunction(() => typeof trendChart !== 'undefined' && trendChart);
  expect(await page.evaluate(() => trendChart.data.labels)).toEqual(['2026-10-04 20:00', '2026-10-06 08:30']);
});

test('analysis shows a message when there are no workouts yet', async ({ page }) => {
  await page.goto('analysis.html');
  await expect(page.locator('#emptyMessage')).toBeVisible();
  await expect(page.locator('#charts')).toBeHidden();
});
