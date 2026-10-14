import { tabTo } from "./a11y-manual.mjs";

/** Leave via Enter so the programmatically focused heading retains keyboard modality.
 * @param {import('@playwright/test').Page} page
 */
export async function keyboardLeave(page) {
  await tabTo(page, '[data-testid="leave-call"]');
  await page.keyboard.press("Enter");
  await tabTo(page, '[data-testid="leave-call-confirm"]');
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-call-phase]")
        ?.getAttribute("data-call-phase") === "left",
  );
  await page
    .locator('[data-testid="leave-call-confirm"]')
    .waitFor({ state: "hidden" });
  return assertEndedHeadingFocus(page);
}

/** @param {import('@playwright/test').Page} page */
export async function assertEndedHeadingFocus(page) {
  const heading = page.getByRole("heading", {
    name: "You left the call",
    exact: true,
  });
  await heading.waitFor();
  const state = await heading.evaluate((el) => {
    const boxShadow = getComputedStyle(el).boxShadow;
    const visibleShadow =
      boxShadow !== "none" &&
      boxShadow.split(/,(?![^(]*\))/).some((shadow) => {
        const lengths = [...shadow.matchAll(/(-?\d*\.?\d+)px/g)].map((match) =>
          Number(match[1]),
        );
        const transparent =
          /rgba\([^)]*,\s*0(?:\.0+)?\)/.test(shadow) ||
          /\([^)]*\/\s*0(?:\.0+)?\s*\)/.test(shadow);
        return (
          !transparent && ((lengths[2] ?? 0) !== 0 || (lengths[3] ?? 0) !== 0)
        );
      });
    return {
      focused: el === document.activeElement,
      focusVisible: el.matches(":focus-visible"),
      boxShadow,
      visibleShadow,
    };
  });
  if (!state.focused || !state.focusVisible || state.visibleShadow)
    throw new Error(
      `Keyboard leave heading has missing focus or visible shadow: ${JSON.stringify(state)}`,
    );
  return state;
}

/** Capture the control and its outward focus bands with the same padding each run.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} control
 * @param {string} file
 */
export async function captureFocusControl(page, control, file) {
  const focused = await control.evaluate(
    (el) =>
      document.activeElement instanceof HTMLElement &&
      el.contains(document.activeElement) &&
      document.activeElement.matches(":focus-visible"),
  );
  if (!focused)
    throw new Error(
      "Focus capture target does not contain keyboard-visible focus",
    );
  const style = await page.addStyleTag({
    content:
      "*, *::before, *::after {transition:none!important;animation:none!important}",
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const box = await control.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) {
    await style.evaluate((node) => node.parentNode?.removeChild(node));
    throw new Error("Focused control has no capture area");
  }
  const x = Math.max(0, box.x - 8),
    y = Math.max(0, box.y - 8);
  await page.screenshot({
    path: file,
    clip: {
      x,
      y,
      width: Math.min(box.width + 16, viewport.width - x),
      height: Math.min(box.height + 16, viewport.height - y),
    },
    animations: "disabled",
  });
  await style.evaluate((node) => node.parentNode?.removeChild(node));
}
