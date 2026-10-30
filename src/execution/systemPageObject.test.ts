import type { Locator, Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import {
  createSystemPageObject,
  requiredPageObjectBindingsForSteps,
  SystemPageObjectResolutionError,
  type ConfirmedSystemPageSnapshot
} from "./systemPageObject.js";

describe("createSystemPageObject", () => {
  it("executes only a unique locator from the confirmed snapshot and records its binding", async () => {
    const events: unknown[] = [];
    const locator = fakeLocator({ count: 1, visible: true });
    const page = fakePage("https://orders.example.test/orders", locator);
    const object = createSystemPageObject(page, snapshot(), "orders-page", {
      onAction: (evidence) => { events.push(evidence); }
    });

    await object.control("create-order").click();

    expect(locator.click).toHaveBeenCalledOnce();
    expect(events).toEqual([
      expect.objectContaining({
        snapshotId: "snapshot-1",
        snapshotRevision: 3,
        systemId: "orders-system",
        pageModelId: "orders-page",
        locatorPointId: "create-order",
        action: "click",
        status: "succeeded"
      })
    ]);
  });

  it("fails closed for a non-confirmed snapshot", () => {
    expect(() =>
      createSystemPageObject(fakePage("https://orders.example.test/orders", fakeLocator()), {
        ...snapshot(),
        status: "candidate"
      }, "orders-page")
    ).toThrowError(SystemPageObjectResolutionError);
  });

  it("fails closed when the page route no longer matches the confirmed page", async () => {
    const onAction = vi.fn();
    const object = createSystemPageObject(
      fakePage("https://orders.example.test/other", fakeLocator({ count: 1, visible: true })),
      snapshot(),
      "orders-page",
      { onAction }
    );

    await expect(object.control("create-order").click()).rejects.toMatchObject({
      code: "page_not_current"
    });
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      locatorPointId: "create-order",
      status: "failed",
      failureCode: "page_not_current"
    }));
  });

  it("rejects ambiguous selectors and hidden write targets", async () => {
    const ambiguous = createSystemPageObject(
      fakePage("https://orders.example.test/orders", fakeLocator({ count: 2, visible: true })),
      snapshot(),
      "orders-page"
    );
    await expect(ambiguous.control("create-order").click()).rejects.toMatchObject({
      code: "locator_ambiguous"
    });

    const hidden = createSystemPageObject(
      fakePage("https://orders.example.test/orders", fakeLocator({ count: 1, visible: false })),
      snapshot(),
      "orders-page"
    );
    await expect(hidden.control("create-order").click()).rejects.toMatchObject({
      code: "locator_not_visible"
    });
  });

  it("rejects locator ids outside the confirmed snapshot", () => {
    const object = createSystemPageObject(
      fakePage("https://orders.example.test/orders", fakeLocator()),
      snapshot(),
      "orders-page"
    );

    expect(() => object.control("unconfirmed-locator")).toThrowError(
      SystemPageObjectResolutionError
    );
  });

  it("runs only explicitly registered extensions and records the extension binding", async () => {
    const events: unknown[] = [];
    const target = fakeLocator({ count: 1, visible: true });
    const page = fakePage("https://orders.example.test/orders", target);
    const extension = vi.fn(async () => "selected");
    const object = createSystemPageObject(page, snapshot(), "orders-page", {
      extensions: { "custom-select": extension },
      onAction: (evidence) => { events.push(evidence); }
    });

    await expect(object.control("create-order").extend("custom-select")).resolves.toBe("selected");
    expect(extension).toHaveBeenCalledWith({ page, target });
    expect(events).toEqual([expect.objectContaining({
      action: "extension",
      extensionId: "custom-select",
      locatorPointId: "create-order",
      status: "succeeded"
    })]);
    await expect(object.control("create-order").extend("unregistered")).rejects.toMatchObject({
      code: "extension_not_registered"
    });
  });
});

describe("requiredPageObjectBindingsForSteps", () => {
  it("requires confirmed page/locator bindings for UI operations and ignores navigation/API steps", () => {
    expect(requiredPageObjectBindingsForSteps([
      { id: "open", action: "navigate" },
      { id: "fetch", action: "api" },
      { id: "submit", action: "click", pageModelId: "orders", locatorPointId: "submit" },
      { id: "verify", action: "assert", pageModelId: "orders", locatorPointId: "status" }
    ])).toEqual([
      { pageModelId: "orders", locatorPointId: "submit" },
      { pageModelId: "orders", locatorPointId: "status" }
    ]);
  });

  it("blocks a UI operation that has no complete POM binding", () => {
    expect(() => requiredPageObjectBindingsForSteps([
      { id: "submit", action: "click", pageModelId: "orders" }
    ])).toThrow("Execution step submit must bind both pageModelId and locatorPointId");
  });
});

function snapshot(): ConfirmedSystemPageSnapshot {
  return {
    id: "snapshot-1",
    systemId: "orders-system",
    revision: 3,
    status: "confirmed",
    assets: [
      {
        semanticId: "page:/orders",
        kind: "page",
        label: "Orders",
        content: "{}",
        contentHash: "page-hash",
        sourceRefs: ["system-exploration:1"],
        metadata: { pageModelId: "orders-page", route: "/orders" }
      },
      {
        semanticId: "locator:/orders:create-order",
        kind: "locator",
        label: "Create order",
        content: "{}",
        contentHash: "locator-hash",
        sourceRefs: ["locator-point:create-order"],
        metadata: {
          pageModelId: "orders-page",
          locatorPointId: "create-order",
          selector: "#create-order"
        }
      }
    ]
  };
}

function fakePage(url: string, locator: Locator) {
  return {
    url: () => url,
    locator: vi.fn(() => locator)
  } as unknown as Page;
}

function fakeLocator(input: { count?: number; visible?: boolean } = {}) {
  return {
    count: vi.fn(async () => input.count ?? 1),
    isVisible: vi.fn(async () => input.visible ?? true),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    selectOption: vi.fn(async () => undefined),
    textContent: vi.fn(async () => "text"),
    inputValue: vi.fn(async () => "value")
  } as unknown as Locator;
}
