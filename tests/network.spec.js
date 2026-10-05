const { test, expect, EXERCISES, serveExerciseData, waitForGenerator } = require('./helpers');

test('a connection that never answers does not block the generator', async ({ page, context }) => {
  await page.goto('index.html');
  await waitForGenerator(page);

  await serveExerciseData(context, { 'version.json': 'hang', 'exercises.json': 'hang' });
  await page.evaluate(() => sessionStorage.removeItem('exerciseUpdateCheckedAt'));
  const start = Date.now();
  await page.reload();
  await waitForGenerator(page);
  expect(Date.now() - start).toBeLessThan(3000);
});

test('a newer library downloads in the background and refreshes the list', async ({ page, context }) => {
  await page.goto('index.html');
  await waitForGenerator(page);

  await serveExerciseData(context, {
    'version.json': { exercisesVersion: 'test-v2' },
    'exercises.json': EXERCISES.map((e) => (e.id === 101 ? { ...e, name: 'Push Ups v2' } : e)),
  });
  await page.evaluate(() => sessionStorage.removeItem('exerciseUpdateCheckedAt'));
  await page.reload();
  await page.waitForFunction(() => ALL_EXERCISES.some((e) => e.name === 'Push Ups v2'));
});

test('moving between pages does not re-check for updates every time', async ({ page, context }) => {
  let versionChecks = 0;
  await serveExerciseData(context, (file) => {
    if (file === 'version.json') versionChecks++;
    return undefined;
  });
  await page.goto('index.html');
  await waitForGenerator(page);
  const afterFirst = versionChecks;

  await page.goto('history.html');
  await page.goto('index.html');
  await waitForGenerator(page);
  expect(versionChecks).toBe(afterFirst);
});

test('first launch with no connection shows an error instead of hanging', async ({ page, context }) => {
  await serveExerciseData(context, { 'version.json': 'hang', 'exercises.json': 'hang' });
  const start = Date.now();
  await page.goto('index.html');
  await expect(page.locator('#toast')).toContainText("Couldn't download exercises", { timeout: 20_000 });
  expect(Date.now() - start).toBeLessThan(15_000);
});

test('history and analysis still load when the first download fails', async ({ page, context }) => {
  await serveExerciseData(context, { 'version.json': 'fail', 'exercises.json': 'fail' });

  await page.goto('history.html');
  await expect(page.locator('#historyContainer')).toContainText('No workouts saved yet');

  await page.goto('analysis.html');
  await expect(page.locator('#emptyMessage')).toBeVisible();
});

test('Reload on the exercises page records the library version', async ({ page, context }) => {
  await page.goto('index.html');
  await waitForGenerator(page);

  let libraryDownloads = 0;
  await serveExerciseData(context, (file) => {
    if (file === 'version.json') return { exercisesVersion: 'reloaded-v' };
    if (file === 'exercises.json') libraryDownloads++;
    return undefined;
  });

  await page.goto('exercises.html');
  await page.click('text=Reload Exercises');
  await expect(page.locator('#toast')).toContainText('Exercises updated.');
  expect(await page.evaluate(() => DB.getSetting('exerciseVersion'))).toBe('reloaded-v');
  expect(libraryDownloads).toBe(1);

  // The next startup sees the same version and doesn't download again
  await page.evaluate(() => sessionStorage.removeItem('exerciseUpdateCheckedAt'));
  await page.goto('index.html');
  await waitForGenerator(page);
  await page.waitForTimeout(500);
  expect(libraryDownloads).toBe(1);
});

test('exercise image paths resolve against the exercise-data site', async ({ page, context }) => {
  await serveExerciseData(context, {
    'exercises.json': EXERCISES.map((e) => (e.id === 101 ? { ...e, image: 'images/push_ups.png' } : e)),
  });
  await page.goto('index.html');
  await waitForGenerator(page);
  const image = await page.evaluate(async () => (await DB.getExerciseMap())[101].image);
  expect(image).toBe('https://dafioram.github.io/exercise-data/images/push_ups.png');
});
