import { describe, expect, it } from "vitest";
import { validatePageObjectUsage } from "./pageObjectValidation.js";

describe("validatePageObjectUsage", () => {
  const bindings = [{ pageModelId: "demand-page", locatorPointId: "create-button" }];

  it("accepts a test that uses the confirmed page and locator ids", () => {
    expect(
      validatePageObjectUsage(
        `await bc.pageObject(page, "demand-page").control("create-button").click();`,
        bindings
      )
    ).toEqual({ valid: true });
  });

  it("requires both ids and ignores comments", () => {
    expect(
      validatePageObjectUsage(
        `// bc.pageObject(page, "demand-page").control("create-button")\nawait page.locator("#create").click();`,
        bindings
      )
    ).toMatchObject({ valid: false, reason: expect.stringContaining("demand-page/create-button") });
  });

  it("does not accept a call-shaped string literal as execution", () => {
    expect(
      validatePageObjectUsage(
        `const note = 'await bc.pageObject(page, "demand-page").control("create-button").click()';`,
        bindings
      )
    ).toMatchObject({ valid: false });
  });

  it("handles ids containing regular expression characters", () => {
    expect(
      validatePageObjectUsage(
        `await bc.pageObject(page, "page.model-1").control("button[1]").click();`,
        [{ pageModelId: "page.model-1", locatorPointId: "button[1]" }]
      )
    ).toEqual({ valid: true });
  });
});
