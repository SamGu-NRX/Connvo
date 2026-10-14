// Run through run-guarded.py. These browser fixtures test the proof's failure
// paths without authentication or a Convex connection.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { keyboardWalk, textContrast, assertShellMeasurements } from "../../tools/call-eval/scripts/a11y-manual.mjs";

import { assertEndedHeadingFocus } from '../../tools/call-eval/scripts/after-call-keyboard.mjs';
import { recordBrowserConsole, unexpectedErrors } from '../../tools/call-eval/scripts/after-call-proof-support.mjs';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const scratch = await browser.newPage();
  await page.setContent('<button tabindex="2">Second</button><button tabindex="1">First</button><button>Last</button><div inert><button>Ignored</button></div>');
  const ordered = await keyboardWalk(page, scratch);
  assert.equal(ordered.focusLost, false);
  assert.deepEqual(ordered.forward.map(stop => stop.name), ['First', 'Second', 'Last']);
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
  for (const [shadow, visible] of [['0 0 4px 0 black',true],['0 0 0 2px black',true],['0 0 4px 2px transparent',false],['0 0 4px 2px oklch(1 0 0 / 0)',false]]) {
    await page.setContent(`<button>Keyboard</button><h1 tabindex="-1" style="box-shadow:${shadow}">You left the call</h1>`);
    await page.keyboard.press('Tab');
    await page.locator('h1').focus();
    if (visible) await assert.rejects(assertEndedHeadingFocus(page),/visible shadow/);
    else assert.equal((await assertEndedHeadingFocus(page)).visibleShadow,false);
  }
  const consoleRows=[];
  recordBrowserConsole(page,'fixture',consoleRows);
  await page.evaluate(()=>{console.warn('synthetic warning');console.error('synthetic unexpected error');});
  await page.waitForFunction(()=>true);
  assert.deepEqual(consoleRows.map(row=>row.level),['warning','error']);
  assert.equal(unexpectedErrors(consoleRows).length,1);
  console.log('PASS: complete walk, mid-walk blur, ancestor opacity, missing shell targets');
} finally { await browser.close(); }
