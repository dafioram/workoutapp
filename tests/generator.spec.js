const { test, expect, waitForGenerator } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await page.goto('index.html');
  await waitForGenerator(page);
});

async function setInput(page, id, value) {
  await page.fill(`#${id}`, String(value));
  await page.dispatchEvent(`#${id}`, 'change');
}

test('Core Only picks exactly the ab_workout exercises', async ({ page }) => {
  await page.check('input[value=core]');
  await setInput(page, 'num_exercises', 60);
  await page.click('#generateBtn');

  const { picked, core } = await page.evaluate(async () => ({
    picked: currentWorkout.map((e) => e.id),
    core: (await DB.getAllExercises('core')).map((e) => e.id),
  }));
  expect(core.length).toBeGreaterThan(0);
  expect(new Set(picked)).toEqual(new Set(core));
});

test('TV Friendly picks only tv_friendly exercises, and all of them', async ({ page }) => {
  await page.check('input[value=tv]');
  await setInput(page, 'num_exercises', 100);
  await page.click('#generateBtn');

  const { picked, tv } = await page.evaluate(async () => ({
    picked: currentWorkout.map((e) => e.id),
    tv: (await DB.getAllExercises('tv')).map((e) => e.id),
  }));
  expect(tv.length).toBeGreaterThan(20);
  expect(new Set(picked)).toEqual(new Set(tv));
});

test('TV Friendly keeps face-down and crawling exercises out, and standing ones in', async ({ page }) => {
  await page.check('input[value=tv]');
  await setInput(page, 'num_exercises', 100);
  await page.click('#generateBtn');
  const names = await page.evaluate(() => currentWorkout.map((e) => e.name));

  for (const out of ['Push Ups', 'Bear Crawl', 'Burpee No Jump', 'Supermans', 'Bird Dog', 'Sprawl']) {
    expect(names, `${out} should not be TV friendly`).not.toContain(out);
  }
  for (const inn of ['Squats', 'Plank', 'Standing Cross Crunch', 'Bridges', 'Side Planks', 'Jumping Jacks']) {
    expect(names, `${inn} should be TV friendly`).toContain(inn);
  }
});

test('TV Friendly is remembered after a reload', async ({ page }) => {
  await page.check('input[value=tv]');
  await page.waitForTimeout(200);
  await page.reload();
  await waitForGenerator(page);
  await expect(page.locator('input[name=workout_type][value=tv]')).toBeChecked();
});

test('rests of 0 stay 0 in the total and the timer', async ({ page }) => {
  await setInput(page, 'num_exercises', 3);
  await setInput(page, 'num_sets', 2);
  await setInput(page, 'ex_duration', 30);
  await setInput(page, 'rest_duration', 0);
  await setInput(page, 'set_rest', 0);
  await page.click('#generateBtn');

  // 7s countdown + 2 sets x 3 exercises x 30s
  await expect(page.locator('#total_time')).toHaveText('3:07');

  await page.click('text=Start Timer');
  await page.waitForURL('**/timer.html');
  const session = await page.evaluate(() => ({
    setRest: AppLogic.Session.get('set_rest'),
    rest: AppLogic.Session.get('rest_duration'),
  }));
  expect(session).toEqual({ setRest: 0, rest: 0 });
  await expect(page.locator('#time-left')).toContainText('3:07');
});

test('settings are remembered after a reload', async ({ page }) => {
  await setInput(page, 'num_exercises', 4);
  await setInput(page, 'num_sets', 2);
  await setInput(page, 'ex_duration', 20);
  await setInput(page, 'rest_duration', 10);
  await setInput(page, 'set_rest', 0.5);
  await page.check('input[value=cardio]');
  await page.waitForTimeout(200);

  await page.reload();
  await waitForGenerator(page);
  const values = await page.evaluate(() => ({
    inputs: ['num_exercises', 'num_sets', 'ex_duration', 'rest_duration', 'set_rest']
      .map((id) => document.getElementById(id).value),
    type: document.querySelector('input[name=workout_type]:checked').value,
  }));
  expect(values).toEqual({ inputs: ['4', '2', '20', '10', '0.5'], type: 'cardio' });
});

test('picked exercises are locked and Generate fills the rest', async ({ page }) => {
  await setInput(page, 'num_exercises', 5);
  await page.click('text=Select Exercises');
  await page.waitForURL('**/exercises.html');
  await page.check('.exercise-checkbox[value="101"]');
  await page.check('.exercise-checkbox[value="102"]');
  await page.click('text=Use Selected & Return');
  await page.waitForURL('**/index.html');
  await waitForGenerator(page);

  await expect(page.locator('#toast')).toContainText('2 picked and locked. Tap Generate to add 3 more.');
  await expect(page.locator('#sortable .exercise-card')).toHaveCount(2);
  await expect(page.locator('#sortable .exercise-card.locked')).toHaveCount(2);

  for (let i = 0; i < 3; i++) {
    await page.click('#generateBtn');
    const ids = await page.evaluate(() => currentWorkout.map((e) => e.id));
    expect(ids).toHaveLength(5);
    expect(ids.slice(0, 2).sort()).toEqual([101, 102]);
    expect(new Set(ids).size).toBe(5);
  }
});

test('picking more exercises than the number setting raises it', async ({ page }) => {
  await setInput(page, 'num_exercises', 2);
  await page.goto('exercises.html');
  for (const id of [101, 102, 103]) {
    await page.check(`.exercise-checkbox[value="${id}"]`);
  }
  await page.click('text=Use Selected & Return');
  await waitForGenerator(page);

  await expect(page.locator('#num_exercises')).toHaveValue('3');
  await expect(page.locator('#toast')).toContainText('3 exercises picked and locked.');
});
