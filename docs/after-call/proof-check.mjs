// Run through run-guarded.py. These browser fixtures test the proof's failure
// paths without authentication or a Convex connection.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { keyboardWalk, textContrast, assertShellMeasurements } from "../../tools/call-eval/scripts/a11y-manual.mjs";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const scratch = await browser.newPage();
  await page.setContent('<button>First</button><button>Second</button><button>Last</button>');
  const complete = await keyboardWalk(page, scratch);
  assert.equal(complete.focusLost, false);
  assert.equal(complete.truncated, false);
  assert.equal(complete.forward.length, 3);
  await page.setContent('<button>First</button><button onfocus="this.blur()">Drops focus</button><button>Last</button>');
  const broken = await keyboardWalk(page, scratch);
  assert.equal(broken.focusLost, true);
  assert.equal(broken.truncated, true);
  assert.equal(broken.forward.length, 1);
  await page.setContent('<style>body{background:white;color:black;font:16px Arial}</style><p id="opaque">Opaque</p><div style="opacity:.5"><p id="half">Half</p><div style="opacity:.5"><p id="quarter">Quarter</p></div></div>');
  const [opaque, half, quarter] = await textContrast(page, scratch, ['#opaque','#half','#quarter']);
  assert.equal(opaque.pass, true);
  assert.equal(opaque.worst, 21);
  assert.equal(half.pass, false);
  assert.equal(half.worst, 3.95);
  assert.equal(quarter.pass, false);
  assert.equal(quarter.worst, 1.84);
  assert.throws(() => assertShellMeasurements([]), /No visible shell/);
  assert.throws(() => assertShellMeasurements([{inPage:true}]), /No visible shell/);
  assertShellMeasurements([{inPage:false}]);
  console.log('PASS: complete walk, mid-walk blur, ancestor opacity, missing shell targets');
} finally { await browser.close(); }
