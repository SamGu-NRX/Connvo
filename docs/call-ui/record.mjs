import fs from "node:fs/promises";
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { RunContext } from "../../tools/call-eval/runner/context.mjs";
import { chromiumLaunchArgs } from "../../tools/call-eval/runner/peers.mjs";
const ctx = new RunContext({transport:"p2p",page:"real",baseUrl:"http://localhost:3105",warmUp:false});
let browser;
try {
  await ctx.start();ctx.newMeeting("lane5-recording");
  const fixture=ctx.fixturePaths("A");
  browser=await chromium.launch({headless:true,args:chromiumLaunchArgs(fixture.video,fixture.audio)});
  const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:"/tmp/connvo-lane5-recording",size:{width:1440,height:900}}});
  const page=await context.newPage();
  const video=page.video();
  await ctx.openRealPage({page},"A",{});
  await ctx.launchPeer("B");
  await page.getByTestId("self-preview").waitFor();
  await page.addStyleTag({content:"nextjs-portal {display:none !important}"});
  // These holds pace the review recording; they are not test synchronization.
  const hold = () => page.waitForTimeout(900);
  await hold();
  const handle=page.getByRole("button",{name:/Move self view/});
  await handle.hover();
  const box=await handle.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  for(let step=1;step<=30;step++) {
    await page.mouse.move(box.x+box.width/2+(160-box.x-box.width/2)*step/30,box.y+box.height/2+(190-box.y-box.height/2)*step/30);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
  await hold();
  await page.getByTestId("toggle-mic").click();
  await hold();
  await page.getByTestId("toggle-mic").click();
  await handle.focus();await page.keyboard.press("ArrowRight");await page.keyboard.press("ArrowDown");
  await hold();
  await page.getByTestId("device-settings").click();
  await hold();
  await page.getByTestId("video-quality").selectOption("data-saver");
  await hold();
  await page.keyboard.press("Escape");
  await hold();
  await page.getByTestId("leave-call").click();
  await hold();
  await page.getByTestId("leave-call-confirm").click();
  await page.getByRole("heading",{name:"You left the call"}).waitFor();
  await hold();
  await context.close();
  const file=await video.path();
  execFileSync("ffmpeg",["-y","-i",file,"-an","-c:v","libx264","-preset","fast","-crf","24","-pix_fmt","yuv420p","-movflags","+faststart","docs/call-ui/interaction.mp4"],{stdio:"ignore"});
  await fs.rm(file);
  console.log("Recorded docs/call-ui/interaction.mp4");
} finally {await browser?.close();await ctx.stop();}
