import { defineConfig, devices } from "@playwright/test";
import { orderFixtureBrowserExecutablePath } from "./tests/order-fixture-browser.js";

const executablePath = orderFixtureBrowserExecutablePath();

export default defineConfig({
  testDir: "./tests",
  testMatch: "order-approval-fixture.spec.ts",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined
  },
  projects: [{ name: "order-fixture-chromium", use: { ...devices["Desktop Chrome"] } }]
});
