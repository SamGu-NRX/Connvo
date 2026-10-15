"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelRight, X } from "lucide-react";
import styles from "./call.module.css";

export function CallSidePanel({
  children,
  title = "Conversation",
}: {
  children: ReactNode;
  title?: string;
}) {
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = matchMedia("(max-width: 767px)");
    const update = () => {
      setMobile(query.matches);
      setOpen(!query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return (
    <Dialog.Root modal={mobile} open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className={styles.panelTrigger}
        data-testid="toggle-side-panel"
        title={title}
      >
        <PanelRight size={18} aria-hidden />
        <span>{title}</span>
      </Dialog.Trigger>
      {mobile && <Dialog.Overlay className={styles.sheetOverlay} />}
      <Dialog.Content
        forceMount
        hidden={!open}
        inert={!open}
        className={styles.sidePanel}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (mobile) close.current?.focus();
        }}
        onInteractOutside={(e) => {
          if (!mobile) e.preventDefault();
        }}
      >
        <header className={styles.panelHeader}>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close ref={close} aria-label={`Close ${title.toLowerCase()}`}>
            <X size={20} aria-hidden />
          </Dialog.Close>
        </header>
        <div className={styles.panelBody}>{children}</div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
