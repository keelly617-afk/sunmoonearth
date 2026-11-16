import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildTelemetryState,
  computeOrbitalPositions,
  getPresetSimDays,
} from './astronomy/orbitalMechanics';
import { ControlDock } from './components/ControlDock';
import { LunarPhaseIcon } from './components/LunarPhaseIcon';
import { CelestialScene } from './three/CelestialScene';
import type {
  CameraTarget,
  CelestialBodyId,
  MotionReferenceFrame,
  PresetEventId,
  TelemetryState,
  VisualToggles,
} from './types/astronomy';

const INITIAL_ORBITAL = computeOrbitalPositions(0, 'galactic');
const INITIAL_TELEMETRY = buildTelemetryState(0, INITIAL_ORBITAL, 'galactic');

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CelestialScene | null>(null);
  const motionFrameRef = useRef<MotionReferenceFrame>('galactic');

  const sunLabelRef = useRef<HTMLDivElement | null>(null);
  const earthLabelRef = useRef<HTMLDivElement | null>(null);
  const moonLabelRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [daysPerSec, setDaysPerSec] = useState(5);
  const [motionFrame, setMotionFrame] = useState<MotionReferenceFrame>('galactic');
  const [cameraTarget, setCameraTarget] = useState<CameraTarget>('overview');
  const [activePreset, setActivePreset] = useState<PresetEventId | null>(null);
  const [selectedBody, setSelectedBody] = useState<CelestialBodyId | null>(null);
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const [webglLost, setWebglLost] = useState(false);
  const [toggles, setToggles] = useState<VisualToggles>({
    showOrbits: true,
    showAxes: true,
    showLabels: true,
    showShadowCones: true,
    showTrails: true,
  });
  const [telemetry, setTelemetry] = useState<TelemetryState>(INITIAL_TELEMETRY);

  // Mount Three.js scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new CelestialScene(
      container,
      {
        sun: sunLabelRef.current,
        earth: earthLabelRef.current,
        moon: moonLabelRef.current,
      },
      {
        onTelemetryTick: (simDays, orbital) => {
          setTelemetry(buildTelemetryState(simDays, orbital, motionFrameRef.current));
        },
        onSelectBody: (body) => {
          setSelectedBody(body);
          if (body) setCameraTarget(body);
        },
        onWebGLContextChange: (lost) => {
          setWebglLost(lost);
        },
      }
    );

    sceneRef.current = scene;

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Sync playback settings imperatively
  useEffect(() => {
    sceneRef.current?.setPlayback(isPlaying, daysPerSec);
  }, [isPlaying, daysPerSec]);

  // Sync motion frame imperatively
  useEffect(() => {
    motionFrameRef.current = motionFrame;
    sceneRef.current?.setMotionFrame(motionFrame);
  }, [motionFrame]);

  // Sync visual toggles imperatively
  useEffect(() => {
    sceneRef.current?.setToggles(toggles);
  }, [toggles]);

  const handleCameraChange = useCallback((target: CameraTarget) => {
    setCameraTarget(target);
    sceneRef.current?.setCameraTarget(target);
  }, []);

  const handleSelectPreset = useCallback((preset: PresetEventId) => {
    const targetDays = getPresetSimDays(preset);
    setActivePreset(preset);
    sceneRef.current?.setSimDays(targetDays);

    if (preset === 'solar-eclipse') {
      setIsPlaying(false);
      setToggles((prev) => ({ ...prev, showShadowCones: true }));
      setCameraTarget('earth');
      sceneRef.current?.focusEclipseView('solar');
    } else if (preset === 'lunar-eclipse') {
      setIsPlaying(false);
      setToggles((prev) => ({ ...prev, showShadowCones: true }));
      setCameraTarget('earth');
      sceneRef.current?.focusEclipseView('lunar');
    } else {
      setIsPlaying(true);
      setDaysPerSec(0.2);
      setCameraTarget('earth');
      sceneRef.current?.setCameraTarget('earth');
    }
  }, []);

  const handleStepDays = useCallback((deltaDays: number) => {
    setIsPlaying(false);
    setActivePreset(null);
    const nextDays = telemetry.simDays + deltaDays;
    sceneRef.current?.setSimDays(nextDays);
  }, [telemetry.simDays]);

  const handleScrubYearFraction = useCallback((dayInYear: number) => {
    setIsPlaying(false);
    setActivePreset(null);
    const currentYearIdx = Math.floor(telemetry.simDays / 365.25636);
    const nextDays = currentYearIdx * 365.25636 + dayInYear;
    sceneRef.current?.setSimDays(nextDays);
  }, [telemetry.simDays]);

  const handleReset = useCallback(() => {
    setIsPlaying(true);
    setDaysPerSec(5);
    setMotionFrame('galactic');
    setActivePreset(null);
    setSelectedBody(null);
    setCameraTarget('overview');
    sceneRef.current?.setSimDays(0);
    sceneRef.current?.setCameraTarget('overview');
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === 'h' || e.key === 'H') {
        setIsDockCollapsed((c) => !c);
      } else if (e.key === 'r' || e.key === 'R') {
        handleReset();
      } else if (e.key === '1') {
        handleCameraChange('overview');
      } else if (e.key === '2') {
        handleCameraChange('earth');
      } else if (e.key === '3') {
        handleCameraChange('moon');
      } else if (e.key === '4') {
        handleCameraChange('sun');
      } else if (e.key === '5') {
        handleCameraChange('top');
      } else if (e.key === '6') {
        handleCameraChange('fixed');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleCameraChange, handleReset]);

  const declinationPrefix = telemetry.solarDeclinationDeg >= 0 ? '+' : '';
  const isEclipseActive = telemetry.eclipseState !== 'none';

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#050811] select-none">
      {/* Dedicated WebGL Mount Container */}
      <div
        ref={mountRef}
        className="fixed inset-0 z-0 cursor-grab active:cursor-grabbing"
        aria-label="태양, 지구, 달 3D 궤도 시뮬레이션 뷰포트"
      />

      {/* Projected 3D Body Labels */}
      <div className="fixed inset-0 z-10 pointer-events-none overflow-hidden">
        <div
          ref={sunLabelRef}
          style={{ opacity: 0 }}
          className="absolute top-0 left-0 px-2 py-0.5 text-[11px] font-medium text-amber-200 bg-[#070b15]/88 border border-amber-400/30 rounded whitespace-nowrap"
        >
          태양
        </div>
        <div
          ref={earthLabelRef}
          style={{ opacity: 0 }}
          className="absolute top-0 left-0 px-2 py-0.5 text-[11px] font-medium text-sky-200 bg-[#070b15]/88 border border-sky-400/30 rounded whitespace-nowrap"
        >
          지구
        </div>
        <div
          ref={moonLabelRef}
          style={{ opacity: 0 }}
          className="absolute top-0 left-0 px-2 py-0.5 text-[11px] font-medium text-slate-200 bg-[#070b15]/88 border border-slate-400/30 rounded whitespace-nowrap"
        >
          달
        </div>
      </div>

      {/* Top HUD Bar */}
      <header className="fixed top-3.5 left-4 right-4 z-20 flex flex-wrap items-start justify-between gap-4 pointer-events-none">
        {/* Top-Left Title & Interaction Metadata */}
        <div className="pointer-events-auto">
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap">
            태양 · 지구 · 달 궤도 시뮬레이션
          </h1>
          <p className="hidden md:flex items-center gap-2 mt-0.5 text-xs text-slate-400 whitespace-nowrap">
            <span>드래그 회전</span>
            <span aria-hidden="true">·</span>
            <span>휠 확대/축소</span>
            <span aria-hidden="true">·</span>
            <span>천체 클릭 상세보기</span>
          </p>
        </div>

        {/* Top-Right Live Astronomical Telemetry Strip */}
        <div className="pointer-events-auto bg-[#0a0f1c]/92 border border-white/12 rounded-xl px-3.5 py-2 flex items-center gap-3.5 sm:gap-4 shadow-lg">
          {/* Date & Season */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-mono-tabular text-slate-400 whitespace-nowrap">
              <span>{telemetry.dateLabel}</span>
              <span aria-hidden="true">·</span>
              <span>경과 {telemetry.simDays.toFixed(1)}일</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 whitespace-nowrap">
              <span className="text-xs sm:text-sm font-semibold text-white">
                {telemetry.seasonName}
              </span>
              <span className="hidden sm:inline text-[11px] font-mono-tabular text-slate-400">
                적위 {declinationPrefix}
                {telemetry.solarDeclinationDeg.toFixed(1)}°
              </span>
            </div>
          </div>

          <div className="w-px h-7 bg-white/10 shrink-0" aria-hidden="true" />

          {/* Lunar Phase Live Indicator */}
          <div className="flex items-center gap-2.5 shrink-0">
            <LunarPhaseIcon
              phaseAngleDeg={telemetry.lunarPhaseAngleDeg}
              eclipseState={telemetry.eclipseState}
              size={26}
            />
            <div>
              <div className="text-xs sm:text-sm font-semibold text-white whitespace-nowrap">
                {telemetry.lunarPhaseName}
              </div>
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono-tabular text-slate-400 whitespace-nowrap">
                <span>조도 {telemetry.lunarIlluminationPct.toFixed(0)}%</span>
                <span aria-hidden="true">·</span>
                <span>월령 {telemetry.lunarDay.toFixed(1)}일</span>
              </div>
            </div>
          </div>

          <div className="hidden md:block w-px h-7 bg-white/10 shrink-0" aria-hidden="true" />

          {/* Sun Galactic Orbit & Eclipse Status */}
          <div className="hidden md:block shrink-0">
            <div className="text-[11px] font-mono-tabular text-slate-400 whitespace-nowrap">
              태양 은하 공전{' '}
              <span className="text-amber-300">
                {telemetry.sunGalacticSpeedKmS > 0
                  ? `${telemetry.sunGalacticSpeedKmS} km/s`
                  : '고정'}
              </span>
            </div>
            <div
              className={`text-xs font-medium mt-0.5 whitespace-nowrap ${
                isEclipseActive ? 'text-amber-300' : 'text-slate-200'
              }`}
            >
              {isEclipseActive ? `▲ ${telemetry.eclipseLabel}` : telemetry.eclipseLabel}
            </div>
          </div>
        </div>
      </header>

      {/* WebGL Context Lost Fallback */}
      {webglLost && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#050811]/95 p-6">
          <div className="max-w-md w-full bg-[#0b101d] border border-white/15 rounded-xl p-6 text-center">
            <h2 className="text-base font-semibold text-white">
              3D 그래픽 컨텍스트가 일시 중단되었습니다
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              브라우저 GPU 리소스가 재설정되었습니다. 페이지를 새로고침하면 시뮬레이션이 다시 시작됩니다.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 transition-colors cursor-pointer"
            >
              새로고침
            </button>
          </div>
        </div>
      )}

      {/* Collapsible Bottom Control Dock */}
      <ControlDock
        isCollapsed={isDockCollapsed}
        onToggleCollapse={() => setIsDockCollapsed((c) => !c)}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        daysPerSec={daysPerSec}
        onChangeSpeed={(s) => {
          setDaysPerSec(s);
          setIsPlaying(true);
        }}
        motionFrame={motionFrame}
        onChangeMotionFrame={setMotionFrame}
        onStepDays={handleStepDays}
        onReset={handleReset}
        cameraTarget={cameraTarget}
        onChangeCameraTarget={handleCameraChange}
        activePreset={activePreset}
        onSelectPreset={handleSelectPreset}
        toggles={toggles}
        onChangeToggles={setToggles}
        selectedBody={selectedBody}
        onSelectBody={setSelectedBody}
        telemetry={telemetry}
        onScrubYearFraction={handleScrubYearFraction}
      />
    </div>
  );
}
