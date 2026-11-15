import { defineConfig } from '@playwright/test';
import dashboard from './playwright.config.mjs';

// This audit intentionally fails when the canonical handoff is not satisfied.
// Keep it separate from the existing regression gate; do not mark gaps expected failures.
export default defineConfig({
  ...dashboard,
  testDir: './tests',
  testMatch: ['e2e/**/*.spec.mjs', 'spec/**/*.spec.mjs'],
  retries: 0,
  outputDir: 'test-results/spec',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'spec-report/html', open: 'never' }],
    ['./tests/spec/reporter.mjs']
  ]
});
