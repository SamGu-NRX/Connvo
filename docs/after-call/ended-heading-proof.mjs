// A compiled-CSS check of the keyboard-leave proof, without auth or Convex.
// --source-ref=d4137fd uses that head's exact heading class and globals.css.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from '@playwright/test';
import { keyboardLeave } from '../../tools/call-eval/scripts/after-call-keyboard.mjs';
const ref = process.argv.find(arg => arg.startsWith('--source-ref='))?.slice('--source-ref='.length);
const source = file => ref ? execFileSync('git', ['show', `${ref}:${file}`], {encoding:'utf8'}) : fs.readFileSync(file,'utf8');
// Tailwind scans the selected tree, not the caller's potentially different classes.
const compileRoot = fs.mkdtempSync(path.join(os.tmpdir(),'connvo-heading-tree-'));
if (ref) {
  const archive = path.join(compileRoot,'source.tar');
  execFileSync('git',['archive','--format=tar','--output='+archive,ref]);
  execFileSync('tar',['-xf',archive,'-C',compileRoot]);
  fs.unlinkSync(archive);
} else fs.cpSync('src',path.join(compileRoot,'src'),{recursive:true});
fs.symlinkSync(path.resolve('node_modules'),path.join(compileRoot,'node_modules'),'dir');
const room = source('src/components/call/CallRoom.tsx');
const classes = room.match(/className="([^"]*)"\s*>\s*You left the call/)?.[1];
assert.ok(classes, 'ended heading class not found');
const css = (await postcss([tailwind({base:compileRoot})]).process(source('src/app/globals.css'), {from:path.join(compileRoot,'src/app/ended-heading-proof.css')})).css;
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.setContent(`<style>${css}</style><main data-call-phase="connected"><button data-testid="leave-call">Leave</button></main>`);
  await page.evaluate(classes => {
    const root = document.querySelector('main');
    document.querySelector('button').onclick = () => {
      root.innerHTML = '<button data-testid="leave-call-confirm">Leave call</button>';
      root.querySelector('button').onclick = () => {
        root.setAttribute('data-call-phase','left');
        root.innerHTML = '<h1 tabindex="-1">You left the call</h1>';
        root.querySelector('h1').className = classes;
        root.querySelector('h1').focus();
      };
    };
  }, classes);
  console.log(await keyboardLeave(page));
} finally { await browser.close(); fs.rmSync(compileRoot,{recursive:true,force:true}); }
