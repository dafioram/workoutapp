const fs = require('fs');
const path = require('path');
const { test, expect, addWorkouts, workoutRecord } = require('./helpers');

test.use({ timezoneId: 'America/New_York' });

// Writes `data` to a temp file and imports it on the History page
async function importData(page, testInfo, data, name = 'import.json') {
  const file = testInfo.outputPath(name);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  await page.setInputFiles('#importFile', file);
}

const stored = (page) => page.evaluate(() => DB.getAllWorkouts());

test('a workout exported from one device imports on another', async ({ page, browser }, testInfo) => {
  await page.goto('history.html');
  await addWorkouts(page, [
    workoutRecord({ timestamp: '2026-10-12T22:30:00.000Z', notes: 'Ended early', num_sets: 1 }),
    workoutRecord({ timestamp: '2026-10-11T22:30:00.000Z' }),
  ]);
  await page.reload();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-export]').first().click(),
  ]);
  // Newest card first; the file name is in local time
  expect(download.suggestedFilename()).toBe('workout_2026-10-12_1830.json');
  const file = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(file).toMatchObject({ app: 'workoutapp', version: 2, kind: 'workout' });
  expect(file.workouts).toHaveLength(1);
  expect(file.workouts[0]).toMatchObject({ timestamp: '2026-10-12T22:30:00.000Z', num_sets: 1, notes: 'Ended early' });
  expect(file.workouts[0]).not.toHaveProperty('id');
  await expect(page.locator('[data-export]').first()).toHaveText('Exported ✓');

  // A second device: a fresh browser context with its own storage
  const other = await browser.newContext({ timezoneId: 'America/New_York' });
  const page2 = await other.newPage();
  await page2.goto('history.html');
  await expect(page2.locator('#historyContainer')).toContainText('No workouts saved yet');
  const filePath = testInfo.outputPath('one.json');
  fs.writeFileSync(filePath, JSON.stringify(file));
  await page2.setInputFiles('#importFile', filePath);
  await expect(page2.locator('#backupStatus')).toHaveText('Imported 1 workout.');
  await page2.reload();
  await expect(page2.locator('#historyContainer article')).toHaveCount(1);
  await expect(page2.locator('#historyContainer')).toContainText('2026-10-12 18:30');
  await expect(page2.locator('#historyContainer')).toContainText('Ended early');

  // Importing the same file again adds nothing
  await page2.setInputFiles('#importFile', filePath);
  await expect(page2.locator('#backupStatus')).toHaveText('Imported 0 workouts (1 already here).');
  await other.close();
});

test('version 1 backups import, without usernames and with correct times', async ({ page }, testInfo) => {
  await page.goto('history.html');
  await importData(page, testInfo, {
    app: 'workoutapp',
    format: 1,
    exported: '2026-10-05T12:00:00.000Z',
    workouts: [
      { ...workoutRecord({ timestamp: '2026-10-05T00:00:00' }), id: 7, username: 'Bruno' },
    ],
  });
  await expect(page.locator('#backupStatus')).toHaveText('Imported 1 workout.');

  const [w] = await stored(page);
  expect(w).not.toHaveProperty('username');
  expect(w.timestamp).toBe('2026-10-05T00:00:00.000Z');
  await page.reload();
  await expect(page.locator('#historyContainer')).toContainText('2026-10-04 20:00');
  await expect(page.locator('body')).not.toContainText('Bruno');
});

test('a bare list of workouts (oldest format) imports', async ({ page }, testInfo) => {
  await page.goto('history.html');
  await importData(page, testInfo, [workoutRecord({ username: 'Bruno' })]);
  await expect(page.locator('#backupStatus')).toHaveText('Imported 1 workout.');
  expect((await stored(page))[0]).not.toHaveProperty('username');
});

test('a file from a newer app version is refused', async ({ page }, testInfo) => {
  await page.goto('history.html');
  await importData(page, testInfo, { app: 'workoutapp', version: 99, kind: 'workout', workouts: [workoutRecord()] });
  await expect(page.locator('#backupStatus')).toContainText('newer version of the app');
  expect(await stored(page)).toHaveLength(0);
});

test('files that are not workout files are refused', async ({ page }, testInfo) => {
  await page.goto('history.html');
  await importData(page, testInfo, 'not json at all', 'bad.json');
  await expect(page.locator('#backupStatus')).toHaveText("Import failed. This isn't a workout file.");
  await importData(page, testInfo, { hello: 'world' }, 'other.json');
  await expect(page.locator('#backupStatus')).toHaveText("Import failed. This isn't a workout file.");
  expect(await stored(page)).toHaveLength(0);
});

test('workouts that cannot be recorded are skipped and counted', async ({ page }, testInfo) => {
  await page.goto('history.html');
  await importData(page, testInfo, {
    app: 'workoutapp',
    version: 2,
    kind: 'backup',
    workouts: [
      workoutRecord({ timestamp: '2026-10-01T10:00:00.000Z', extra_field: 'dropped' }),
      workoutRecord({ timestamp: 'not a date' }),
      workoutRecord({ timestamp: '2026-10-02T10:00:00.000Z', num_sets: 0 }),
      workoutRecord({ timestamp: '2026-10-03T10:00:00.000Z', exercises: [] }),
    ],
  });
  await expect(page.locator('#backupStatus')).toHaveText("Imported 1 workout (3 couldn't be read).");
  const [w] = await stored(page);
  expect(w).not.toHaveProperty('extra_field');
  expect(w.exercises.map((e) => e.name)).toEqual(['Push Ups', 'Squats']);
});

test('usernames saved by older versions are removed from the device', async ({ page }) => {
  // warm_up.html doesn't open the database, so the old one can be set up first
  await page.goto('warm_up.html');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('WorkoutAppDB', 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('exercises', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'key' });
      const wk = db.createObjectStore('workouts', { keyPath: 'id', autoIncrement: true });
      wk.createIndex('username', 'username', { unique: false });
      wk.createIndex('timestamp', 'timestamp', { unique: false });
      wk.add({
        username: 'Bruno', timestamp: '2026-10-05T00:00:00', num_sets: 2, exercise_duration: 30,
        rest_duration: 10, set_rest: 60, exercises: [{ id: 101, name: 'Push Ups', muscle: 'chest', order_index: 0 }],
      });
    };
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  }));

  await page.goto('history.html');
  await expect(page.locator('#historyContainer article')).toHaveCount(1);
  const result = await page.evaluate(async () => {
    const db = await dbPromise;
    const tx = db.transaction('workouts');
    return {
      version: db.version,
      indexes: [...tx.objectStore('workouts').indexNames],
      workouts: await DB.getAllWorkouts(),
    };
  });
  expect(result.version).toBe(4);
  expect(result.indexes).toEqual(['timestamp']);
  expect(result.workouts[0]).not.toHaveProperty('username');
  expect(result.workouts[0].num_sets).toBe(2);
});
