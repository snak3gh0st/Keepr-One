"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useI18n } from "@/components/i18n/LanguageProvider";

gsap.registerPlugin(useGSAP, ScrollTrigger);

type Point = { label: string; tooltipLabel?: string; value: number };

function buildPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    d += ` C ${midX} ${prev.y}, ${midX} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return d;
}

/**
 * Renders even sparse/mostly-zero data as a legible shape: value 0 sits on
 * the baseline, not an empty box, and the one real data point still reads
 * as a deliberate peak rather than a rendering bug.
 */
export function TrendChart({
  data,
  format = "currency",
  compact = false,
  tone = "default",
  interactive = false,
  ariaLabel,
  chartHeight = 150,
}: {
  data: Point[];
  format?: "currency" | "count";
  compact?: boolean;
  tone?: "default" | "onDark";
  interactive?: boolean;
  ariaLabel?: string;
  chartHeight?: number;
}) {
  const { copy, locale } = useI18n();
  const resolvedAriaLabel = ariaLabel ?? copy("Gráfico de tendência", "Trend chart");
  const formatValue =
    format === "currency"
      ? (v: number) =>
          new Intl.NumberFormat(locale, {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(v)
      : (v: number) => `${v}`;
  const lineColor = tone === "onDark" ? "var(--color-mint)" : "var(--color-teal)";
  const peakColor = tone === "onDark" ? "var(--color-paper)" : "var(--color-gold)";
  const gradientId = useId();
  const scope = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const width = compact ? 160 : 600;
  const height = compact ? 44 : chartHeight;
  const padX = compact ? 3 : 4;
  const padY = compact ? 4 : 14;

  const { linePath, areaPath, points, peakIndex } = useMemo(() => {
    const rawMax = Math.max(0, ...data.map((d) => d.value));
    const min = Math.min(0, ...data.map((d) => d.value));
    const max = rawMax === min ? rawMax + 1 : rawMax;
    const range = max - min;
    const step = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
    const points = data.map((d, i) => ({
      x: data.length > 1 ? padX + i * step : width / 2,
      y: padY + ((max - d.value) / range) * (height - padY * 2),
      value: d.value,
      label: d.label,
      tooltipLabel: d.tooltipLabel ?? copy(`Mês ${d.label}`, `Month ${d.label}`),
    }));
    const linePath = buildPath(points);
    const zeroY = padY + ((max - 0) / range) * (height - padY * 2);
    const areaPath =
      points.length > 0
        ? `${linePath} L ${points[points.length - 1].x} ${zeroY} L ${points[0].x} ${zeroY} Z`
        : "";
    let peakIndex = 0;
    data.forEach((d, i) => {
      if (d.value > data[peakIndex].value) peakIndex = i;
    });
    return { linePath, areaPath, points, peakIndex };
  }, [copy, data, width, height, padX, padY]);

  const activeIndex = hoverIndex ?? focusIndex;
  const [indicatorIndex, setIndicatorIndex] = useState(peakIndex);
  const safeIndicatorIndex = Math.min(indicatorIndex, Math.max(0, points.length - 1));
  const indicatorPoint = points[safeIndicatorIndex];
  const indicatorLeft = indicatorPoint ? `${(indicatorPoint.x / width) * 100}%` : "0%";
  const indicatorTop = indicatorPoint ? `${(indicatorPoint.y / height) * 100}%` : "0%";
  const tooltipX = safeIndicatorIndex === 0 ? "0%" : safeIndicatorIndex === points.length - 1 ? "-100%" : "-50%";
  const tooltipY = indicatorPoint && indicatorPoint.y < height * 0.32 ? "12px" : "calc(-100% - 12px)";
  const tooltipId = `${gradientId}-tooltip`;

  useGSAP(
    () => {
      const line = lineRef.current;
      const area = areaRef.current;
      if (!line || !area || !scope.current) return;

      const pointNodes = gsap.utils.toArray<SVGCircleElement>("[data-chart-point]");
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        const pathLength = line.getTotalLength();
        gsap.set(line, {
          strokeDasharray: pathLength,
          strokeDashoffset: pathLength,
        });
        gsap.set(area, {
          opacity: 0,
          scaleY: 0.72,
          transformOrigin: "50% 100%",
        });
        gsap.set(pointNodes, {
          opacity: 0,
          scale: 0,
          transformOrigin: "center",
        });

        const timeline = gsap.timeline({
          delay: interactive ? 0.34 : 0,
          scrollTrigger: {
            trigger: scope.current,
            start: "top 92%",
            once: true,
          },
        });

        timeline
          .to(line, {
            strokeDashoffset: 0,
            duration: 1.15,
            ease: "power3.out",
          })
          .to(
            area,
            {
              opacity: 1,
              scaleY: 1,
              duration: 0.82,
              ease: "power2.out",
            },
            "-=0.74",
          )
          .to(
            pointNodes,
            {
              opacity: 1,
              scale: 1,
              duration: 0.36,
              stagger: 0.055,
              ease: "back.out(1.8)",
            },
            "-=0.48",
          );
      });

      media.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set([line, area, ...pointNodes], { clearProps: "all" });
      });

      return () => media.revert();
    },
    { scope, dependencies: [areaPath, interactive, linePath] },
  );

  useGSAP(
    () => {
      if (!interactive || compact) return;

      const tooltip = scope.current?.querySelector<HTMLElement>("[data-chart-tooltip]");
      const guide = scope.current?.querySelector<HTMLElement>("[data-chart-guide]");
      const activeDot = scope.current?.querySelector<HTMLElement>("[data-chart-active-dot]");
      if (!tooltip || !guide || !activeDot) return;

      const targets = [tooltip, guide, activeDot];
      gsap.killTweensOf(targets);

      if (activeIndex === null) {
        gsap.to(targets, {
          autoAlpha: 0,
          duration: 0.16,
          ease: "power2.out",
        });
        return;
      }

      gsap.fromTo(
        tooltip,
        { autoAlpha: 0, y: 7, scale: 0.94 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.28, ease: "power3.out" },
      );
      gsap.fromTo(
        guide,
        { autoAlpha: 0, scaleY: 0.2, transformOrigin: "50% 100%" },
        { autoAlpha: 1, scaleY: 1, duration: 0.3, ease: "power3.out" },
      );
      gsap.fromTo(
        activeDot,
        { autoAlpha: 0, scale: 0.35 },
        { autoAlpha: 1, scale: 1, duration: 0.32, ease: "back.out(2.4)" },
      );
    },
    { scope, dependencies: [activeIndex, compact, interactive] },
  );

  if (data.length === 0) return null;

  return (
    <div ref={scope} className={compact ? "w-40" : "w-full"}>
      <div className={`relative ${interactive && !compact ? "cursor-crosshair" : ""}`}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={resolvedAriaLabel}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path ref={areaRef} d={areaPath} fill={`url(#${gradientId})`} />
          <path
            ref={lineRef}
            d={linePath}
            fill="none"
            stroke={lineColor}
            strokeWidth={compact ? 1.75 : 2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p, i) => (
            <circle
              key={i}
              data-chart-point
              cx={p.x}
              cy={p.y}
              r={i === peakIndex && p.value > 0 ? (compact ? 2.5 : 3.5) : compact ? 1.5 : 2.25}
              fill={i === peakIndex && p.value > 0 ? peakColor : lineColor}
            />
          ))}
        </svg>

        {interactive && !compact && indicatorPoint && (
          <>
            <span
              aria-hidden
              data-chart-guide
              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-gradient-to-b from-paper/0 via-paper/32 to-paper/0 opacity-0 transition-[left] duration-200"
              style={{ left: indicatorLeft }}
            />
            <span
              aria-hidden
              data-chart-active-dot
              className="pointer-events-none absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-rail-strong bg-paper opacity-0 shadow-[0_0_0_4px_rgba(106,232,145,0.22)] transition-[left,top] duration-200"
              style={{ left: indicatorLeft, top: indicatorTop }}
            />
            <span
              className="pointer-events-none absolute z-30 transition-[left,top] duration-200"
              style={{
                left: indicatorLeft,
                top: indicatorTop,
                transform: `translate(${tooltipX}, ${tooltipY})`,
              }}
            >
              <span
                id={tooltipId}
                role="tooltip"
                data-chart-tooltip
                className="flex min-w-[104px] flex-col rounded-xl border border-white/12 bg-[#f4f4f1] px-3 py-2 text-left text-ink opacity-0 shadow-[0_14px_34px_rgba(0,0,0,0.3)]"
              >
                <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                  {indicatorPoint.tooltipLabel}
                </span>
                <span className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">
                  {formatValue(indicatorPoint.value)}
                </span>
              </span>
            </span>

            <span className="absolute inset-0 z-20">
              {points.map((point, index) => {
                const leftEdge = index === 0 ? 0 : ((points[index - 1].x + point.x) / 2 / width) * 100;
                const rightEdge =
                  index === points.length - 1 ? 100 : ((point.x + points[index + 1].x) / 2 / width) * 100;

                return (
                  <button
                    key={`${point.label}-${index}`}
                    type="button"
                    aria-label={`${point.tooltipLabel}: ${formatValue(point.value)}`}
                    aria-describedby={activeIndex === index ? tooltipId : undefined}
                    aria-pressed={activeIndex === index}
                    className="group absolute inset-y-0 cursor-crosshair rounded-lg focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-paper/70"
                    style={{ left: `${leftEdge}%`, width: `${rightEdge - leftEdge}%` }}
                    onMouseEnter={() => {
                      setIndicatorIndex(index);
                      setHoverIndex(index);
                    }}
                    onMouseLeave={() => setHoverIndex(null)}
                    onFocus={() => {
                      setIndicatorIndex(index);
                      setFocusIndex(index);
                    }}
                    onBlur={() => setFocusIndex(null)}
                    onClick={() => {
                      setIndicatorIndex(index);
                      setFocusIndex(index);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setHoverIndex(null);
                        setFocusIndex(null);
                        event.currentTarget.blur();
                      }
                    }}
                  >
                    <span
                      aria-hidden
                      className={`absolute inset-1 rounded-lg transition-colors duration-300 ${
                        activeIndex === index ? "bg-white/[0.035]" : "bg-transparent"
                      }`}
                    />
                  </button>
                );
              })}
            </span>
          </>
        )}
      </div>
      {!compact && !interactive && (
        <div className={`mt-2 flex justify-between font-mono text-[10px] ${tone === "onDark" ? "text-paper/45" : "text-ink-muted"}`}>
          {data.map((d, i) => (
            <span key={i} className={i === peakIndex && d.value > 0 ? `font-semibold ${tone === "onDark" ? "text-paper" : "text-ink"}` : ""}>
              {i === peakIndex && d.value > 0 ? formatValue(d.value) : ""}
            </span>
          ))}
        </div>
      )}
      {!compact && (
        <div className={`mt-1 flex justify-between font-mono text-[10px] ${tone === "onDark" ? "text-paper/38" : "text-ink-muted"}`}>
          {data.map((d, i) => (
            <span
              key={i}
              className={`transition-colors duration-200 ${
                interactive && activeIndex === i ? (tone === "onDark" ? "text-paper" : "text-ink") : ""
              }`}
            >
              {d.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export type { Point as TrendChartPoint };
