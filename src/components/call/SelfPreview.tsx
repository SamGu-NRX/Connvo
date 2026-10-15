"use client";

import { animate } from "motion";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Move } from "lucide-react";
import { Tile, type TileProps } from "./call-parts";
import styles from "./call.module.css";

type Corner = { right: boolean; bottom: boolean };

/** A corner stays meaningful when the stage resizes or the phone rotates. */
export function SelfPreview({
  stage,
  ...tile
}: TileProps & { stage: RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const corner = useRef<Corner>({ right: true, bottom: true });
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const [position, setPosition] = useState("bottom right");

  const bounds = () => ({
    x: Math.max(
      0,
      (stage.current?.clientWidth ?? 0) - (ref.current?.offsetWidth ?? 0) - 24,
    ),
    y: Math.max(
      0,
      (stage.current?.clientHeight ?? 0) -
        (ref.current?.offsetHeight ?? 0) -
        24,
    ),
  });
  const snap = (motion: boolean) => {
    if (!ref.current) return;
    const b = bounds();
    const transform = `translate(${corner.current.right ? b.x : 0}px, ${corner.current.bottom ? b.y : 0}px)`;
    animation.current?.stop();
    if (motion && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animation.current = animate(
        ref.current,
        { transform },
        { type: "spring", duration: 0.5, bounce: 0.2 },
      );
    } else ref.current.style.transform = transform;
    setPosition(
      `${corner.current.bottom ? "bottom" : "top"} ${corner.current.right ? "right" : "left"}`,
    );
  };
  const snapRef = useRef(snap);
  useLayoutEffect(() => {
    snapRef.current = snap;
  });
  useEffect(() => {
    const observer = new ResizeObserver(() => snapRef.current(false));
    if (stage.current) observer.observe(stage.current);
    if (ref.current) observer.observe(ref.current);
    snapRef.current(false);
    return () => {
      observer.disconnect();
      animation.current?.stop();
    };
  }, [stage]);

  return (
    <div
      ref={ref}
      className={styles.pip}
      data-testid="self-preview"
      data-corner={position}
    >
      <Tile {...tile} self className={styles.pipTile} />
      <button
        type="button"
        className={styles.pipHandle}
        aria-label={`Move self view, ${position}. Use arrow keys or drag.`}
        onKeyDown={(e) => {
          if (!e.key.startsWith("Arrow")) return;
          e.preventDefault();
          if (e.key === "ArrowLeft") corner.current.right = false;
          if (e.key === "ArrowRight") corner.current.right = true;
          if (e.key === "ArrowUp") corner.current.bottom = false;
          if (e.key === "ArrowDown") corner.current.bottom = true;
          snap(false);
        }}
        onClick={(e) => {
          if (e.detail === 0) {
            corner.current.right = !corner.current.right;
            snap(false);
          }
        }}
        onPointerDown={(e) => {
          if (drag.current || e.button !== 0 || !ref.current || !stage.current)
            return;
          animation.current?.stop();
          const r = ref.current.getBoundingClientRect();
          const p = stage.current.getBoundingClientRect();
          drag.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            startX: r.left - p.left - 12,
            startY: r.top - p.top - 12,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId || !ref.current) return;
          const b = bounds();
          const x = Math.max(0, Math.min(b.x, d.startX + e.clientX - d.x));
          const y = Math.max(0, Math.min(b.y, d.startY + e.clientY - d.y));
          d.moved ||= Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4;
          ref.current.style.transform = `translate(${x}px, ${y}px)`;
          corner.current = { right: x > b.x / 2, bottom: y > b.y / 2 };
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          if (!drag.current.moved) corner.current.right = !corner.current.right;
          drag.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
          snap(true);
        }}
        onPointerCancel={() => {
          drag.current = null;
          snap(false);
        }}
      >
        <Move size={14} aria-hidden />
        <span>Move</span>
      </button>
    </div>
  );
}
