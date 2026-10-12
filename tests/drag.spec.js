const { test, expect, waitForGenerator } = require('./helpers');

// Real touch input via the Chrome DevTools protocol, so the drag helper gets
// the same trusted touch events a phone or tablet sends.
async function touchDrag(page, from, to) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x, y) => [{ x: Math.round(x), y: Math.round(y) }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) });
  await page.waitForTimeout(400); // hold, like a long press
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x, y) });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
}

async function generateFour(page) {
  await page.goto('index.html');
  await waitForGenerator(page);
  await page.fill('#num_exercises', '4');
  await page.click('#generateBtn');
  await expect(page.locator('#sortable .exercise-card')).toHaveCount(4);
}

async function dragFirstPastThird(page) {
  const cards = page.locator('#sortable .exercise-card');
  const before = await page.evaluate(() => currentWorkout.map((e) => e.id));
  // Touches only reach what's on screen
  await page.evaluate(() => document.getElementById('sortable').scrollIntoView({ block: 'center' }));
  const a = await cards.nth(0).boundingBox();
  const c = await cards.nth(2).boundingBox();
  // Drop on the right/lower half of the third card, so it lands after it
  await touchDrag(page,
    { x: a.x + a.width / 2, y: a.y + a.height / 2 },
    { x: c.x + c.width * 0.8, y: c.y + c.height * 0.8 });
  const after = await page.evaluate(() => currentWorkout.map((e) => e.id));
  return { before, after };
}

test.describe('iPad (reports itself as a Mac)', () => {
  test.use({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: false,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    serviceWorkers: 'block',
  });

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 });
    });
  });

  test('the drag helper is forced on and Safari text selection is off', async ({ page }) => {
    await generateFour(page);
    await expect(page.locator('html')).toHaveClass(/dnd-polyfill-forced/);
    const styles = await page.locator('#sortable .exercise-card').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { select: cs.webkitUserSelect || cs.userSelect, drag: cs.webkitUserDrag };
    });
    expect(styles.select).toBe('none');
  });

  test('press-and-drag reorders the exercises', async ({ page }) => {
    await generateFour(page);
    const { before, after } = await dragFirstPastThird(page);
    // The exact slot depends on pixel positions, which vary with the fonts and
    // layout of the machine running the test. Check that the card moved, and
    // that nothing was lost or duplicated.
    expect(after).not.toEqual(before);
    expect(after.indexOf(before[0])).toBeGreaterThan(0);
    expect([...after].sort()).toEqual([...before].sort());
    // The on-screen order matches what will be used for the timer
    const domOrder = await page.locator('#sortable .exercise-card').evaluateAll(
      (els) => els.map((el) => Number(el.dataset.id)));
    expect(domOrder).toEqual(after);
  });
});

test.describe('Android', () => {
  test.use({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    serviceWorkers: 'block',
  });

  test('press-and-drag still reorders the exercises', async ({ page }) => {
    await generateFour(page);
    await expect(page.locator('html')).not.toHaveClass(/dnd-polyfill-forced/);
    const { before, after } = await dragFirstPastThird(page);
    expect(after).not.toEqual(before);
    expect(after[0]).toBe(before[1]);
    expect(new Set(after)).toEqual(new Set(before));
  });
});

test('desktop browsers keep their own drag and drop', async ({ page }) => {
  await page.goto('index.html');
  await waitForGenerator(page);
  await expect(page.locator('html')).not.toHaveClass(/dnd-polyfill-forced/);
});
