"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  const [pointerOpened, setPointerOpened] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const dialogId = useId();
  useEffect(() => {
    const query = matchMedia(
      "(max-width: 767px), (max-height: 500px) and (orientation: landscape)",
    );
    const update = () => {
      setMobile(query.matches);
      setOpen(!query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // A native dialog keeps the notes editor mounted when closed, without
    // leaving Radix's force-mounted modal pointer/aria guards on the call.
    element.close();
    if (open) {
      if (mobile) {
        element.showModal();
        close.current?.focus();
      } else {
        // An inline desktop panel must not steal focus from the call.
        element.setAttribute("open", "");
      }
    }
  }, [mobile, open]);
  const dismiss = () => {
    setOpen(false);
    dialog.current?.close();
    trigger.current?.focus();
  };
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={styles.panelTrigger}
        data-testid="toggle-side-panel"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={(event) => {
          setPointerOpened(event.detail > 0);
          setOpen(!open);
        }}
      >
        <PanelRight size={18} aria-hidden />
        <span>{title}</span>
      </button>
      <dialog
        ref={dialog}
        id={dialogId}
        className={`dark ${styles.sidePanel}`}
        aria-labelledby={titleId}
        data-pointer-opened={pointerOpened}
        onCancel={(event) => {
          event.preventDefault();
          dismiss();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget || !mobile) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            dismiss();
        }}
      >
        <header className={styles.panelHeader}>
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            ref={close}
            aria-label={`Close ${title.toLowerCase()}`}
            onClick={dismiss}
          >
            <X size={20} aria-hidden />
          </button>
        </header>
        <div className={styles.panelBody}>{children}</div>
      </dialog>
    </>
  );
}
