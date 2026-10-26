const { test, expect, serveExerciseData, waitForGenerator, addWorkouts, workoutRecord, EXERCISES } = require('./helpers');

// The Android app runs this same web code inside Capacitor. These tests stand
// in for the Capacitor bridge: Preferences is backed by localStorage, and
// window.Capacitor says we're on a native platform. The real bridge only runs
// in the APK, so CI's Android build is the check for that part.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Preferences: {
          get: async ({ key }) => ({ value: localStorage.getItem('pref:' + key) }),
          set: async ({ key, value }) => { localStorage.setItem('pref:' + key, value); },
          remove: async ({ key }) => { localStorage.removeItem('pref:' + key); },
        },
      },
    };
  });
});

const prefs = (page, key) => page.evaluate((k) => {
  const v = localStorage.getItem('pref:' + k);
  return v === null ? null : JSON.parse(v);
}, key);

test('the library and settings are stored in Preferences, not IndexedDB', async ({ page }) => {
  await page.goto('index.html');
  await waitForGenerator(page);

  const library = await prefs(page, 'exercises');
  expect(library).toHaveLength(EXERCISES.length);
  expect(await prefs(page, 'setting:exerciseVersion')).toBeTruthy();

  const databases = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(databases).not.toContain('WorkoutAppDB');
  expect(await page.evaluate(() => DB.isNative)).toBe(true);
});

test('the Android app is marked native and hides export and import', async ({ page }) => {
  await page.goto('history.html');
  await expect(page.locator('html')).toHaveClass(/native/);
  await addWorkouts(page, [workoutRecord()]);
  await page.reload();
  await expect(page.locator('#historyContainer article')).toHaveCount(1);
  await expect(page.locator('[data-export]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Import' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Export history' })).toBeHidden();
  // Delete and Repeat still work
  await expect(page.locator('[data-delete]')).toBeVisible();
  await expect(page.locator('[data-repeat]')).toBeVisible();
});

test('workouts are saved, listed, deleted and kept across reloads, all in Preferences', async ({ page }) => {
  await page.goto('history.html');
  await addWorkouts(page, [
    workoutRecord({ timestamp: '2026-10-06T12:30:00.000Z' }),
    workoutRecord({ timestamp: '2026-10-05T12:30:00.000Z' }),
  ]);
  expect(await prefs(page, 'workouts')).toHaveLength(2);

  await page.reload();
  await expect(page.locator('#historyContainer article')).toHaveCount(2);

  page.once('dialog', (d) => d.accept());
  await page.locator('#historyContainer article').first().locator('[data-delete]').click();
  await expect(page.locator('#historyContainer article')).toHaveCount(1);
  expect(await prefs(page, 'workouts')).toHaveLength(1);

  await page.reload();
  await expect(page.locator('#historyContainer article')).toHaveCount(1);
});

test('a workout run on the timer is saved to Preferences', async ({ page }) => {
  await page.clock.install();
  await page.goto('index.html');
  await waitForGenerator(page);
  await page.evaluate(async () => {
    const ex = (await DB.getAllExercises()).slice(0, 2);
    AppLogic.Session.set('current_workout', ex);
    AppLogic.Session.set('num_sets', 1);
    AppLogic.Session.set('ex_duration', 5);
    AppLogic.Session.set('rest_duration', 0);
    AppLogic.Session.set('set_rest', 0);
  });
  await page.goto('timer.html');
  await page.click('#startBtn');
  await page.waitForFunction(() => state === 'running');
  // 7s countdown + 2 x 5s exercises
  await page.clock.runFor(17_000);
  await expect(page.locator('#phaseLabel')).toHaveText('Workout Complete!');
  await expect(page.locator('#exercise-description')).toContainText('saved');

  const saved = await prefs(page, 'workouts');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ num_sets: 1, exercise_duration: 5, rest_duration: 0 });
  expect(saved[0].exercises).toHaveLength(2);
});

test('settings are remembered in Preferences', async ({ page }) => {
  await page.goto('index.html');
  await waitForGenerator(page);
  await page.fill('#num_sets', '4');
  await page.dispatchEvent('#num_sets', 'change');
  await page.check('input[value=mobility]');
  await page.waitForTimeout(200);
  expect(await prefs(page, 'setting:workoutSettings')).toMatchObject({ num_sets: '4', workout_type: 'mobility' });

  await page.reload();
  await waitForGenerator(page);
  await expect(page.locator('#num_sets')).toHaveValue('4');
  await expect(page.locator('input[name=workout_type][value=mobility]')).toBeChecked();
});

test('the app works offline after the first launch', async ({ page, context }) => {
  await page.goto('index.html');
  await waitForGenerator(page);
  await expect(page.locator('#generateBtn')).toBeEnabled();

  // Cut off the exercise data site; the bundled app and stored library remain
  // The app files come from the bundle (here: localhost), so only the data site is cut off
  await serveExerciseData(context, { 'exercises.json': 'fail', 'version.json': 'fail' });
  await page.reload();
  await waitForGenerator(page);
  await page.click('#generateBtn');
  expect(await page.locator('#sortable .exercise-card').count()).toBeGreaterThan(0);
});

test('no service worker is registered inside the Android app', async ({ page }) => {
  await page.goto('index.html');
  await waitForGenerator(page);
  const registrations = await page.evaluate(async () =>
    (await navigator.serviceWorker?.getRegistrations?.()) ?? []);
  expect(registrations).toHaveLength(0);
});
