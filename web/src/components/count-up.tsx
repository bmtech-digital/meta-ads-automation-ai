"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated count-up — plays once on mount from 0 to `value`. Uses
 * requestAnimationFrame with an ease-out cubic so the number "settles" into
 * place rather than ticking linearly. Respects prefers-reduced-motion (jumps
 * straight to value).
 *
 * Visual role: turns dashboard hero numbers into a "moment" — the eye lands
 * on the value as it stops moving, which is what makes Linear/Vercel/Mercury
 * dashboards feel alive on first paint.
 */
export function CountUp({
  value,
  duration = 1100,
  format = (n) => n.toLocaleString("he-IL"),
  className,
}: {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span className={className} aria-label={format(value)}>
      {format(display)}
    </span>
  );
}
