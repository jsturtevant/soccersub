import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:4173${process.env.E2E_BASE_PATH || '/'}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
    { name: 'desktop-edge', use: { ...devices['Desktop Edge'] } },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1',
    env: { BASE_PATH: process.env.E2E_BASE_PATH || '/' },
    url: `http://127.0.0.1:4173${process.env.E2E_BASE_PATH || '/'}`,
    reuseExistingServer: !process.env.CI,
  },
});
