const { test, expect } = require('./helpers');

// The timer is driven by Playwright's fake clock, so minutes pass instantly.
test.use({ serviceWorkers: 'block' });

// 4 exercises x 20s, 10s rests, 2 sets, 30s between sets:
// 7 countdown + 2 x (80 + 30) + 30 = 257s = 4:17
const SETUP = { num_sets: 2, ex_duration: 20, rest_duration: 10, set_rest: 30 };

test.beforeEach(async ({ page, context }) => {
  // Record screen wake lock calls (headless Chromium has no real screen)
  await context.addInitScript(() => {
    window.__wake = [];
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          window.__wake.push('request');
          return { release: async () => { window.__wake.push('release'); }, addEventListener() {} };
        },
      },
    });
  });
  await page.clock.install();
});

async function openTimer(page, setup = SETUP, count = 4) {
  await page.goto('index.html');
  await page.evaluate(async ({ setup, count }) => {
    await window.AppReady;
    const exercises = (await DB.getAllExercises()).slice(0, count);
    AppLogic.Session.set('current_workout', exercises);
    for (const [key, value] of Object.entries(setup)) AppLogic.Session.set(key, value);
  }, { setup, count });
  await page.goto('timer.html');
  await expect(page.locator('#startBtn')).toBeVisible();
}

async function start(page) {
  await page.click('#startBtn');
  await page.waitForFunction(() => state === 'running');
}

const savedWorkouts = (page) => page.evaluate(() => DB.getAllWorkouts());

test('shows the total, counts down and starts the first exercise', async ({ page }) => {
  await openTimer(page);
  await expect(page.locator('#time-left')).toHaveText('Total Time: 4:17');
  await expect(page.locator('#skipBtn')).toHaveCount(0);

  await start(page);
  expect(await page.evaluate(() => window.__wake)).toContain('request');
  await page.clock.runFor(7100);
  const first = await page.evaluate(() => workout[0].name);
  await expect(page.locator('#exercise')).toHaveText(first);
  await expect(page.locator('#time-left')).toHaveText('Time Left: 4:10');
});

test('pause freezes the clock and resume continues from the same second', async ({ page }) => {
  await openTimer(page);
  await start(page);
  await page.clock.runFor(7000 + 5000);

  await page.click('#pauseBtn');
  expect(await page.evaluate(() => window.__wake)).toContain('release');
  await expect(page.locator('#backBtn')).toBeVisible();
  await expect(page.locator('#endBtn')).toBeVisible();
  await expect(page.locator('#resumeBtn')).toBeVisible();
  const frozen = await page.textContent('#progressBar');
  expect(frozen).toBe('EXERCISE 0:15');

  await page.clock.runFor(30_000);
  await expect(page.locator('#progressBar')).toHaveText(frozen);

  await page.click('#resumeBtn');
  await page.clock.runFor(1000);
  await expect(page.locator('#progressBar')).toHaveText('EXERCISE 0:14');
});

test('catches up to the right phase after the phone sleeps', async ({ page }) => {
  await openTimer(page);
  await start(page);
  await page.clock.runFor(7000 + 6000); // 6s into exercise 1 (14s left)

  // Jump 60s without any timers firing, as if the phone was asleep
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(now + 60_000);
  await page.clock.runFor(300);

  // 14 ex1 + 10 rest + 20 ex2 + 10 rest = 54s, so 6s into exercise 3
  const phase = await page.evaluate(() => phases[phaseIdx]);
  expect(phase).toMatchObject({ type: 'exercise', index: 2, set: 1 });
  // 14 + 10 + 20 + 30 + 110 = 184s
  await expect(page.locator('#time-left')).toHaveText('Time Left: 3:04');
});

test('End & Save before a full set saves nothing', async ({ page }) => {
  await openTimer(page);
  await start(page);
  await page.clock.runFor(7000 + 50_000); // in set 1
  await page.click('#pauseBtn');

  const dialog = page.waitForEvent('dialog');
  const click = page.click('#endBtn');
  const d = await dialog;
  expect(d.message()).toContain('No full set completed yet');
  await d.dismiss();
  await click;

  expect(await page.evaluate(() => state)).toBe('paused');
  expect(await savedWorkouts(page)).toHaveLength(0);
});

test('End & Save during set 2 saves only the full set', async ({ page }) => {
  await openTimer(page);
  await start(page);
  await page.clock.runFor(7000 + 110_000 + 30_000 + 5000); // 5s into set 2
  expect(await page.evaluate(() => phases[phaseIdx].set)).toBe(2);
  await page.click('#pauseBtn');

  page.once('dialog', (d) => d.accept());
  await page.click('#endBtn');
  await expect(page.locator('#exercise-description')).toContainText('saved');
  await expect(page.locator('#setExerciseInfo')).toHaveText('Completed 1 of 2 sets');

  const [saved] = await savedWorkouts(page);
  expect(saved.num_sets).toBe(1);
  expect(saved.exercises).toHaveLength(4);
  expect(saved.notes).toBe('Ended early');
});

test('a full workout completes and saves', async ({ page }) => {
  await openTimer(page);
  await start(page);
  await page.clock.runFor(257_000 + 1000);

  await expect(page.locator('#phaseLabel')).toHaveText('Workout Complete!');
  await expect(page.locator('#exercise-description')).toContainText('saved');
  const [saved] = await savedWorkouts(page);
  expect(saved).toMatchObject({ num_sets: 2, exercise_duration: 20, rest_duration: 10, set_rest: 30, notes: '' });
  expect(saved).not.toHaveProperty('username');
});

test('rests of 0 create no rest phases', async ({ page }) => {
  await openTimer(page, { num_sets: 2, ex_duration: 20, rest_duration: 0, set_rest: 0 });
  const types = await page.evaluate(() => phases.map((p) => p.type));
  expect(types).toEqual(['countdown', ...Array(8).fill('exercise')]);
});

test('opening the timer with no workout shows a message instead of Start', async ({ page }) => {
  await page.goto('timer.html');
  await expect(page.locator('#exercise')).toHaveText('No workout loaded');
  await expect(page.locator('#startBtn')).toBeHidden();
});
