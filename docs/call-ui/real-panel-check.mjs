// Real local Convex meeting, two authenticated harness identities, actual notes/prompts.
// Run with the lane's local backend and Next on3105. No hosted deployment.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { RunContext } from "../../tools/call-eval/runner/context.mjs";
import { joinPair, leaveCall } from "../../tools/call-eval/runner/scenario-kit.mjs";
import { storedNotes } from "../../tools/call-eval/runner/convex-signaling.mjs";
const ctx = new RunContext({transport:"p2p",page:"real",signaling:"convex",baseUrl:"http://localhost:3105",warmUp:false});
const results=[];
const sizes=[{width:1440,height:900},{width:390,height:844},{width:844,height:390}];
const out="docs/call-ui/screenshots";
async function capture(page,name,size){
 await page.addStyleTag({content:"nextjs-portal{display:none!important}"});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 results.push({check:"capture-geometry",name,size,geometry:await page.evaluate(()=>({scrollY,rootScroll:document.querySelector('[data-testid="call-root"]').scrollTop,header:document.querySelector('[data-testid="call-root"] > header').getBoundingClientRect().toJSON()}))});
 assert.equal(await page.getByTestId("call-root").evaluate(el=>el.scrollTop),0,"Panel focus must not scroll the clipped call frame");
 const dialog=page.getByRole("dialog",{name:"Conversation"});
 if(await dialog.isVisible()) {
  assert.equal(await dialog.evaluate(el=>el.scrollTop),0,"Only the panel body may scroll");
  const bounds=await dialog.boundingBox(),close=await page.getByRole("button",{name:"Close conversation"}).boundingBox();
  assert(close.y>=bounds.y&&close.y+close.height<=bounds.y+bounds.height,"Sheet close button remains visible after notes focus");
 }
 await page.screenshot({path:`${out}/${name}-${size.width}x${size.height}.png`,animations:"disabled"});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
}
try {
 await ctx.start();ctx.newMeeting("Lane5 real lobby acceptance");
 const lobby=await ctx.launchPeer("A",{autojoin:"0"});
 await lobby.page.getByTestId("join-call").waitFor();
 for(const size of sizes){
  await lobby.page.setViewportSize(size);
  const audit=await new AxeBuilder({page:lobby.page}).include("[data-testid=call-root]").analyze();
  results.push({check:"axe-real-lobby",size,violations:audit.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))});
  assert.equal(audit.violations.length,0,JSON.stringify(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))));
  await capture(lobby.page,"real-lobby",size);
 }
 await lobby.close();ctx.newMeeting("Lane5 real panel acceptance");
 const {peerA,peerB}=await joinPair(ctx);
 const a=peerA.page,b=peerB.page;
 await a.getByTestId("network-status").filter({hasText:"Good connection"}).waitFor({timeout:20000});
 for(const page of [a,b]) {
  await page.getByTestId("conversation-prompts").waitFor();
  await page.getByTestId("current-prompt").waitFor({timeout:30000});
  await page.getByTestId("notes-editor").waitFor();
 }
 const prompt=await a.getByTestId("current-prompt").innerText();
 assert.equal(await b.getByTestId("current-prompt").innerText(),prompt);
 await a.getByRole("button",{name:"Pause automatic prompts"}).click();
 await b.getByRole("button",{name:"Resume automatic prompts"}).waitFor();
 await a.getByRole("button",{name:"We used this"}).focus();
 await a.keyboard.press("Enter");
 await b.getByText("Marked as used. Saved to your recap.").waitFor();
 const notes="A shared thought from our conversation.\nLet's follow up next week.";
 await a.getByRole("textbox",{name:"Shared meeting notes"}).fill(notes);
 await a.getByRole("button",{name:"Resume automatic prompts"}).focus();
 await a.getByTestId("notes-status").filter({hasText:"Synced"}).waitFor();
 await b.waitForFunction(value=>document.querySelector('[data-testid="notes-editor"]').value===value,notes);
 assert.equal(storedNotes(ctx.meetingId).content,notes);
 results.push({check:"real-shared-prompts-and-notes",pass:true,meetingId:ctx.meetingId,signaling:"convex",identities:["A","B"],sharedPrompt:prompt,notesPersisted:true});
 for(const size of sizes){
  await a.setViewportSize(size);
  const phone=size.width<768||size.height<500;
  if(phone){
   await a.getByTestId("toggle-side-panel").focus();
   await a.keyboard.press("Enter");
  }
  await a.getByRole("dialog",{name:"Conversation"}).waitFor();
  await a.getByTestId("conversation-prompts").evaluate(el=>el.scrollIntoView({block:"start"}));
  await capture(a,"real-conversation-panel",size);
  const audit=await new AxeBuilder({page:a}).include(phone?"dialog":"[data-testid=call-root]").analyze();
  results.push({check:"axe-real-panel",size,violations:audit.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))});
  assert.equal(audit.violations.length,0,JSON.stringify(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))));
  const traversed=[];
  await a.getByRole("button",{name:"Close conversation"}).focus();
  for(let i=0;i<16;i++){
   await a.keyboard.press("Tab");
   traversed.push(await a.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.getAttribute("aria-label")||document.activeElement?.textContent?.trim(),testId:document.activeElement?.getAttribute("data-testid")})));
   if(traversed.some(x=>x.testId==="notes-editor")&&traversed.some(x=>x.text?.includes("Resume")))break;
  }
  assert(traversed.some(x=>x.testId==="notes-editor"),"Notes reachable by Tab");
  assert(traversed.some(x=>x.text?.includes("Resume")),"Enabled prompt action reachable by Tab");
  await a.getByTestId("notes-panel").evaluate(el=>el.scrollIntoView({block:"start"}));
  await capture(a,"real-conversation-notes",size);
  const accessibility=await a.getByRole("dialog",{name:"Conversation"}).ariaSnapshot();
  assert.match(accessibility,/textbox "Shared meeting notes"/);
  assert.match(accessibility,/A little inspiration/);
  results.push({check:"keyboard-and-accessible-names",size,pass:true,traversed,accessibility});
  if(phone){
   await a.keyboard.press("Escape");
   assert.equal(await a.getByTestId("toggle-side-panel").evaluate(el=>el===document.activeElement),true);
   await capture(a,"real-connected-sheet-closed",size);
   await a.getByTestId("toggle-side-panel").click();
   assert.equal(await a.getByTestId("notes-editor").inputValue(),notes);
   await a.keyboard.press("Escape");
  }
 }
 await leaveCall(peerA);await leaveCall(peerB);
} catch(error){results.push({check:"real-panel",error:error.stack});process.exitCode=1;}
finally {await ctx.stop();await fs.writeFile("docs/call-ui/verification/real-panel.json",JSON.stringify(results,null,2)+"\n");console.log(JSON.stringify(results,null,2));}
