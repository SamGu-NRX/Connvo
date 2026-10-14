// Run from the repository root through run-guarded.py --min-free-gib 8.
// This serializes the shipped shell into a static fixture. It does not
// authenticate, call Convex, or establish history-flow acceptance.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const viteRequire = createRequire(createRequire(require.resolve("vitest")).resolve("vite"));
const { build } = viteRequire("esbuild");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const { chromium } = require("@playwright/test");
const { textContrast, keyboardWalk } = await import(pathToFileURL(path.join(root, "tools/call-eval/scripts/a11y-manual.mjs")));
const out = path.resolve(process.argv[2] ?? "tools/call-eval/out/static-shell");
fs.mkdirSync(out, { recursive: true });
const paths = ["src/app/app/layout.tsx", "src/components/mvp/DesktopNavigation.tsx", "src/components/mvp/MobileNavigation.tsx"];
const react = `import React from 'react';`;
const stubs = {
  "next/navigation": `export const usePathname=()=>'/app/meetings'; export const useRouter=()=>({push(){}});`,
  "next/link": `${react} export default ({children,...props})=>React.createElement('a',props,children);`,
  "next/image": `${react} import fs from 'node:fs'; export default ({src,priority,...props})=>React.createElement('img',{...props,src:'data:image/png;base64,'+fs.readFileSync(${JSON.stringify(root + "/public")}+src).toString('base64')});`,
  "next/font/google": `export const Inter=()=>({className:'fixture-font'});`,
  "next-themes": `${react} export const useTheme=()=>({setTheme(){}}); export const ThemeProvider=({children})=>React.createElement(React.Fragment,null,children);`,
  "motion/react": `${react} export const motion=new Proxy({}, {get:(_,tag)=>({children,initial,animate,transition,layoutId,...props})=>React.createElement(tag,props,children)});`,
  "./providers": `${react} export const Providers=({children})=>React.createElement(React.Fragment,null,children);`,
};
const results = {
  kind: "static shell fixture, not the full application or after-call proof",
  font: "Arial fallback; next/font, providers, routing and motion are serialized as static adapters",
  before: "alpha d5be541", after: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: execFileSync("git", ["status", "--porcelain"], {encoding:"utf8"}).trim().length > 0, cases: [],
};

for (const variant of ["before", "after"]) {
  const plugin = {
    name: "static-shell",
    setup(build) {
      build.onResolve({ filter: /^(next\/|next-themes$|motion\/react$|\.\/providers$)/ }, (args) =>
        stubs[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: stubs[args.path], loader: "jsx", resolveDir: root }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      build.onLoad({ filter: /\.(tsx|ts)$/ }, (args) => {
        const relative = path.relative(root, args.path);
        if (variant === "before" && paths.includes(relative)) {
          return { contents: execFileSync("git", ["show", `d5be541:${relative}`], { encoding: "utf8" }), loader: "tsx" };
        }
      });
    },
  };
  const bundle = path.join(root, "tools/call-eval/out", `${variant}-shell.cjs`);
  fs.mkdirSync(path.dirname(bundle), { recursive: true });
  await build({
    stdin: { contents: `${react} import {renderToStaticMarkup} from 'react-dom/server'; import Layout from './src/app/app/layout.tsx'; import {Button} from './src/components/ui/button.tsx'; export const html=renderToStaticMarkup(React.createElement(Layout,null,React.createElement('section',null,React.createElement('h1',{className:'text-xl font-semibold'},'Meeting recap'),React.createElement(Button,{'data-testid':'calendar-download',variant:'outline',className:'mt-4'},'Add to calendar'))));`, resolveDir: root, loader: "jsx" },
    absWorkingDir: root, outfile: bundle, bundle: true, platform: "node", format: "cjs", jsx: "automatic", alias: { "@": path.join(root, "src") }, plugins: [plugin],
  });
  const { html } = require(bundle);
  const fixture = path.join(out, `${variant}.html`);
  fs.writeFileSync(fixture, html);
  const css = variant === "before"
    ? execFileSync("git", ["show", "d5be541:src/app/globals.css"], { encoding: "utf8" })
    : fs.readFileSync("src/app/globals.css", "utf8");
  const compiled = await postcss([tailwind({ base: root })]).process(`${css}\n@source "${fixture}";`, { from: path.join(root, `src/app/fixture-${variant}.css`) });
  fs.writeFileSync(path.join(out, `${variant}.css`), compiled.css);
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${compiled.css}\n.fixture-font{font-family:Arial,sans-serif}</style></head><body>${html}</body></html>`);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await context.newPage();
  const scratch = await context.newPage();
  for (const variant of ["before", "after"]) {
    for (const theme of ["light", "dark"]) {
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto(pathToFileURL(path.join(out, `${variant}.html`)).href);
        await page.evaluate((theme) => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
        await page.addStyleTag({ content: "*,*::before,*::after {animation:none!important;transition:none!important}" });
        const label = `${variant}-${theme}-${viewport.width}`;
        const selectors = await page.locator("nav p,nav a > span:last-child > span,nav a > span:last-child,nav button,header span").evaluateAll(nodes => nodes.filter(n => n.textContent.trim()).map((n,i)=>{n.setAttribute('data-fixture-text',String(i));return `[data-fixture-text="${i}"]`;}));
        // The wordmark lives outside a semantic header in this shell.
        await page.locator("a[href='/app']").first().locator("span").last().evaluate(n=>n.setAttribute('data-fixture-wordmark',''));
        const rows = await textContrast(page, scratch, [...selectors, "[data-fixture-wordmark]"]);
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({ path: path.join(out, `${label}.png`) });
        const walk = await keyboardWalk(page, scratch, { shots: path.join(out, `${label}-focus`) });
        results.cases.push({ variant, theme, viewport, rows, walk });
        console.log(label, "min", Math.min(...rows.map(r=>r.worst)), "failures", rows.filter(r=>!r.pass).length);
      }
    }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(results, null, 2) + "\n");
}
