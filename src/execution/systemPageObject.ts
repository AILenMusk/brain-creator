import type { Locator, Page } from "@playwright/test";
import type { SystemBrainSnapshot, SystemBrainSnapshotAsset } from "../brain/types.js";
import { canonicalPageRoute } from "../shared/pageIdentity.js";

export type ConfirmedSystemPageSnapshot = Pick<
  SystemBrainSnapshot,
  "id" | "systemId" | "revision" | "status" | "assets"
>;

export type RequiredSystemPageObjectBinding = {
  pageModelId: string;
  locatorPointId: string;
};

export function requiredPageObjectBindingsForSteps(
  steps: Array<{
    id: string;
    action: "navigate" | "fill" | "click" | "assert" | "wait" | "select" | "api";
    pageModelId?: string;
    locatorPointId?: string;
  }>
): RequiredSystemPageObjectBinding[] {
  const bindings = new Map<string, RequiredSystemPageObjectBinding>();
  for (const step of steps) {
    if (step.action === "api" || step.action === "navigate") continue;
    if (!step.pageModelId || !step.locatorPointId) {
      throw new Error(
        `Execution step ${step.id} must bind both pageModelId and locatorPointId before POM execution.`
      );
    }
    bindings.set(`${step.pageModelId}\u0000${step.locatorPointId}`, {
      pageModelId: step.pageModelId,
      locatorPointId: step.locatorPointId
    });
  }
  return [...bindings.values()];
}

export type SystemPageObjectAction =
  | "click"
  | "fill"
  | "select-option"
  | "text-content"
  | "input-value"
  | "is-visible"
  | "extension";

export type SystemPageObjectEvidence = {
  snapshotId: string;
  snapshotRevision: number;
  systemId: string;
  pageModelId: string;
  locatorPointId: string;
  action: SystemPageObjectAction;
  extensionId?: string;
  pageUrl: string;
  status: "succeeded" | "failed";
  failureCode?: string;
  checkedAt: string;
};

export type SystemPageObjectOptions = {
  onAction?: (evidence: SystemPageObjectEvidence) => void | Promise<void>;
  extensions?: Record<string, (input: { page: Page; target: Locator }) => Promise<unknown>>;
};

export class SystemPageObjectResolutionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "snapshot_not_confirmed"
      | "page_model_missing"
      | "page_not_current"
      | "locator_point_missing"
      | "locator_not_found"
      | "locator_ambiguous"
      | "locator_not_visible"
      | "extension_not_registered"
  ) {
    super(message);
    this.name = "SystemPageObjectResolutionError";
  }
}

export function validateConfirmedSystemPageObjectBindings(
  snapshot: ConfirmedSystemPageSnapshot | undefined,
  bindings: RequiredSystemPageObjectBinding[]
) {
  if (bindings.length === 0) return { valid: true as const, missingBindings: [] };
  if (!snapshot || snapshot.status !== "confirmed") {
    return { valid: false as const, missingBindings: bindings, reason: "A confirmed System Brain snapshot is required." };
  }
  const missingBindings = bindings.filter(
    ({ pageModelId, locatorPointId }) => !findPageAsset(snapshot.assets, pageModelId) || !findLocatorAsset(snapshot.assets, pageModelId, locatorPointId)
  );
  return missingBindings.length
    ? { valid: false as const, missingBindings, reason: "One or more required page object bindings are missing from the confirmed System Brain snapshot." }
    : { valid: true as const, missingBindings: [] };
}

type SnapshotPage = {
  pageModelId: string;
  route: string;
};

type SnapshotLocator = {
  locatorPointId: string;
  selector: string;
};

export type SystemPageControl = {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  selectOption(value: string): Promise<void>;
  textContent(): Promise<string | null>;
  inputValue(): Promise<string>;
  isVisible(): Promise<boolean>;
  extend(extensionId: string): Promise<unknown>;
};

/**
 * Creates an execution adapter over confirmed System Brain knowledge.
 * It deliberately exposes no raw Playwright Locator and never tries fallback selectors.
 */
export function createSystemPageObject(
  page: Page,
  snapshot: ConfirmedSystemPageSnapshot,
  pageModelId: string,
  options: SystemPageObjectOptions = {}
) {
  if (snapshot.status !== "confirmed") {
    throw new SystemPageObjectResolutionError(
      `System Brain snapshot ${snapshot.id} is not confirmed.`,
      "snapshot_not_confirmed"
    );
  }

  const pageAsset = findPageAsset(snapshot.assets, pageModelId);
  if (!pageAsset) {
    throw new SystemPageObjectResolutionError(
      `Confirmed System Brain snapshot ${snapshot.id} has no page model ${pageModelId}.`,
      "page_model_missing"
    );
  }

  const pageRoute = pageAsset.route;

  return {
    pageModelId,
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    control(locatorPointId: string): SystemPageControl {
      const locatorAsset = findLocatorAsset(snapshot.assets, pageModelId, locatorPointId);
      if (!locatorAsset) {
        throw new SystemPageObjectResolutionError(
          `Confirmed System Brain snapshot ${snapshot.id} has no locator point ${locatorPointId} for page ${pageModelId}.`,
          "locator_point_missing"
        );
      }

      const selector = locatorAsset.selector;
      const locator = page.locator(selector);

      return {
        click: () => execute(locatorPointId, "click", locator, true, () => locator.click()),
        fill: (value) => execute(locatorPointId, "fill", locator, true, () => locator.fill(value)),
        selectOption: async (value) => {
          await execute(locatorPointId, "select-option", locator, true, async () => {
            await locator.selectOption(value);
          });
        },
        textContent: () => execute(locatorPointId, "text-content", locator, false, () => locator.textContent()),
        inputValue: () => execute(locatorPointId, "input-value", locator, false, () => locator.inputValue()),
        isVisible: () => execute(locatorPointId, "is-visible", locator, false, () => locator.isVisible()),
        extend: (extensionId) => execute(
          locatorPointId,
          "extension",
          locator,
          true,
          async () => {
            const extension = options.extensions?.[extensionId];
            if (!extension) {
              throw new SystemPageObjectResolutionError(
                `System Page Object extension ${extensionId} is not registered.`,
                "extension_not_registered"
              );
            }
            return extension({ page, target: locator });
          },
          extensionId
        )
      };
    }
  };

  async function execute<T>(
    locatorPointId: string,
    action: SystemPageObjectAction,
    locator: Locator,
    requireVisible: boolean,
    operation: () => Promise<T>,
    extensionId?: string
  ): Promise<T> {
    const pageUrl = page.url();
    const evidence: SystemPageObjectEvidence = {
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      systemId: snapshot.systemId,
      pageModelId,
      locatorPointId,
      action,
      ...(extensionId ? { extensionId } : {}),
      pageUrl,
      status: "failed",
      checkedAt: new Date().toISOString()
    };
    let result: T | undefined;
    let operationError: unknown;

    try {
      if (canonicalPageRoute(pageUrl) !== canonicalPageRoute(pageRoute)) {
        throw new SystemPageObjectResolutionError(
          `Current page ${pageUrl} does not match confirmed System Brain route ${pageRoute}.`,
          "page_not_current"
        );
      }
      const count = await locator.count();
      if (count === 0) {
        throw new SystemPageObjectResolutionError(
          `Locator point ${locatorPointId} did not match an element on ${pageUrl}.`,
          "locator_not_found"
        );
      }
      if (count !== 1) {
        throw new SystemPageObjectResolutionError(
          `Locator point ${locatorPointId} matched ${count} elements; a unique target is required.`,
          "locator_ambiguous"
        );
      }
      if (requireVisible && !(await locator.isVisible())) {
        throw new SystemPageObjectResolutionError(
          `Locator point ${locatorPointId} is not visible on ${pageUrl}.`,
          "locator_not_visible"
        );
      }
      result = await operation();
      evidence.status = "succeeded";
    } catch (error) {
      operationError = error;
      evidence.status = "failed";
      evidence.failureCode =
        error instanceof SystemPageObjectResolutionError ? error.code : "page_action_failed";
    }

    try {
      await options.onAction?.(evidence);
    } catch (evidenceError) {
      if (operationError === undefined) throw evidenceError;
    }

    if (operationError !== undefined) throw operationError;
    return result as T;
  }
}

function findPageAsset(assets: SystemBrainSnapshotAsset[], pageModelId: string): SnapshotPage | undefined {
  const matches = assets.filter(
    (asset) => asset.kind === "page" && asset.metadata.pageModelId === pageModelId
  );
  if (matches.length !== 1) return undefined;
  const route = matches[0].metadata.route;
  return typeof route === "string" && route.trim()
    ? { pageModelId, route }
    : undefined;
}

function findLocatorAsset(
  assets: SystemBrainSnapshotAsset[],
  pageModelId: string,
  locatorPointId: string
): SnapshotLocator | undefined {
  const matches = assets.filter(
    (asset) =>
      asset.kind === "locator" &&
      asset.metadata.pageModelId === pageModelId &&
      asset.metadata.locatorPointId === locatorPointId
  );
  if (matches.length !== 1) return undefined;
  const selector = matches[0].metadata.selector;
  return typeof selector === "string" && selector.trim()
    ? { locatorPointId, selector }
    : undefined;
}
