/**
 * The two accessibility checks axe cannot finish on these pages, measured
 * from screenshots instead of computed styles.
 *
 * - Text contrast: the app background is a gradient under blurred colour
 *   blobs, so axe reports color-contrast as "incomplete" for nearly every
 *   node. textContrast() screenshots the element with and without its text;
 *   the pixels that differ are where glyphs are drawn, and every one of them
 *   must reach the WCAG ratio against the backdrop pixel under it.
 * - Keyboard: keyboardWalk() tabs through a region forwards and backwards,
 *   records each stop, and measures how much each stop's pixels change when
 *   it takes focus. It passes when the pixels that change by 3:1 or more
 *   add up to a 2px band around the element, the minimum in WCAG 2.4.13.
 *
 * Screenshots are taken at deviceScaleFactor 1, so one pixel is one CSS px.
 */

import fs from "node:fs";

/** @typedef {import('@playwright/test').Page} Page */

/** WCAG relative luminance of an sRGB triple in 0..255. */
function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Decode a PNG into RGBA bytes in a blank page, so no image library is needed. */
async function pixels(scratch, png) {
  return scratch.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      data: Array.from(
        ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
      ),
    };
  }, png.toString("base64"));
}

/** A computed CSS colour (oklch, color(), rgba…) as sRGB bytes plus alpha, via a canvas. */
async function srgb(scratch, css) {
  return scratch.evaluate((value) => {
    const ctx = new OffscreenCanvas(1, 1).getContext("2d");
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { rgb: [r, g, b], alpha: a / 255 };
  }, css);
}

const over = (fg, alpha, bg) =>
  fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

/**
 * Text contrast for each selector, against the real pixels behind its
 * glyphs. Returns one row per element: how many pixels the text covers, the
 * worst ratio over them, the size class that sets the threshold, and
 * pass/fail. A row whose text draws no pixels fails: its colour matches the
 * backdrop.
 * @param {Page} page @param {Page} scratch @param {string[]} selectors
 */
export async function textContrast(page, scratch, selectors) {
  const rows = [];
  // No transitions anywhere while measuring: badges and buttons fade their
  // colour, so hiding a parent's text and restoring it would leave a child
  // mid-fade when its own turn comes.
  const probeStyle = await page.addStyleTag({
    content:
      // Only the element's own text goes transparent: children with a colour
      // of their own (a badge in a row) stay drawn and so drop out of the diff.
      "*, *::before, *::after { transition: none !important; animation: none !important; } [data-a11y-probe] { color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }",
  });
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    // axe lists nodes from both layouts; one hidden at this size has nothing to measure.
    if ((await el.count()) === 0 || !(await el.isVisible())) continue;
    await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const info = await el.evaluate((node) => {
      const style = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      let opacity = 1;
      /** @type {Element | null} */
      let ancestor = node;
      for (; ancestor; ancestor = ancestor.parentElement) {
        opacity *= Number(getComputedStyle(ancestor).opacity);
      }
      // The page's own content is the innermost <main>; anything else is the app shell around it.
      const content = [...document.querySelectorAll("main")].find(
        (m) => !m.querySelector("main"),
      );
      return {
        inPage: !!content?.contains(node),
        color: style.color,
        opacity,
        fontSize: parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight) || 400,
        text: (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
        box: {
          x: Math.max(0, r.x),
          y: Math.max(0, r.y),
          width: Math.min(r.width, innerWidth - Math.max(0, r.x)),
          height: Math.min(r.height, innerHeight - Math.max(0, r.y)),
        },
      };
    });
    if (!info.text || info.box.width < 1 || info.box.height < 1) continue;
    await page.waitForTimeout(50);
    const drawn = await pixels(
      scratch,
      await page.screenshot({ clip: info.box }),
    );
    await el.evaluate((node) => node.setAttribute("data-a11y-probe", ""));
    await page.waitForTimeout(50);
    const behind = await pixels(
      scratch,
      await page.screenshot({ clip: info.box }),
    );
    await el.evaluate((node) => node.removeAttribute("data-a11y-probe"));
    const text = await srgb(scratch, info.color);
    let covered = 0;
    let worst = Infinity;
    for (let i = 0; i < behind.data.length; i += 4) {
      const bg = [behind.data[i], behind.data[i + 1], behind.data[i + 2]];
      const changed =
        drawn.data[i] !== bg[0] ||
        drawn.data[i + 1] !== bg[1] ||
        drawn.data[i + 2] !== bg[2];
      if (!changed) continue;
      covered++;
      worst = Math.min(worst, contrast(over(text.rgb, text.alpha * info.opacity, bg), bg));
    }
    const large =
      info.fontSize >= 24 || (info.fontSize >= 18.66 && info.fontWeight >= 700);
    const need = large ? 3 : 4.5;
    rows.push({
      selector,
      inPage: info.inPage,
      text: info.text,
      fontSize: info.fontSize,
      need,
      coveredPixels: covered,
      worst: covered > 0 ? Number(worst.toFixed(2)) : 1,
      pass: covered > 0 && worst >= need,
    });
  }
  await probeStyle.evaluate((node) => node.remove());
  return rows;
}

/** @param {{ inPage: boolean }[]} rows */
export function assertShellMeasurements(rows) {
  if (!rows.some((row) => !row.inPage)) {
    throw new Error("No visible shell text was measured at this viewport");
  }
}

/** How the focused element is described in the walk record. */
async function describeFocus(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const labelled = el.getAttribute("aria-labelledby");
    const name =
      el.getAttribute("aria-label") ??
      (labelled
        ? labelled
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
        : null) ??
      el.textContent;
    const r = el.getBoundingClientRect();
    // The page's own content is the innermost <main>; the rest is the app shell.
    const content = [...document.querySelectorAll("main")].find(
      (m) => !m.querySelector("main"),
    );
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      name: (name ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
      testid: el.getAttribute("data-testid"),
      inPage: !!content?.contains(el),
      focusVisible: el.matches(":focus-visible"),
      box: { x: r.x, y: r.y, width: r.width, height: r.height },
    };
  });
}

/**
 * Pixels that change when the element takes focus, and how strongly. The
 * indicator passes when the pixels changing by 3:1 or more against the same
 * pixels unfocused cover at least a 2px band around the element's
 * perimeter, the WCAG 2.4.13 minimum area.
 */
async function focusChange(page, scratch, savePath) {
  // Compare steady focus styles. The switch's transition-all can otherwise
  // leave the previous ring in the frame labelled unfocused.
  const probeStyle = await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  await page.evaluate(() =>
    document.activeElement?.scrollIntoView({ block: "center" }),
  );
  await page.waitForTimeout(150);
  const box = await page.evaluate(() => {
    const r = document.activeElement.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (box.width < 1 || box.height < 1) {
    await probeStyle.evaluate((node) => node.remove());
    return {
      strongPixels: 0,
      required: 0,
      maxChange: 1,
      pass: false,
      note: "focused element has no size",
    };
  }
  // Room for the two-band ring: a 2px halo plus a 3px ring, or a 2px
  // outline 2px out.
  const pad = 8;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
  const viewport = page.viewportSize();
  clip.width = Math.min(clip.width, viewport.width - clip.x);
  clip.height = Math.min(clip.height, viewport.height - clip.y);
  const focusedPng = await page.screenshot({ clip });
  if (savePath) fs.writeFileSync(savePath, focusedPng);
  const focused = await pixels(scratch, focusedPng);
  const handle = await page.evaluateHandle(() => document.activeElement);
  await handle.evaluate((el) => el.blur());
  await page.waitForTimeout(250);
  const plainPng = await page.screenshot({ clip });
  const plain = await pixels(scratch, plainPng);
  const blurState = await handle.evaluate((/** @type {HTMLElement} */ el) => ({
    stillFocused: el === document.activeElement,
    focusVisible: el.matches(":focus-visible"),
    shadow: getComputedStyle(el).boxShadow,
  }));
  // Programmatic focus after keyboard use keeps :focus-visible in Chromium.
  await handle.evaluate((el) => el.focus());
  await page.waitForTimeout(250);
  let strong = 0;
  let best = 1;
  for (let i = 0; i < focused.data.length; i += 4) {
    const a = [focused.data[i], focused.data[i + 1], focused.data[i + 2]];
    const b = [plain.data[i], plain.data[i + 1], plain.data[i + 2]];
    const c = contrast(a, b);
    if (c >= 3) strong++;
    if (c > best) best = c;
  }
  const required = Math.round(2 * 2 * (box.width + box.height));
  if (savePath && strong < required) fs.writeFileSync(savePath.replace(/\.png$/, "-unfocused.png"), plainPng);
  await probeStyle.evaluate((node) => node.remove());
  return {
    strongPixels: strong,
    required,
    maxChange: Number(best.toFixed(2)),
    pass: strong >= required && !blurState.stillFocused,
    blurState,
  };
}

/**
 * Tab from the top of the page to its last stop, then Shift+Tab back. A
 * walk that reaches `max` stops without wrapping is `truncated`, so the
 * caller can fail it rather than pass a page it only partly walked. Each stop records what took focus, whether :focus-visible
 * matched, and the focus indicator measurement; with `shots`, each focused
 * stop is also saved as `<shots>-<n>.png`.
 * @param {Page} page @param {Page} scratch @param {{ max?: number, shots?: string }} [opts]
 */
export async function keyboardWalk(page, scratch, { max = 120, shots } = {}) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  // Start the sequential-navigation point at the top of the document.
  await page.locator("body").evaluate((body) => {
    body.setAttribute("tabindex", "-1");
    body.focus();
    body.removeAttribute("tabindex");
  });
  const forward = [];
  let last = null;
  let truncated = true;
  let focusLost = false;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(120);
    const stop = await describeFocus(page);
    // Past the page's last stop: the browser chrome, or next dev's overlay
    // (a development-only element that production doesn't render).
    if (stop === null || stop.tag === "nextjs-portal") {
      // Body is normal only after the final sequential stop. A blur or
      // disabled control in the middle must not turn a partial walk green.
      const reachedLast = last && await last.evaluate((/** @type {Element} */ el) => {
        const candidates = Array.from(document.querySelectorAll(
          'a[href],button,input,select,textarea,[tabindex]',
        )).filter((node) => node instanceof HTMLElement && node.tabIndex >= 0 &&
          !node.matches(':disabled') && !node.closest('nextjs-portal') &&
          node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
        return candidates.at(-1) === el;
      });
      focusLost = !reachedLast;
      truncated = focusLost;
      break;
    }
    if (
      forward.length > 0 &&
      forward[0].testid === stop.testid &&
      forward[0].name === stop.name &&
      forward[0].tag === stop.tag
    ) {
      truncated = false;
      break;
    }
    stop.indicator = await focusChange(
      page,
      scratch,
      shots
        ? `${shots}-${String(forward.length + 1).padStart(2, "0")}.png`
        : undefined,
    );
    last = await page.evaluateHandle(() => document.activeElement);
    forward.push(stop);
  }
  // Walk back from the last stop.
  if (last) await last.evaluate((el) => el.focus());
  const backward = [];
  for (let i = 0; i < forward.length - 1; i++) {
    await page.keyboard.press("Shift+Tab");
    await page.waitForTimeout(80);
    const stop = await describeFocus(page);
    if (stop === null) break;
    backward.push({ tag: stop.tag, name: stop.name, testid: stop.testid });
  }
  const key = (s) => `${s.tag}|${s.name}|${s.testid}`;
  const expectedBack = forward.slice(0, -1).reverse().map(key);
  return {
    forward,
    backward,
    truncated,
    focusLost,
    reverseMatches:
      JSON.stringify(backward.map(key)) === JSON.stringify(expectedBack),
  };
}

/**
 * Press `key` on the element matched by `selector` after reaching it with
 * Tab from the top, so activation goes through real keyboard focus.
 * @param {Page} page @param {string} selector @param {number} [max]
 */
export async function tabTo(page, selector, max = 60) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("body").evaluate((body) => {
    body.setAttribute("tabindex", "-1");
    body.focus();
    body.removeAttribute("tabindex");
  });
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (
      await page
        .locator(selector)
        .first()
        .evaluate((el) => el === document.activeElement)
    )
      return i + 1;
  }
  throw new Error(`Tab never reached ${selector}`);
}
