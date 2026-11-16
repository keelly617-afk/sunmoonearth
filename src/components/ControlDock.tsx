import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  StepBack,
  StepForward,
  X,
} from 'lucide-react';
import {
  ASTRONOMICAL_PRESETS,
  CAMERA_PRESETS,
  CELESTIAL_BODY_INFO,
  SPEED_PRESETS,
} from '../types/astronomy';
import type {
  CameraTarget,
  CelestialBodyId,
  MotionReferenceFrame,
  PresetEventId,
  TelemetryState,
  VisualToggles,
} from '../types/astronomy';

interface ControlDockProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  daysPerSec: number;
  onChangeSpeed: (daysPerSec: number) => void;
  motionFrame: MotionReferenceFrame;
  onChangeMotionFrame: (frame: MotionReferenceFrame) => void;
  onStepDays: (deltaDays: number) => void;
  onReset: () => void;
  cameraTarget: CameraTarget;
  onChangeCameraTarget: (target: CameraTarget) => void;
  activePreset: PresetEventId | null;
  onSelectPreset: (preset: PresetEventId) => void;
  toggles: VisualToggles;
  onChangeToggles: (next: VisualToggles) => void;
  selectedBody: CelestialBodyId | null;
  onSelectBody: (body: CelestialBodyId | null) => void;
  telemetry: TelemetryState;
  onScrubYearFraction: (dayInYear: number) => void;
}

export const ControlDock: React.FC<ControlDockProps> = ({
  isCollapsed,
  onToggleCollapse,
  isPlaying,
  onTogglePlay,
  daysPerSec,
  onChangeSpeed,
  motionFrame,
  onChangeMotionFrame,
  onStepDays,
  onReset,
  cameraTarget,
  onChangeCameraTarget,
  activePreset,
  onSelectPreset,
  toggles,
  onChangeToggles,
  selectedBody,
  onSelectBody,
  telemetry,
  onScrubYearFraction,
}) => {
  const bodyFact = selectedBody ? CELESTIAL_BODY_INFO[selectedBody] : null;
  const normalizedYearDay = ((telemetry.simDays % 365.25636) + 365.25636) % 365.25636;

  return (
    <div
      className="fixed bottom-4 left-1/2 z-20 w-[min(1000px,96vw)] -translate-x-1/2 pointer-events-none transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{
        transform: isCollapsed
          ? 'translate(-50%, calc(100% - 36px))'
          : 'translate(-50%, 0)',
      }}
    >
      {/* Top Collapse / Expand Tab */}
      <div className="flex justify-center mb-1.5 pointer-events-auto">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!isCollapsed}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-200 bg-[#0b101d]/95 border border-white/15 rounded-t-lg hover:bg-[#131b2e] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {isCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-sky-400" />
              <span>컨트롤 열기</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              <span>컨트롤 숨기기</span>
            </>
          )}
          <span className="text-[11px] font-mono-tabular text-slate-400 ml-1">H</span>
        </button>
      </div>

      {/* Main Dock Container */}
      <div className="pointer-events-auto bg-[#0a0f1c]/95 border border-white/12 rounded-xl shadow-2xl overflow-hidden">
        {/* Optional Selected Celestial Body Inspector Strip */}
        {bodyFact && (
          <div className="px-4 py-3 bg-[#0f1628] border-b border-white/10">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: bodyFact.accentHex }}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold text-white">
                    {bodyFact.nameKo}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{bodyFact.nameEn}</span>
                  <span aria-hidden="true">·</span>
                  <span>{bodyFact.category}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  {bodyFact.summary}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSelectBody(null)}
                aria-label="천체 정보 닫기"
                className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-white/8 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-white/8">
              {bodyFact.metrics.map((m) => (
                <div key={m.label}>
                  <div className="text-[11px] text-slate-400">{m.label}</div>
                  <div className="text-xs font-mono-tabular font-medium text-slate-100 mt-0.5">
                    {m.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Controls Body */}
        <div className="p-3 sm:px-4 sm:py-3 space-y-2.5">
          {/* Row 1: Playback, Step, Motion Frame Mode, Speed Multipliers */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onTogglePlay}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span>일시정지</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>재생</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => onStepDays(-1)}
                title="1일 뒤로"
                aria-label="1일 뒤로 이동"
                className="inline-flex items-center justify-center h-9 px-2.5 text-xs font-mono-tabular text-slate-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <StepBack className="w-3.5 h-3.5 mr-1" />
                <span>-1일</span>
              </button>

              <button
                type="button"
                onClick={() => onStepDays(1)}
                title="1일 앞으로"
                aria-label="1일 앞으로 이동"
                className="inline-flex items-center justify-center h-9 px-2.5 text-xs font-mono-tabular text-slate-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>+1일</span>
                <StepForward className="w-3.5 h-3.5 ml-1" />
              </button>

              <button
                type="button"
                onClick={onReset}
                title="초기 상태로 되돌리기"
                aria-label="시뮬레이션 초기화"
                className="inline-flex items-center justify-center h-9 px-2.5 text-xs text-slate-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Sun Motion Frame Toggle (Galactic Revolution vs Heliocentric Fixed) */}
            <div
              role="group"
              aria-label="태양 공전 기준계 선택"
              className="flex items-center gap-0.5 p-1 bg-[#060913] border border-white/10 rounded-lg shrink-0"
            >
              <button
                type="button"
                onClick={() => onChangeMotionFrame('galactic')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  motionFrame === 'galactic'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                은하 공전 (태양 이동)
              </button>
              <button
                type="button"
                onClick={() => onChangeMotionFrame('heliocentric')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  motionFrame === 'heliocentric'
                    ? 'bg-white/12 text-white border border-white/25'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                태양 고정 (태양계 기준)
              </button>
            </div>

            {/* Annual Orbital Position Scrubber */}
            <div className="flex items-center gap-2 flex-1 min-w-[150px] max-w-[220px] px-1">
              <label
                htmlFor="orbit-year-scrubber"
                className="text-[11px] text-slate-400 whitespace-nowrap shrink-0"
              >
                공전각
              </label>
              <input
                id="orbit-year-scrubber"
                type="range"
                min={0}
                max={365}
                step={0.5}
                value={normalizedYearDay}
                onChange={(e) => onScrubYearFraction(Number(e.target.value))}
                className="astro-slider w-full"
                aria-label="연중 공전 위치 조절"
              />
              <span className="text-[11px] font-mono-tabular text-slate-300 w-9 text-right shrink-0">
                {Math.round((normalizedYearDay / 365.25) * 360)}°
              </span>
            </div>

            {/* Speed Segmented Selector */}
            <div
              role="group"
              aria-label="시간 배속 선택"
              className="flex items-center gap-0.5 p-1 bg-[#060913] border border-white/10 rounded-lg overflow-x-auto"
            >
              {SPEED_PRESETS.map((sp) => {
                const active = daysPerSec === sp.daysPerSec;
                return (
                  <button
                    key={sp.daysPerSec}
                    type="button"
                    onClick={() => onChangeSpeed(sp.daysPerSec)}
                    className={`px-2 py-1 text-[11px] font-mono-tabular rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                      active
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    {sp.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-px bg-white/8" />

          {/* Row 2: Camera Focus, Astronomical Presets, Visual Aids */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Camera Viewpoint Switcher */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 mr-0.5 whitespace-nowrap shrink-0">
                <Eye className="w-3.5 h-3.5 text-slate-400" />
                <span>시점</span>
              </span>
              <div
                role="group"
                aria-label="카메라 시점 선택"
                className="flex items-center gap-1 flex-wrap"
              >
                {CAMERA_PRESETS.map((cam) => {
                  const active = cameraTarget === cam.id;
                  return (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() => onChangeCameraTarget(cam.id)}
                      className={`h-8 px-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                        active
                          ? 'bg-white/15 text-white border border-white/25'
                          : 'bg-white/4 text-slate-300 border border-white/8 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {cam.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Phenomenon Presets (Seasons & Eclipses) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 mr-0.5 whitespace-nowrap shrink-0">
                <Orbit className="w-3.5 h-3.5 text-amber-400" />
                <span>현상</span>
              </span>
              <div
                role="group"
                aria-label="절기 및 일식 월식 프리셋"
                className="flex items-center gap-1 flex-wrap"
              >
                {ASTRONOMICAL_PRESETS.map((preset) => {
                  const active = activePreset === preset.id;
                  const isEclipse =
                    preset.id === 'solar-eclipse' || preset.id === 'lunar-eclipse';
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onSelectPreset(preset.id)}
                      className={`h-8 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                        active
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-400/45'
                          : isEclipse
                            ? 'bg-amber-500/8 text-amber-200/90 border border-amber-500/20 hover:bg-amber-500/18 hover:text-amber-200'
                            : 'bg-white/4 text-slate-300 border border-white/8 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Visual Guide Toggles */}
            <div
              role="group"
              aria-label="시각 보조선 설정"
              className="flex items-center gap-1 flex-wrap"
            >
              {(
                [
                  { key: 'showTrails', label: '나선 궤적' },
                  { key: 'showOrbits', label: '궤도선' },
                  { key: 'showAxes', label: '자전축' },
                  { key: 'showLabels', label: '명칭' },
                  { key: 'showShadowCones', label: '그림자' },
                ] as const
              ).map((item) => {
                const enabled = toggles[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={enabled}
                    onClick={() =>
                      onChangeToggles({
                        ...toggles,
                        [item.key]: !enabled,
                      })
                    }
                    className={`h-8 px-2 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                      enabled
                        ? 'bg-sky-500/15 text-sky-300 border border-sky-400/35'
                        : 'bg-white/4 text-slate-400 border border-white/8 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
