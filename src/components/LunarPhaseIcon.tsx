import React from 'react';
import { TelemetryState } from '../types/astronomy';

interface LunarPhaseIconProps {
  phaseAngleDeg: number; // 0 = New, 90 = First Q, 180 = Full, 270 = Last Q
  eclipseState: TelemetryState['eclipseState'];
  size?: number;
}

/**
 * Renders an astronomically accurate 2D SVG projection of the Moon's illuminated disc
 * (Northern Hemisphere convention: Waxing illuminates from right, Waning from left).
 */
export const LunarPhaseIcon: React.FC<LunarPhaseIconProps> = ({
  phaseAngleDeg,
  eclipseState,
  size = 28,
}) => {
  const rad = (phaseAngleDeg * Math.PI) / 180;
  // cos(rad): +1 at New Moon (0°), 0 at Quarters (90°/270°), -1 at Full Moon (180°)
  const k = Math.cos(rad);
  const r = 10;
  const cx = 14;
  const cy = 14;

  // Build illuminated limb path on a circle of radius r centered at (cx, cy)
  const rx = Math.abs(k) * r;
  const isWaxing = phaseAngleDeg >= 0 && phaseAngleDeg <= 180;

  // Outer semicircle side (right if waxing, left if waning)
  const outerSweep = isWaxing ? 1 : 0;
  // Inner terminator ellipse sweep depends on whether crescent (k > 0) or gibbous (k < 0)
  const innerSweep = isWaxing ? (k > 0 ? 0 : 1) : k > 0 ? 1 : 0;

  let litPath = '';
  if (phaseAngleDeg < 2 || phaseAngleDeg > 358) {
    litPath = '';
  } else if (Math.abs(phaseAngleDeg - 180) < 2) {
    litPath = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
  } else {
    litPath = `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} A ${rx.toFixed(
      2
    )} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z`;
  }

  const isLunarEclipse =
    eclipseState === 'lunar-total' || eclipseState === 'lunar-partial';
  const fillCol =
    eclipseState === 'lunar-total'
      ? '#C2410C'
      : eclipseState === 'lunar-partial'
        ? '#E2A374'
        : '#E2E8F0';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="#131B2E"
        stroke="rgba(148, 163, 184, 0.3)"
        strokeWidth="1"
      />
      {litPath && (
        <path
          d={litPath}
          fill={fillCol}
          opacity={isLunarEclipse ? 0.9 : 0.95}
        />
      )}
    </svg>
  );
};
