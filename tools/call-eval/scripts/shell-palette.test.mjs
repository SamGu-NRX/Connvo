import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { contrast } from "./a11y-manual.mjs";

const require = createRequire(import.meta.url);
// Use jsdom's installed CSS color parser so the test follows Tailwind's
// actual OKLCH palette, rather than a second table of approximated hex values.
const { convert } = createRequire(require.resolve("jsdom"))("@asamuzakjp/css-color");
const theme = readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
const root = new URL("../../../", import.meta.url);
const sources = [
  "src/components/mvp/DesktopNavigation.tsx",
  "src/components/mvp/MobileNavigation.tsx",
  "src/app/app/layout.tsx",
];
/** @param {string} name @returns {number[]} */
const color = (name) => {
  const value = theme.match(new RegExp(`--color-${name}: ([^;]+);`))?.[1];
  if (!value) throw new Error(`Missing Tailwind color: ${name}`);
  return convert.colorToRgb(value).slice(0, 3);
};
/** @param {number[]} fg @param {number} alpha @param {number[]} bg */
const over = (fg, alpha, bg) => fg.map((value, i) => value * alpha + bg[i] * (1 - alpha));

describe("shared shell text contrast", () => {
  // Arithmetic bounds, not browser measurements. The light backdrop uses
  // the darkest gradient stop. Dark includes the white glass and sheen,
  // plus the stronger of the two emerald active-item overlays.
  const backgrounds = {
    light: color("emerald-50"),
    dark: over(color("emerald-500"), 0.2,
      over([255, 255, 255], 0.12 * 0.75,
        over([255, 255, 255], 0.1, color("slate-900")))),
  };

  for (const file of sources) {
    it(`${file} keeps normal and hover colors above 4.5:1`, () => {
      const source = readFileSync(new URL(file, root), "utf8");
      const classes = [...source.matchAll(/(?<![\w:-])((?:dark:)?(?:hover:)?text-(emerald|red)-(\d+)(?:\/(\d+))?)/g)];
      expect(classes.length).toBeGreaterThan(0);
      for (const [full, token, family, shade, opacity] of classes) {
        const bg = backgrounds[token.startsWith("dark:") ? "dark" : "light"];
        const fg = over(color(`${family}-${shade}`), opacity ? Number(opacity) / 100 : 1, bg);
        expect(contrast(fg, bg), `${file}: ${full}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("mobile labels remain readable over the nested glass panel", () => {
    const source = readFileSync(new URL("src/components/mvp/MobileNavigation.tsx", root), "utf8");
    const classes = source.match(/className="([^"]*text-\[11px\][^"]*)"/)?.[1];
    const foreground = classes?.match(/(?:^| )dark:text-(emerald-\d+|white)(?:\/(\d+))?(?: |$)/);
    if (!foreground) throw new Error("The mobile labels have no dark text color");
    // The fixed bar has its own GlassPanel over the page's GlassPanel.
    const nestedGlass = over([255, 255, 255], 0.12 * 0.75,
      over([255, 255, 255], 0.1,
        over([255, 255, 255], 0.12 * 0.75,
          over([255, 255, 255], 0.1, color("slate-900")))));
    const backdrop = over(color("emerald-500"), 0.2, nestedGlass);
    const alpha = foreground[2] ? Number(foreground[2]) / 100 : 1;
    expect(contrast(over(color(foreground[1]), alpha, backdrop), backdrop))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("the wordmark keeps full text contrast while hover adds an underline", () => {
    const source = readFileSync(new URL("src/app/app/layout.tsx", root), "utf8");
    const opacity = source.match(/hover:opacity-(\d+)/)?.[1];
    const alpha = opacity ? Number(opacity) / 100 : 1;
    const foreground = source.match(/text-(emerald-\d+) dark:text/)?.[1];
    if (!foreground) throw new Error("The wordmark has no emerald text color");
    expect(contrast(over(color(foreground), alpha, backgrounds.light), backgrounds.light))
      .toBeGreaterThanOrEqual(4.5);
  });
  it("the synced notes label reaches 4.5:1 on its light card", () => {
    const source = readFileSync(new URL("src/components/meeting-notes/notesStatus.ts", root), "utf8");
    const foreground = source.match(/case "synced":[\s\S]*?tone: "text-(emerald-\d+)/)?.[1];
    if (!foreground) throw new Error("The synced notes label has no emerald text color");
    expect(contrast(color(foreground), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  });

});
