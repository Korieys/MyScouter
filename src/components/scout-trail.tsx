"use client";

import { useEffect, useRef, useState } from "react";

interface ScoutTrailProps {
  step: string;
  detail: string;
  progress: number;
  domain: string;
}

// Each leg of the journey maps onto a span of the server's 0-100 progress values.
const LEGS = [
  { key: "camp", label: "Break camp", start: 0, end: 15 },
  { key: "arrive", label: "Reach the site", start: 15, end: 35 },
  { key: "capture", label: "Capture pages", start: 35, end: 72 },
  { key: "enhance", label: "Enhance assets", start: 72, end: 95 },
  { key: "notes", label: "Write field notes", start: 95, end: 100 },
];

const TRAIL_PATH = "M 34 138 C 96 142, 112 72, 178 76 S 268 150, 340 118 S 430 46, 524 54";

const PINES = [
  { x: 74, y: 96, s: 1 },
  { x: 92, y: 104, s: 0.7 },
  { x: 250, y: 62, s: 0.9 },
  { x: 274, y: 70, s: 0.65 },
  { x: 300, y: 158, s: 0.8 },
  { x: 410, y: 140, s: 1 },
  { x: 432, y: 150, s: 0.7 },
  { x: 470, y: 100, s: 0.75 },
];

// Eases the displayed value toward the real one, then creeps slowly toward the next
// leg so long server steps (page captures, AI enhancement) never look frozen.
function useTrailProgress(target: number) {
  const [shown, setShown] = useState(0);
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    let raf = 0;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let last = performance.now();
    let value = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const real = targetRef.current;

      if (preference.matches) {
        value = real;
        setShown(real);
        raf = requestAnimationFrame(tick);
        return;
      }

      if (value < real) {
        value += (real - value) * (1 - Math.exp(-dt * 4));
        if (real - value < 0.05) value = real;
      } else if (real < 100) {
        const nextLeg = LEGS.find((leg) => leg.start > real);
        const ceiling = Math.min(real + 5, (nextLeg?.start ?? 100) - 0.5, 99);
        if (value < ceiling) value += (ceiling - value) * dt * 0.08;
      }

      setShown((prev) => (Math.abs(prev - value) > 0.02 ? value : prev));
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return shown;
}

function useElapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function ScoutTrail({ step, detail, progress, domain }: ScoutTrailProps) {
  // Held in state (via callback ref) so render can measure the path once it mounts.
  const [pathEl, setPathEl] = useState<SVGPathElement | null>(null);
  const pathLength = pathEl?.getTotalLength() ?? 0;
  const eased = useTrailProgress(Math.max(0, progress));
  const elapsed = useElapsed();
  const isDone = step === "done";
  const shown = isDone ? 100 : eased;

  const pointAt = (pct: number) => {
    if (!pathEl || !pathLength) return { x: 34, y: 138 };
    const p = pathEl.getPointAtLength((pathLength * Math.min(pct, 100)) / 100);
    return { x: p.x, y: p.y };
  };

  const scout = pointAt(shown);
  const activeLeg = LEGS.findIndex((leg) => progress < leg.end);
  const activeIndex = isDone ? LEGS.length : activeLeg === -1 ? LEGS.length - 1 : activeLeg;

  return (
    <div className={`scout-trail${isDone ? " is-done" : ""}`} role="status" aria-live="polite">
      <div className="scout-trail-header">
        <span className="label-scout">
          {isDone ? "Scout returned" : "On the trail"} · <span style={{ color: "var(--forest)" }}>{domain}</span>
        </span>
        <span className="scout-trail-clock">{elapsed}</span>
      </div>

      <div className="scout-trail-map">
        <svg viewBox="0 0 560 180" width="100%" aria-hidden="true">
          {/* Topographic contours */}
          <g className="scout-trail-contours">
            <ellipse cx="190" cy="80" rx="120" ry="52" />
            <ellipse cx="190" cy="80" rx="80" ry="32" />
            <ellipse cx="190" cy="80" rx="40" ry="14" />
            <ellipse cx="470" cy="56" rx="110" ry="44" />
            <ellipse cx="470" cy="56" rx="64" ry="24" />
          </g>

          {/* Compass */}
          <g transform="translate(528 146)" className="scout-trail-compass">
            <circle r="16" />
            <g className="scout-trail-needle">
              <path d="M 0 -12 L 3.5 0 L -3.5 0 Z" className="north" />
              <path d="M 0 12 L 3.5 0 L -3.5 0 Z" className="south" />
            </g>
            <text y="-20" textAnchor="middle">N</text>
          </g>

          {PINES.map((pine, i) => (
            <path
              key={i}
              className="scout-trail-pine"
              transform={`translate(${pine.x} ${pine.y}) scale(${pine.s})`}
              d="M 0 -18 L 8 -4 L 4 -4 L 10 6 L -10 6 L -4 -4 L -8 -4 Z"
            />
          ))}

          {/* Trail: footstep dots underneath, trodden path on top */}
          <path ref={setPathEl} d={TRAIL_PATH} className="scout-trail-path" />
          <path
            d={TRAIL_PATH}
            className="scout-trail-trodden"
            style={{ strokeDasharray: `${(pathLength * shown) / 100} ${pathLength}` }}
          />

          {/* Waypoints */}
          {LEGS.map((leg, i) => {
            const pt = pointAt(leg.start);
            const reached = shown >= leg.start;
            return (
              <g key={leg.key} transform={`translate(${pt.x} ${pt.y})`}>
                <circle r="6" className={`scout-trail-waypoint${reached ? " reached" : ""}`} />
                {reached && <circle r="2.2" className="scout-trail-waypoint-dot" />}
                <text y={i % 2 === 0 ? 22 : -14} textAnchor="middle" className={`scout-trail-label${i === activeIndex ? " active" : ""}`}>
                  {leg.label.split(" ").pop()}
                </text>
              </g>
            );
          })}

          {/* Summit flag */}
          <g transform="translate(524 54)">
            <line x1="0" y1="0" x2="0" y2="-30" className="scout-trail-pole" />
            <path d="M 0 -30 L 18 -24 L 0 -18 Z" className="scout-trail-flag" />
          </g>

          {/* The scout */}
          {!isDone && (
            <g transform={`translate(${scout.x} ${scout.y})`}>
              <circle r="14" className="scout-trail-pulse" />
              <g className="scout-trail-walker">
                <circle r="7.5" className="scout-trail-marker" />
                <circle r="2.5" fill="#fff" />
              </g>
            </g>
          )}
        </svg>

        {isDone && <div className="scout-trail-stamp animate-stamp">Mission complete</div>}
      </div>

      <div className="scout-trail-status">
        <span key={detail} className="scout-trail-detail">{detail}</span>
        <span className="scout-trail-percent">{Math.round(shown)}%</span>
      </div>

      <ol className="scout-trail-log">
        {LEGS.map((leg, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
          return (
            <li key={leg.key} className={`scout-trail-log-item ${state}`}>
              <span className="scout-trail-log-icon">{state === "done" ? "✓" : i + 1}</span>
              {leg.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
