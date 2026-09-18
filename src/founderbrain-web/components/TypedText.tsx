/**
 * One-line typewriter. Pauses on ellipses. Reduced motion shows the full string.
 */
import { useEffect, useRef, useState } from "react";

export function TypedText({
  text,
  onDone,
}: {
  text: string;
  onDone?: () => void;
}) {
  const [count, setCount] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setCount(text.length);
      doneRef.current?.();
      return;
    }
    setCount(0);
    let i = 0;
    let timer = 0;
    const step = () => {
      i += 1;
      setCount(i);
      if (i >= text.length) {
        doneRef.current?.();
        return;
      }
      const next = text[i] ?? "";
      const prev = text[i - 1] ?? "";
      let delay = 32;
      if (prev === "." && next === ".") delay = 160;
      else if (prev === "." && next === " ") delay = 420;
      else if (prev === "?" || prev === "!") delay = 280;
      else if (prev === ",") delay = 140;
      timer = window.setTimeout(step, delay);
    };
    timer = window.setTimeout(step, 240);
    return () => window.clearTimeout(timer);
  }, [text]);

  const done = count >= text.length;
  return (
    <>
      {text.slice(0, count)}
      <span className={done ? "typed-caret done" : "typed-caret"} aria-hidden="true" />
    </>
  );
}
