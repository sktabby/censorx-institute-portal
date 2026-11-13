import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Purely visual: a thin bar at the top of the screen that runs each time the
 * route pathname changes. It reads the location only to know when to animate.
 */
export default function RouteProgressBar() {
  const { pathname } = useLocation();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    setVisible(true);
    setWidth(0);

    const timers = [
      window.setTimeout(() => setWidth(80), 30),
      window.setTimeout(() => setWidth(100), 380),
      window.setTimeout(() => setVisible(false), 700),
      window.setTimeout(() => setWidth(0), 1000),
    ];

    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [pathname]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] motion-reduce:hidden"
    >
      <div
        className="h-full rounded-r-full bg-cx-bright"
        style={{
          width: `${width}%`,
          opacity: visible ? 1 : 0,
          boxShadow: "0 0 10px 1px rgba(50,178,169,0.7)",
          transition:
            width === 0
              ? "none"
              : `width ${width === 80 ? "350ms cubic-bezier(0.1, 0.7, 0.3, 1)" : "250ms ease-out"}, opacity 300ms ease`,
        }}
      />
    </div>
  );
}
