export type CameraTarget = 'overview' | 'earth' | 'moon' | 'sun' | 'top' | 'fixed';

export type CelestialBodyId = 'sun' | 'earth' | 'moon';

export type MotionReferenceFrame = 'galactic' | 'heliocentric';

export type PresetEventId =
  | 'vernal'
  | 'summer'
  | 'autumn'
  | 'winter'
  | 'solar-eclipse'
  | 'lunar-eclipse';

export interface VisualToggles {
  showOrbits: boolean;
  showAxes: boolean;
  showLabels: boolean;
  showShadowCones: boolean;
  showTrails: boolean;
}

export interface TelemetryState {
  simDays: number;
  dateLabel: string;
  seasonName: string;
  solarDeclinationDeg: number;
  lunarPhaseName: string;
  lunarPhaseAngleDeg: number; // 0 = New Moon, 90 = First Quarter, 180 = Full Moon, 270 = Last Quarter
  lunarIlluminationPct: number;
  lunarDay: number; // 0..29.53
  earthDistanceAU: number;
  sunGalacticSpeedKmS: number;
  eclipseState: 'none' | 'solar-total' | 'solar-partial' | 'lunar-total' | 'lunar-partial';
  eclipseLabel: string;
}

export interface CelestialBodyFact {
  id: CelestialBodyId;
  nameKo: string;
  nameEn: string;
  category: string;
  accentHex: string;
  summary: string;
  metrics: Array<{ label: string; value: string }>;
}

export const CELESTIAL_BODY_INFO: Record<CelestialBodyId, CelestialBodyFact> = {
  sun: {
    id: 'sun',
    nameKo: '태양',
    nameEn: 'Sun · G2V',
    category: '항성',
    accentHex: '#F59E0B',
    summary:
      '태양계 질량의 99.86%를 차지하며, 자전과 함께 우리은하 중심 주위를 초속 약 230km로 공전합니다. 은하 공전 모드에서는 지구와 달이 태양을 따라 나선형 궤적을 그리며 나아갑니다.',
    metrics: [
      { label: '적도 지름', value: '1,392,700 km (지구 ×109)' },
      { label: '은하 공전 속도', value: '약 230 km/s (약 2.3억 년)' },
      { label: '자전 주기', value: '25.05일 (적도)' },
      { label: '표면 온도', value: '5,778 K' },
    ],
  },
  earth: {
    id: 'earth',
    nameKo: '지구',
    nameEn: 'Earth',
    category: '지구형 행성',
    accentHex: '#38BDF8',
    summary:
      '자전축이 공전 궤도면에 대해 23.44° 기울어진 채 태양 주위를 공전하며, 이 기울기 때문에 사계절과 낮·밤 길이 변화가 생깁니다.',
    metrics: [
      { label: '적도 지름', value: '12,756 km' },
      { label: '자전 주기', value: '23시간 56분 4초' },
      { label: '공전 주기', value: '365.256일 (1년)' },
      { label: '자전축 기울기', value: '23.44°' },
    ],
  },
  moon: {
    id: 'moon',
    nameKo: '달',
    nameEn: 'Moon',
    category: '자연 위성',
    accentHex: '#CBD5E1',
    summary:
      '지구의 공전 궤도면(황도면)에 대해 약 5.14° 기울어진 궤도로 돌며, 자전 주기와 공전 주기가 같아 항상 같은 면만 지구를 향합니다.',
    metrics: [
      { label: '지름', value: '3,474 km (지구 ×0.27)' },
      { label: '삭망월 주기', value: '29.53일' },
      { label: '궤도 경사각', value: '5.145°' },
      { label: '지구까지 거리', value: '평균 384,400 km' },
    ],
  },
};

export const SPEED_PRESETS: Array<{ label: string; daysPerSec: number }> = [
  { label: '0.2일/초', daysPerSec: 0.2 },
  { label: '1일/초', daysPerSec: 1 },
  { label: '5일/초', daysPerSec: 5 },
  { label: '15일/초', daysPerSec: 15 },
  { label: '30일/초', daysPerSec: 30 },
];

export const CAMERA_PRESETS: Array<{ id: CameraTarget; label: string }> = [
  { id: 'overview', label: '전체 궤도' },
  { id: 'earth', label: '지구 중심' },
  { id: 'moon', label: '달 중심' },
  { id: 'sun', label: '태양 중심' },
  { id: 'top', label: '황도 북극' },
  { id: 'fixed', label: '우주 고정' },
];

export const ASTRONOMICAL_PRESETS: Array<{ id: PresetEventId; label: string }> = [
  { id: 'vernal', label: '춘분' },
  { id: 'summer', label: '하지' },
  { id: 'autumn', label: '추분' },
  { id: 'winter', label: '동지' },
  { id: 'solar-eclipse', label: '개기일식' },
  { id: 'lunar-eclipse', label: '개기월식' },
];
