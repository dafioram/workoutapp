// Shared test setup. The exercise library normally comes from the
// exercise-data GitHub Pages site; tests serve tests/fixtures/ instead so
// they don't depend on the network.
const base = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');
const DATA_URL = 'https://dafioram.github.io/exercise-data/';
const EXERCISES = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'exercises.json'), 'utf8'));

// Override what the exercise-data site returns, per file name
// ("exercises.json", "version.json"). A value can be:
//   'hang' - never respond (a connection that's up but passing no data)
//   'fail' - network error
//   object/string - JSON body to return
// Files not listed fall back to the fixtures.
async function serveExerciseData(context, overrides) {
  await context.route(DATA_URL + '**', async (route) => {
    const file = route.request().url().split('?')[0].split('/').pop();
    const value = typeof overrides === 'function' ? overrides(file) : overrides[file];
    if (value === undefined) return route.fallback();
    if (value === 'hang') return;
    if (value === 'fail') return route.abort('internetdisconnected');
    return route.fulfill({
      body: typeof value === 'string' ? value : JSON.stringify(value),
      contentType: 'application/json',
    });
  });
}

const test = base.test.extend({
  context: async ({ context }, use) => {
    await context.route(DATA_URL + '**', (route) => {
      const file = route.request().url().split('?')[0].split('/').pop();
      return route.fulfill({ path: path.join(FIXTURES, file), contentType: 'application/json' });
    });
    await use(context);
  },
  // Fails the test on any uncaught page error
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(page);
    base.expect(errors, 'uncaught page errors').toEqual([]);
  },
});

async function waitForGenerator(page) {
  await page.waitForFunction(() => !document.getElementById('generateBtn').disabled);
}

// Adds workouts straight into the on-device database
async function addWorkouts(page, workouts) {
  await page.evaluate(async (list) => {
    await window.AppReady.catch(() => {});
    await DB.importWorkouts(list);
  }, workouts);
}

function workoutRecord(overrides = {}) {
  return {
    timestamp: '2026-10-05T00:00:00.000Z',
    num_sets: 2,
    exercise_duration: 30,
    rest_duration: 10,
    set_rest: 60,
    location: 'home',
    rpe: 5,
    notes: '',
    exercises: [
      { id: 101, name: 'Push Ups', muscle: 'chest', order_index: 0 },
      { id: 102, name: 'Squats', muscle: 'quads', order_index: 1 },
    ],
    ...overrides,
  };
}

module.exports = {
  test,
  expect: base.expect,
  EXERCISES,
  serveExerciseData,
  waitForGenerator,
  addWorkouts,
  workoutRecord,
};
