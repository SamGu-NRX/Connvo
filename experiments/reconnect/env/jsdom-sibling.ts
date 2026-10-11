/**
 * jsdom loaded from the sibling dev-dependency install
 * (/home/user/work/connvo-testdeps) so the repo's package.json and lockfiles
 * stay untouched. Vitest custom environment contract.
 *
 * We copy an explicit whitelist of DOM globals instead of using vitest's
 * populateGlobal helper: that helper trips over jsdom's undici-backed
 * `FormData` getter under this Node version ("Class extends value undefined").
 */

import { createRequire } from "node:module";
import path from "node:path";

const testdepsDir =
  process.env["RECONNECT_TESTDEPS_DIR"] ?? "/home/user/work/connvo-testdeps";
const siblingRequire = createRequire(path.join(testdepsDir, "package.json"));

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const { JSDOM }: any = siblingRequire("jsdom");

const GLOBALS_TO_COPY = [
  "document",
  "navigator",
  "Node",
  "Element",
  "DocumentFragment",
  "Text",
  "Comment",
  "CDATASection",
  "ProcessingInstruction",
  "HTMLElement",
  "HTMLIFrameElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLOptionElement",
  "SVGSVGElement",
  "SVGElement",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "InputEvent",
  "EventTarget",
  "DOMParser",
  "XMLSerializer",
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
  "scrollTo",
] as const;

export default {
  name: "jsdom-sibling",
  // Vitest 4: map this environment onto the default Vite "client" environment.
  viteEnvironment: "client",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup(global: any) {
    const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
      url: "http://localhost/",
      pretendToBeVisual: true,
    });
    const { window } = dom;

    // React 19 `act` requires this flag.
    global.IS_REACT_ACT_ENVIRONMENT = true;

    const copied: string[] = [];
    for (const key of GLOBALS_TO_COPY) {
      try {
        const value = window[key];
        if (value === undefined) continue;
        if (typeof value === "function" && !("prototype" in value)) {
          global[key] = value.bind(window);
        } else {
          global[key] = value;
        }
        copied.push(key);
      } catch {
        // skip getters that explode under this Node version
      }
    }
    global.window = window;
    global.document = window.document;

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      teardown(_global: any) {
        dom.window.close();
        for (const key of [...copied, "window", "document", "IS_REACT_ACT_ENVIRONMENT"]) {
          delete global[key];
        }
      },
    };
  },
};
