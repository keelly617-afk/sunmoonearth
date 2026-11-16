import * as THREE from 'three';
import {
  MotionReferenceFrame,
  PresetEventId,
  TelemetryState,
} from '../types/astronomy';

export const ASTRO_CONSTANTS = {
  EARTH_YEAR_DAYS: 365.25636,
  EARTH_SIDEREAL_DAY: 0.99726968,
  EARTH_AXIAL_TILT_RAD: THREE.MathUtils.degToRad(23.439),
  EARTH_ORBIT_A: 28.0, // Semi-major axis in scene units
  EARTH_ORBIT_E: 0.0167, // Real orbital eccentricity
  MOON_SIDEREAL_DAYS: 27.321661,
  MOON_SYNODIC_DAYS: 29.530589,
  MOON_NODE_PRECESSION_DAYS: -6793.5, // ~18.6 year retrograde nodal precession
  MOON_INCLINATION_RAD: THREE.MathUtils.degToRad(5.145),
  MOON_ORBIT_RADIUS: 5.2,
  SUN_RADIUS: 2.6,
  SUN_AXIAL_TILT_RAD: THREE.MathUtils.degToRad(7.25),
  SUN_GALACTIC_RADIUS: 110.0, // Visual galactic arc radius around local Milky Way center
  SUN_GALACTIC_PERIOD_DAYS: 365.25636 * 12, // Visual galactic cycle (12 Earth years = 1 grand loop)
  SUN_GALACTIC_ECLIPTIC_TILT_RAD: THREE.MathUtils.degToRad(60.2), // Real 60.2° angle between ecliptic & galactic plane
  EARTH_RADIUS: 0.92,
  MOON_RADIUS: 0.26,
};

// Epoch Day 0 = 2026-03-20 12:00 UTC (Vernal Equinox)
const EPOCH_MS = Date.UTC(2026, 2, 20, 12, 0, 0);

// Initial lunar longitude offset so Day 0 starts near a crisp Waxing Crescent / First Quarter visual
const INITIAL_MOON_PHASE_OFFSET_RAD = THREE.MathUtils.degToRad(45);
// Initial ascending node longitude so Day 0 isn't locked permanently in eclipse,
// while still allowing exact preset alignments.
const INITIAL_NODE_OFFSET_RAD = THREE.MathUtils.degToRad(15);

export interface OrbitalPositions {
  sunPos: THREE.Vector3;
  earthRelPos: THREE.Vector3; // Earth position relative to Sun
  earthPos: THREE.Vector3; // World position (sunPos + earthRelPos)
  moonWorldPos: THREE.Vector3;
  moonLocalPos: THREE.Vector3; // Moon position relative to Earth
  earthOrbitAngle: number; // heliocentric longitude
  earthSpinAngle: number; // sidereal rotation around tilted Y axis
  moonOrbitAngle: number; // geocentric orbital longitude in ecliptic
  nodeAngle: number; // ascending node longitude
  lunarPhaseAngleDeg: number; // 0 = New, 90 = First Q, 180 = Full, 270 = Last Q
  moonEclipticLatDeg: number;
  eclipseState: TelemetryState['eclipseState'];
}

function normalizeAngleRad(a: number): number {
  const twoPi = Math.PI * 2;
  return ((a % twoPi) + twoPi) % twoPi;
}

const COS_GAL_TILT = Math.cos(ASTRO_CONSTANTS.SUN_GALACTIC_ECLIPTIC_TILT_RAD);
const SIN_GAL_TILT = Math.sin(ASTRO_CONSTANTS.SUN_GALACTIC_ECLIPTIC_TILT_RAD);

/**
 * Computes the Sun's galactic orbital position in world space.
 * At simDays = 0, Sun starts at (0, 0, 0) moving diagonally upward at 60.2°
 * relative to Earth's ecliptic plane, tracing a grand galactic arc.
 */
export function computeSunGalacticPosition(
  simDays: number,
  motionFrame: MotionReferenceFrame,
  out = new THREE.Vector3()
): THREE.Vector3 {
  if (motionFrame === 'heliocentric') {
    return out.set(0, 0, 0);
  }
  const { SUN_GALACTIC_RADIUS, SUN_GALACTIC_PERIOD_DAYS } = ASTRO_CONSTANTS;
  const galAngle = (simDays / SUN_GALACTIC_PERIOD_DAYS) * Math.PI * 2;
  const u = SUN_GALACTIC_RADIUS * Math.sin(galAngle);
  const w = SUN_GALACTIC_RADIUS * (1 - Math.cos(galAngle));

  return out.set(u * COS_GAL_TILT, u * SIN_GAL_TILT, -w);
}

/**
 * Computes deterministic positions and orientations for Sun, Earth, and Moon
 * at a given simulation day offset from Vernal Equinox.
 */
export function computeOrbitalPositions(
  simDays: number,
  motionFrame: MotionReferenceFrame = 'galactic',
  outSunPos = new THREE.Vector3(),
  outEarthRelPos = new THREE.Vector3(),
  outEarthPos = new THREE.Vector3(),
  outMoonLocalPos = new THREE.Vector3(),
  outMoonWorldPos = new THREE.Vector3()
): OrbitalPositions {
  const {
    EARTH_YEAR_DAYS,
    EARTH_SIDEREAL_DAY,
    EARTH_ORBIT_A,
    EARTH_ORBIT_E,
    MOON_SIDEREAL_DAYS,
    MOON_NODE_PRECESSION_DAYS,
    MOON_INCLINATION_RAD,
    MOON_ORBIT_RADIUS,
  } = ASTRO_CONSTANTS;

  computeSunGalacticPosition(simDays, motionFrame, outSunPos);

  // Earth heliocentric mean anomaly / orbital longitude (0 = Vernal Equinox at +X)
  const earthOrbitAngle = (simDays / EARTH_YEAR_DAYS) * Math.PI * 2;
  const perihelionAngle = THREE.MathUtils.degToRad(283);
  const rEarth =
    (EARTH_ORBIT_A * (1 - EARTH_ORBIT_E * EARTH_ORBIT_E)) /
    (1 + EARTH_ORBIT_E * Math.cos(earthOrbitAngle - perihelionAngle));

  // Counter-clockwise when viewed from +Y: (+X -> -Z -> -X -> +Z)
  outEarthRelPos.set(
    Math.cos(earthOrbitAngle) * rEarth,
    0,
    -Math.sin(earthOrbitAngle) * rEarth
  );
  outEarthPos.copy(outSunPos).add(outEarthRelPos);

  // Earth sidereal spin angle (West -> East = +Y rotation)
  const earthSpinAngle = (simDays / EARTH_SIDEREAL_DAY) * Math.PI * 2;

  // Lunar ascending node longitude (slowly regresses)
  const nodeAngle =
    INITIAL_NODE_OFFSET_RAD + (simDays / MOON_NODE_PRECESSION_DAYS) * Math.PI * 2;

  // Moon ecliptic longitude relative to +X
  const moonOrbitAngle =
    INITIAL_MOON_PHASE_OFFSET_RAD + (simDays / MOON_SIDEREAL_DAYS) * Math.PI * 2;

  // Argument of latitude (angle from ascending node)
  const argLat = moonOrbitAngle - nodeAngle;

  const cosU = Math.cos(argLat);
  const sinU = Math.sin(argLat);
  const cosN = Math.cos(nodeAngle);
  const sinN = Math.sin(nodeAngle);
  const cosI = Math.cos(MOON_INCLINATION_RAD);
  const sinI = Math.sin(MOON_INCLINATION_RAD);

  const xLocal = MOON_ORBIT_RADIUS * (cosN * cosU - sinN * sinU * cosI);
  const yLocal = MOON_ORBIT_RADIUS * (sinU * sinI);
  const zLocal = -MOON_ORBIT_RADIUS * (sinN * cosU + cosN * sinU * cosI);

  outMoonLocalPos.set(xLocal, yLocal, zLocal);
  outMoonWorldPos.copy(outEarthPos).add(outMoonLocalPos);

  const sunFromEarthAngle = earthOrbitAngle + Math.PI;
  const phaseRad = normalizeAngleRad(moonOrbitAngle - sunFromEarthAngle);
  const lunarPhaseAngleDeg = THREE.MathUtils.radToDeg(phaseRad);

  const moonEclipticLatDeg = THREE.MathUtils.radToDeg(Math.asin(sinU * sinI));

  const phaseDistFromNew = Math.min(
    lunarPhaseAngleDeg,
    360 - lunarPhaseAngleDeg
  );
  const phaseDistFromFull = Math.abs(lunarPhaseAngleDeg - 180);

  let eclipseState: TelemetryState['eclipseState'] = 'none';
  const absY = Math.abs(yLocal);
  if (phaseDistFromNew < 4.5 && absY < 0.72) {
    eclipseState = phaseDistFromNew < 1.8 && absY < 0.35 ? 'solar-total' : 'solar-partial';
  } else if (phaseDistFromFull < 5.5 && absY < 0.85) {
    eclipseState = phaseDistFromFull < 2.4 && absY < 0.42 ? 'lunar-total' : 'lunar-partial';
  }

  return {
    sunPos: outSunPos,
    earthRelPos: outEarthRelPos,
    earthPos: outEarthPos,
    moonLocalPos: outMoonLocalPos,
    moonWorldPos: outMoonWorldPos,
    earthOrbitAngle,
    earthSpinAngle,
    moonOrbitAngle,
    nodeAngle,
    lunarPhaseAngleDeg,
    moonEclipticLatDeg,
    eclipseState,
  };
}

/**
 * Finds the exact simulation day near a target season/syzygy that produces
 * a clean astronomical preset (Solstices, Equinoxes, Solar Eclipse, Lunar Eclipse).
 */
export function getPresetSimDays(preset: PresetEventId): number {
  const {
    EARTH_YEAR_DAYS,
    MOON_SIDEREAL_DAYS,
    MOON_NODE_PRECESSION_DAYS,
  } = ASTRO_CONSTANTS;

  switch (preset) {
    case 'vernal':
      return 0;
    case 'summer':
      return EARTH_YEAR_DAYS * 0.25;
    case 'autumn':
      return EARTH_YEAR_DAYS * 0.5;
    case 'winter':
      return EARTH_YEAR_DAYS * 0.75;
    case 'solar-eclipse':
    case 'lunar-eclipse': {
      const omegaMoon = (Math.PI * 2) / MOON_SIDEREAL_DAYS;
      const omegaNode = (Math.PI * 2) / MOON_NODE_PRECESSION_DAYS;
      const omegaEarth = (Math.PI * 2) / EARTH_YEAR_DAYS;

      let bestDay = 0;
      let bestScore = Infinity;
      const targetOffset = preset === 'solar-eclipse' ? Math.PI : 0;

      for (let k = 1; k <= 40; k++) {
        const t =
          (k * Math.PI - (INITIAL_MOON_PHASE_OFFSET_RAD - INITIAL_NODE_OFFSET_RAD)) /
          (omegaMoon - omegaNode);
        if (t < 0) continue;
        const moonAng = INITIAL_MOON_PHASE_OFFSET_RAD + omegaMoon * t;
        const earthAng = omegaEarth * t;
        const diff = Math.abs(
          Math.atan2(
            Math.sin(moonAng - (earthAng + targetOffset)),
            Math.cos(moonAng - (earthAng + targetOffset))
          )
        );
        if (diff < bestScore) {
          bestScore = diff;
          bestDay = t;
        }
      }
      const dPhaseDt = omegaMoon - omegaEarth;
      const moonAtBest = INITIAL_MOON_PHASE_OFFSET_RAD + omegaMoon * bestDay;
      const earthAtBest = omegaEarth * bestDay;
      const residual = Math.atan2(
        Math.sin(moonAtBest - (earthAtBest + targetOffset)),
        Math.cos(moonAtBest - (earthAtBest + targetOffset))
      );
      return bestDay - residual / dPhaseDt;
    }
  }
}

export function buildTelemetryState(
  simDays: number,
  orbital: OrbitalPositions,
  motionFrame: MotionReferenceFrame = 'galactic'
): TelemetryState {
  const date = new Date(EPOCH_MS + simDays * 86400 * 1000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const dateLabel = `${year}년 ${month}월 ${day}일`;

  const deg = THREE.MathUtils.radToDeg(normalizeAngleRad(orbital.earthOrbitAngle));
  let seasonName = '봄 (춘분~하지)';
  if (deg >= 355 || deg < 5) seasonName = '춘분 부근';
  else if (deg >= 5 && deg < 85) seasonName = '봄 (북반구)';
  else if (deg >= 85 && deg < 95) seasonName = '하지 부근';
  else if (deg >= 95 && deg < 175) seasonName = '여름 (북반구)';
  else if (deg >= 175 && deg < 185) seasonName = '추분 부근';
  else if (deg >= 185 && deg < 265) seasonName = '가을 (북반구)';
  else if (deg >= 265 && deg < 275) seasonName = '동지 부근';
  else seasonName = '겨울 (북반구)';

  const solarDeclinationDeg =
    23.439 * Math.sin(orbital.earthOrbitAngle);

  const pDeg = orbital.lunarPhaseAngleDeg;
  const phaseRad = THREE.MathUtils.degToRad(pDeg);
  const lunarIlluminationPct = ((1 - Math.cos(phaseRad)) / 2) * 100;
  const lunarDay = (pDeg / 360) * ASTRO_CONSTANTS.MOON_SYNODIC_DAYS;

  let lunarPhaseName = '삭 (신월)';
  if (pDeg < 12 || pDeg >= 348) lunarPhaseName = '삭 (신월)';
  else if (pDeg < 78) lunarPhaseName = '초승달';
  else if (pDeg < 102) lunarPhaseName = '상현달';
  else if (pDeg < 168) lunarPhaseName = '상현망간달';
  else if (pDeg < 192) lunarPhaseName = '보름달 (망)';
  else if (pDeg < 258) lunarPhaseName = '하현망간달';
  else if (pDeg < 282) lunarPhaseName = '하현달';
  else lunarPhaseName = '그믐달';

  const earthDistanceAU =
    orbital.earthRelPos.length() / ASTRO_CONSTANTS.EARTH_ORBIT_A;

  let eclipseLabel = '정상 공전';
  if (orbital.eclipseState === 'solar-total') eclipseLabel = '개기일식 정렬';
  else if (orbital.eclipseState === 'solar-partial') eclipseLabel = '부분일식 정렬';
  else if (orbital.eclipseState === 'lunar-total') eclipseLabel = '개기월식 (블러드문)';
  else if (orbital.eclipseState === 'lunar-partial') eclipseLabel = '부분월식 정렬';

  return {
    simDays,
    dateLabel,
    seasonName,
    solarDeclinationDeg,
    lunarPhaseName,
    lunarPhaseAngleDeg: pDeg,
    lunarIlluminationPct,
    lunarDay,
    earthDistanceAU,
    sunGalacticSpeedKmS: motionFrame === 'galactic' ? 230 : 0,
    eclipseState: orbital.eclipseState,
    eclipseLabel,
  };
}
