// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:8000/',
  },
  webServer: {
    command: 'python3 run.py',
    url: 'http://localhost:8000/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
