// Browser-only fixture for the integration lead: real prompt view and sheet,
// local draft state. No Convex requests or production fixture route.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CallSidePanel } from "../../src/components/call/CallSidePanel";
import { PromptPanel } from "../../src/components/call/ConversationPrompts";
import styles from "../../src/components/call/call.module.css";

function Fixture() {
  const [used, setUsed] = useState(false);
  const [autoPaused, setPaused] = useState(false);
  const [alternate, setAlternate] = useState(false);
  return <div className={styles.page}>
    <div className={styles.room} style={{height:"100%",position:"relative",display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--stage)",color:"var(--ink)"}}>
      <header className={styles.header}>Connvo</header>
      <div className={styles.workspace}>
        <div className={styles.callContent}><button id="outside">Call control</button></div>
        <CallSidePanel>
          <PromptPanel state={{prompt:{id:"fixture" as never,content:alternate ? "What have you been curious about lately?" : "What's been a small highlight of your week?",used},active:true,exhausted:false,autoPaused,nextAutoAt:90000,nextManualAt:0,pendingUntil:0}} inCall now={1000} busy={false} error={null} onAnother={()=>{setAlternate(!alternate);setUsed(false);}} onUsed={()=>setUsed(true)} onPause={()=>setPaused(!autoPaused)} />
          <label>Notes draft<textarea style={{width:"100%",height:220,fontSize:16}} aria-label="Notes draft" /></label>
        </CallSidePanel>
      </div>
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
