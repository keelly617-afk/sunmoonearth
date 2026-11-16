import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ASTRO_CONSTANTS,
  computeOrbitalPositions,
  computeSunGalacticPosition,
  OrbitalPositions,
} from '../astronomy/orbitalMechanics';
import {
  CameraTarget,
  CelestialBodyId,
  MotionReferenceFrame,
  VisualToggles,
} from '../types/astronomy';
import {
  createEarthTextures,
  createMoonTextures,
  createStarSpriteTexture,
  createSunTexture,
} from './proceduralTextures';

// Module-scope reusable math temporaries (Zero GC inside render loop)
const _vSun = new THREE.Vector3();
const _vEarthRel = new THREE.Vector3();
const _vEarth = new THREE.Vector3();
const _vMoonLocal = new THREE.Vector3();
const _vMoonWorld = new THREE.Vector3();

const _tSun = new THREE.Vector3();
const _tEarthRel = new THREE.Vector3();
const _tEarth = new THREE.Vector3();
const _tMoonL = new THREE.Vector3();
const _tMoonW = new THREE.Vector3();

const _vPrevTarget = new THREE.Vector3();
const _vCurrTarget = new THREE.Vector3();
const _vDelta = new THREE.Vector3();
const _vDesiredTarget = new THREE.Vector3();
const _vDesiredCamPos = new THREE.Vector3();
const _vSunToEarth = new THREE.Vector3();
const _vSunToMoon = new THREE.Vector3();
const _vEarthToSun = new THREE.Vector3();
const _vProject = new THREE.Vector3();
const _vLabelWorld = new THREE.Vector3();
const _vCamOffset = new THREE.Vector3();
const _qAlign = new THREE.Quaternion();
const _vUpAxis = new THREE.Vector3(0, 1, 0);

const TRAIL_POINTS = 320;
const TRAIL_SPAN_DAYS = 520; // ~1.42 Earth years of visible helical wake

export interface CelestialSceneCallbacks {
  onTelemetryTick: (simDays: number, orbital: OrbitalPositions) => void;
  onSelectBody: (body: CelestialBodyId | null) => void;
  onWebGLContextChange: (lost: boolean) => void;
}

export interface LabelDOMRefs {
  sun: HTMLDivElement | null;
  earth: HTMLDivElement | null;
  moon: HTMLDivElement | null;
}

export class CelestialScene {
  private container: HTMLElement;
  private callbacks: CelestialSceneCallbacks;
  private labelRefs: LabelDOMRefs;
  private isSoftwareGl: boolean;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();

  // Simulation playback state (mutated imperatively from React without remounting WebGL)
  private simDays = 0;
  private isPlaying = true;
  private daysPerSec = 5;
  private motionFrame: MotionReferenceFrame = 'galactic';
  private cameraTarget: CameraTarget = 'overview';
  private isCameraTransitioning = false;
  private toggles: VisualToggles = {
    showOrbits: true,
    showAxes: true,
    showLabels: true,
    showShadowCones: true,
    showTrails: true,
  };

  // Celestial assemblies
  private sunGroup = new THREE.Group();
  private sunTiltFrame = new THREE.Group();
  private sunShaderMat!: THREE.ShaderMaterial;
  private sunGuideGroup = new THREE.Group();

  private earthSystemGroup = new THREE.Group(); // Positioned at Earth's world coord
  private earthTiltFrame = new THREE.Group(); // Tilted 23.44 deg around X
  private earthMesh!: THREE.Mesh;
  private earthMat!: THREE.MeshStandardMaterial;
  private earthCloudMesh!: THREE.Mesh;
  private earthAtmosMat!: THREE.ShaderMaterial;
  private earthAxisGroup = new THREE.Group();
  private earthOrbitLine!: THREE.LineLoop;
  private earthShadowCone!: THREE.Mesh;

  private moonOrbitTiltGroup = new THREE.Group();
  private moonMesh!: THREE.Mesh;
  private moonMat!: THREE.MeshStandardMaterial;
  private moonAxisGroup = new THREE.Group();
  private moonOrbitLine!: THREE.LineLoop;
  private moonEclipticRefLine!: THREE.LineLoop;
  private moonNodesGroup = new THREE.Group();
  private moonShadowCone!: THREE.Mesh;

  // Galactic orbit & helical wake trails
  private sunGalacticOrbitLine!: THREE.LineLoop;
  private sunTrailLine!: THREE.Line;
  private earthTrailLine!: THREE.Line;
  private moonTrailLine!: THREE.Line;
  private sunTrailPositions = new Float32Array(TRAIL_POINTS * 3);
  private earthTrailPositions = new Float32Array(TRAIL_POINTS * 3);
  private moonTrailPositions = new Float32Array(TRAIL_POINTS * 3);
  private lastTrailSimDays = -99999;
  private forceTrailRebuild = true;

  private eclipticGrid!: THREE.PolarGridHelper;
  private sunDirLight!: THREE.DirectionalLight;
  private sunPointLight!: THREE.PointLight;

  // Raycasting
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = new THREE.Vector2();
  private clickableMeshes: THREE.Object3D[] = [];

  // Animation / pacing handles
  private frameId = 0;
  private disposed = false;
  private lastUiEmitTime = 0;
  private hasInitialTarget = false;
  private disposables: Array<{ dispose: () => void }> = [];

  private boundOnResize: () => void;
  private boundOnPointerDown: (e: PointerEvent) => void;
  private boundOnPointerUp: (e: PointerEvent) => void;
  private boundOnContextLost: (e: Event) => void;
  private boundOnContextRestored: () => void;

  constructor(
    container: HTMLElement,
    labelRefs: LabelDOMRefs,
    callbacks: CelestialSceneCallbacks
  ) {
    this.container = container;
    this.labelRefs = labelRefs;
    this.callbacks = callbacks;

    this.isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050811);
    this.scene.fog = new THREE.FogExp2(0x050811, 0.0011);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.scene.environmentIntensity = 0.05;
    pmremGenerator.dispose();
    this.disposables.push(envTex);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 800);
    this.camera.position.set(24, 24, 52);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1.65;
    this.controls.maxDistance = 260;
    this.controls.enablePan = true;

    this.controls.addEventListener('start', () => {
      this.isCameraTransitioning = false;
    });

    this.buildLighting();
    this.buildStarfield();
    this.buildSunAssembly();
    this.buildEarthAndMoonSystem();
    this.buildOrbitPaths();
    this.buildGalacticTrails();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.boundOnResize = this.handleResize.bind(this);
    this.boundOnPointerDown = this.handlePointerDown.bind(this);
    this.boundOnPointerUp = this.handlePointerUp.bind(this);
    this.boundOnContextLost = (e: Event) => {
      e.preventDefault();
      this.callbacks.onWebGLContextChange(true);
    };
    this.boundOnContextRestored = () => {
      this.callbacks.onWebGLContextChange(false);
    };

    window.addEventListener('resize', this.boundOnResize);
    this.renderer.domElement.addEventListener('pointerdown', this.boundOnPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.boundOnPointerUp);
    this.renderer.domElement.addEventListener('webglcontextlost', this.boundOnContextLost);
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      this.boundOnContextRestored
    );

    const initialOrbital = computeOrbitalPositions(
      this.simDays,
      this.motionFrame,
      _vSun,
      _vEarthRel,
      _vEarth,
      _vMoonLocal,
      _vMoonWorld
    );
    this.applyOrbitalPositions(initialOrbital, 0);
    this.updateTrails(true);
    this.callbacks.onTelemetryTick(this.simDays, initialOrbital);
    this.applyCameraTargetImmediate('overview');

    this.clock.start();
    this.tick();
  }

  private buildLighting(): void {
    const hemi = new THREE.HemisphereLight(0x3a64a8, 0x070a12, 0.16);
    this.scene.add(hemi);

    this.sunPointLight = new THREE.PointLight(0xffeed4, 0.6, 120, 0.3);
    this.sunPointLight.position.set(0, 0, 0);
    this.scene.add(this.sunPointLight);

    this.sunDirLight = new THREE.DirectionalLight(0xfff8eb, 3.1);
    this.sunDirLight.castShadow = !this.isSoftwareGl;
    this.sunDirLight.shadow.mapSize.set(2048, 2048);
    const d = 7.2;
    this.sunDirLight.shadow.camera.left = -d;
    this.sunDirLight.shadow.camera.right = d;
    this.sunDirLight.shadow.camera.top = d;
    this.sunDirLight.shadow.camera.bottom = -d;
    this.sunDirLight.shadow.camera.near = 1;
    this.sunDirLight.shadow.camera.far = 36;
    this.sunDirLight.shadow.bias = -0.0004;
    this.sunDirLight.shadow.normalBias = 0.018;
    this.scene.add(this.sunDirLight);
    this.scene.add(this.sunDirLight.target);
  }

  private buildStarfield(): void {
    // Deep background stars + nearby interstellar parallax field surrounding the galactic loop
    const starCount = 3400;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    const cBlue = new THREE.Color(0x9ec5ff);
    const cWhite = new THREE.Color(0xf8fafc);
    const cWarm = new THREE.Color(0xffd7a8);
    const cTemp = new THREE.Color();

    // Center the star distribution around the galactic loop center (0, 0, -110)
    for (let i = 0; i < starCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      // 30% closer parallax stars (r=75..220), 70% deep backdrop stars (r=230..440)
      const isParallax = i < starCount * 0.3;
      const r = isParallax ? 75 + Math.random() * 145 : 230 + Math.random() * 210;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = -110 + r * Math.sin(phi) * Math.sin(theta);

      const spec = Math.random();
      if (spec < 0.28) cTemp.copy(cBlue);
      else if (spec < 0.78) cTemp.copy(cWhite);
      else cTemp.copy(cWarm);

      const brightness = (isParallax ? 0.35 : 0.48) + Math.pow(Math.random(), 2) * 0.55;
      colors[i * 3] = cTemp.r * brightness;
      colors[i * 3 + 1] = cTemp.g * brightness;
      colors[i * 3 + 2] = cTemp.b * brightness;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const spriteTex = createStarSpriteTexture();
    const starMat = new THREE.PointsMaterial({
      size: 1.25,
      map: spriteTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const stars = new THREE.Points(starGeo, starMat);
    this.scene.add(stars);
    this.disposables.push(starGeo, starMat, spriteTex);

    this.eclipticGrid = new THREE.PolarGridHelper(38, 12, 6, 96, 0x1e293b, 0x111a2e);
    this.eclipticGrid.position.y = -0.02;
    const gridMat = this.eclipticGrid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.36;
    gridMat.depthWrite = false;
    this.scene.add(this.eclipticGrid);
    this.disposables.push(this.eclipticGrid.geometry, gridMat);
  }

  private buildSunAssembly(): void {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const sunTex = createSunTexture(maxAniso);
    this.disposables.push(sunTex);

    this.sunTiltFrame.rotation.z = ASTRO_CONSTANTS.SUN_AXIAL_TILT_RAD;
    this.sunGroup.add(this.sunTiltFrame);

    const sunGeo = new THREE.SphereGeometry(ASTRO_CONSTANTS.SUN_RADIUS, 64, 48);
    this.sunShaderMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: sunTex },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vec2 uvA = vec2(vUv.x + uTime * 0.008, vUv.y);
          vec2 uvB = vec2(vUv.x - uTime * 0.005, vUv.y + sin(vUv.x * 6.2831 + uTime * 0.25) * 0.015);
          vec3 colA = texture2D(uMap, uvA).rgb;
          vec3 colB = texture2D(uMap, uvB).rgb;
          vec3 plasma = mix(colA, colB, 0.45);

          vec3 viewDir = normalize(vViewPos);
          float ndv = clamp(dot(normalize(vNormal), viewDir), 0.0, 1.0);
          float limb = pow(ndv, 0.45);
          vec3 coreCol = plasma * (0.85 + 0.55 * limb);
          vec3 rimGlow = vec3(1.0, 0.52, 0.12) * pow(1.0 - ndv, 2.6) * 0.9;
          gl_FragColor = vec4(coreCol + rimGlow, 1.0);
        }
      `,
    });

    const sunMesh = new THREE.Mesh(sunGeo, this.sunShaderMat);
    sunMesh.userData.bodyId = 'sun' satisfies CelestialBodyId;
    this.clickableMeshes.push(sunMesh);
    this.sunTiltFrame.add(sunMesh);

    const chromoGeo = new THREE.SphereGeometry(ASTRO_CONSTANTS.SUN_RADIUS * 1.055, 48, 32);
    const chromoMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          float rim = pow(clamp(dot(normalize(vNormal), normalize(vViewPos)) * -1.0 + 0.65, 0.0, 1.0), 3.0);
          gl_FragColor = vec4(1.0, 0.62, 0.18, rim * 0.62);
        }
      `,
    });
    const chromoMesh = new THREE.Mesh(chromoGeo, chromoMat);
    this.sunGroup.add(chromoMesh);

    const coronaGeo = new THREE.SphereGeometry(ASTRO_CONSTANTS.SUN_RADIUS * 1.48, 48, 32);
    const coronaMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          float f = clamp(dot(normalize(-vNormal), normalize(vViewPos)), 0.0, 1.0);
          float glow = pow(f, 3.8) * 0.38;
          gl_FragColor = vec4(1.0, 0.72, 0.28, glow);
        }
      `,
    });
    const coronaMesh = new THREE.Mesh(coronaGeo, coronaMat);
    this.sunGroup.add(coronaMesh);

    const axisGeo = new THREE.CylinderGeometry(0.025, 0.025, ASTRO_CONSTANTS.SUN_RADIUS * 2.55, 12);
    const axisMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.45,
    });
    const sunAxisRod = new THREE.Mesh(axisGeo, axisMat);
    this.sunGuideGroup.add(sunAxisRod);

    const eqGeo = new THREE.TorusGeometry(ASTRO_CONSTANTS.SUN_RADIUS * 1.18, 0.014, 8, 72);
    eqGeo.rotateX(Math.PI / 2);
    const eqRing = new THREE.Mesh(eqGeo, axisMat);
    this.sunGuideGroup.add(eqRing);
    this.sunTiltFrame.add(this.sunGuideGroup);

    this.scene.add(this.sunGroup);
    this.disposables.push(
      sunGeo,
      this.sunShaderMat,
      chromoGeo,
      chromoMat,
      coronaGeo,
      coronaMat,
      axisGeo,
      eqGeo,
      axisMat
    );
  }

  private buildEarthAndMoonSystem(): void {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const earthTex = createEarthTextures(maxAniso);
    const moonTex = createMoonTextures(maxAniso);
    this.disposables.push(
      earthTex.albedoMap,
      earthTex.roughnessMap,
      earthTex.bumpMap,
      earthTex.nightMap,
      earthTex.cloudMap,
      moonTex.albedoMap,
      moonTex.bumpMap
    );

    this.earthTiltFrame.rotation.x = ASTRO_CONSTANTS.EARTH_AXIAL_TILT_RAD;
    this.earthSystemGroup.add(this.earthTiltFrame);

    const earthGeo = new THREE.SphereGeometry(ASTRO_CONSTANTS.EARTH_RADIUS, 64, 48);
    this.earthMat = new THREE.MeshStandardMaterial({
      map: earthTex.albedoMap,
      roughnessMap: earthTex.roughnessMap,
      roughness: 1.0,
      metalness: 0.04,
      bumpMap: earthTex.bumpMap,
      bumpScale: 0.025,
    });

    this.earthMat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = { value: new THREE.Vector3(-1, 0, 0) };
      shader.uniforms.uNightMap = { value: earthTex.nightMap };
      shader.uniforms.uEclipseStrength = { value: 0.0 };
      shader.uniforms.uMoonShadowCenter = { value: new THREE.Vector3(0, 0, 0) };
      this.earthMat.userData.shader = shader;

      shader.vertexShader =
        `varying vec3 vWorldNormalCustom;\nvarying vec3 vWorldPosCustom;\nvarying vec2 vCustomUv;\n` +
        shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vCustomUv = uv;
           vWorldNormalCustom = normalize(mat3(modelMatrix) * normal);
           vWorldPosCustom = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader =
        `uniform vec3 uSunDir;\nuniform sampler2D uNightMap;\nuniform float uEclipseStrength;\nuniform vec3 uMoonShadowCenter;\nvarying vec3 vWorldNormalCustom;\nvarying vec3 vWorldPosCustom;\nvarying vec2 vCustomUv;\n` +
        shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           float sunDot = dot(normalize(vWorldNormalCustom), normalize(uSunDir));
           float nightMask = smoothstep(0.08, -0.22, sunDot);
           vec3 cityGlow = texture2D(uNightMap, vCustomUv).rgb;
           totalEmissiveRadiance += cityGlow * nightMask * 1.45;
           if (uEclipseStrength > 0.01 && sunDot > 0.0) {
             float distShadow = distance(vWorldPosCustom, uMoonShadowCenter);
             float umbra = 1.0 - smoothstep(0.14, 0.42, distShadow);
             diffuseColor.rgb *= (1.0 - umbra * 0.82 * uEclipseStrength);
           }`
        );
    };

    this.earthMesh = new THREE.Mesh(earthGeo, this.earthMat);
    this.earthMesh.castShadow = true;
    this.earthMesh.receiveShadow = true;
    this.earthMesh.userData.bodyId = 'earth' satisfies CelestialBodyId;
    this.clickableMeshes.push(this.earthMesh);
    this.earthTiltFrame.add(this.earthMesh);

    const cloudGeo = new THREE.SphereGeometry(
      ASTRO_CONSTANTS.EARTH_RADIUS * 1.018,
      56,
      40
    );
    const cloudMat = new THREE.MeshStandardMaterial({
      map: earthTex.cloudMap,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      roughness: 0.9,
      metalness: 0.0,
    });
    this.earthCloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    this.earthCloudMesh.receiveShadow = true;
    this.earthTiltFrame.add(this.earthCloudMesh);

    const atmosGeo = new THREE.SphereGeometry(
      ASTRO_CONSTANTS.EARTH_RADIUS * 1.065,
      48,
      36
    );
    this.earthAtmosMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(-1, 0, 0) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vViewNormal;
        varying vec3 vViewPos;
        void main() {
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vViewNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        varying vec3 vWorldNormal;
        varying vec3 vViewNormal;
        varying vec3 vViewPos;
        void main() {
          float rim = pow(clamp(dot(normalize(-vViewNormal), normalize(vViewPos)) * 1.15, 0.0, 1.0), 3.6);
          float daySide = smoothstep(-0.35, 0.65, dot(normalize(vWorldNormal), normalize(uSunDir)));
          vec3 skyCol = mix(vec3(0.16, 0.38, 0.82), vec3(0.42, 0.78, 1.0), daySide);
          gl_FragColor = vec4(skyCol, rim * (0.12 + 0.48 * daySide));
        }
      `,
    });
    const atmosMesh = new THREE.Mesh(atmosGeo, this.earthAtmosMat);
    this.earthTiltFrame.add(atmosMesh);

    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.45,
      roughness: 0.3,
      metalness: 0.6,
    });
    const rodGeo = new THREE.CylinderGeometry(
      0.016,
      0.016,
      ASTRO_CONSTANTS.EARTH_RADIUS * 2.95,
      12
    );
    const rodMesh = new THREE.Mesh(rodGeo, poleMat);
    this.earthAxisGroup.add(rodMesh);

    const northCapGeo = new THREE.ConeGeometry(0.055, 0.14, 12);
    const northCap = new THREE.Mesh(northCapGeo, poleMat);
    northCap.position.y = ASTRO_CONSTANTS.EARTH_RADIUS * 1.5;
    this.earthAxisGroup.add(northCap);

    const eqRingGeo = new THREE.TorusGeometry(
      ASTRO_CONSTANTS.EARTH_RADIUS * 1.32,
      0.011,
      8,
      72
    );
    eqRingGeo.rotateX(Math.PI / 2);
    const eqRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.45,
    });
    const earthEqRing = new THREE.Mesh(eqRingGeo, eqRingMat);
    this.earthAxisGroup.add(earthEqRing);
    this.earthTiltFrame.add(this.earthAxisGroup);

    const earthConeLen = ASTRO_CONSTANTS.MOON_ORBIT_RADIUS * 1.35;
    const earthConeGeo = new THREE.CylinderGeometry(
      ASTRO_CONSTANTS.EARTH_RADIUS * 0.92,
      ASTRO_CONSTANTS.EARTH_RADIUS * 0.32,
      earthConeLen,
      32,
      1,
      true
    );
    earthConeGeo.translate(0, earthConeLen * 0.5, 0);
    const shadowConeMat = new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.earthShadowCone = new THREE.Mesh(earthConeGeo, shadowConeMat);
    this.earthSystemGroup.add(this.earthShadowCone);

    const moonGeo = new THREE.SphereGeometry(ASTRO_CONSTANTS.MOON_RADIUS, 48, 36);
    this.moonMat = new THREE.MeshStandardMaterial({
      map: moonTex.albedoMap,
      bumpMap: moonTex.bumpMap,
      bumpScale: 0.018,
      roughness: 0.92,
      metalness: 0.02,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
    });
    this.moonMesh = new THREE.Mesh(moonGeo, this.moonMat);
    this.moonMesh.castShadow = true;
    this.moonMesh.receiveShadow = true;
    this.moonMesh.userData.bodyId = 'moon' satisfies CelestialBodyId;
    this.clickableMeshes.push(this.moonMesh);

    const moonAxisGeo = new THREE.CylinderGeometry(
      0.01,
      0.01,
      ASTRO_CONSTANTS.MOON_RADIUS * 2.8,
      10
    );
    const moonAxisMat = new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.55,
    });
    const moonAxisRod = new THREE.Mesh(moonAxisGeo, moonAxisMat);
    this.moonAxisGroup.add(moonAxisRod);
    this.moonMesh.add(this.moonAxisGroup);

    const moonConeLen = ASTRO_CONSTANTS.MOON_ORBIT_RADIUS * 1.15;
    const moonConeGeo = new THREE.CylinderGeometry(
      ASTRO_CONSTANTS.MOON_RADIUS * 0.92,
      0.03,
      moonConeLen,
      24,
      1,
      true
    );
    moonConeGeo.translate(0, moonConeLen * 0.5, 0);
    const moonConeMat = new THREE.MeshBasicMaterial({
      color: 0x090d16,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.moonShadowCone = new THREE.Mesh(moonConeGeo, moonConeMat);
    this.earthSystemGroup.add(this.moonShadowCone);

    this.earthSystemGroup.add(this.moonMesh);
    this.scene.add(this.earthSystemGroup);

    this.disposables.push(
      earthGeo,
      this.earthMat,
      cloudGeo,
      cloudMat,
      atmosGeo,
      this.earthAtmosMat,
      rodGeo,
      northCapGeo,
      poleMat,
      eqRingGeo,
      eqRingMat,
      earthConeGeo,
      shadowConeMat,
      moonGeo,
      this.moonMat,
      moonAxisGeo,
      moonAxisMat,
      moonConeGeo,
      moonConeMat
    );
  }

  private buildOrbitPaths(): void {
    // 1. Earth Elliptical Heliocentric Orbit (moves with Sun)
    const earthPts: THREE.Vector3[] = [];
    const earthSegs = 240;
    const { EARTH_ORBIT_A, EARTH_ORBIT_E, MOON_ORBIT_RADIUS } = ASTRO_CONSTANTS;
    const perihelionAngle = THREE.MathUtils.degToRad(283);

    for (let i = 0; i < earthSegs; i++) {
      const ang = (i / earthSegs) * Math.PI * 2;
      const r =
        (EARTH_ORBIT_A * (1 - EARTH_ORBIT_E * EARTH_ORBIT_E)) /
        (1 + EARTH_ORBIT_E * Math.cos(ang - perihelionAngle));
      earthPts.push(new THREE.Vector3(Math.cos(ang) * r, 0, -Math.sin(ang) * r));
    }
    const earthOrbitGeo = new THREE.BufferGeometry().setFromPoints(earthPts);
    const earthOrbitMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.42,
    });
    this.earthOrbitLine = new THREE.LineLoop(earthOrbitGeo, earthOrbitMat);
    this.scene.add(this.earthOrbitLine);

    // 2. Moon Inclined Orbit Ring
    const moonPts: THREE.Vector3[] = [];
    const moonSegs = 128;
    for (let i = 0; i < moonSegs; i++) {
      const ang = (i / moonSegs) * Math.PI * 2;
      moonPts.push(
        new THREE.Vector3(
          Math.cos(ang) * MOON_ORBIT_RADIUS,
          0,
          -Math.sin(ang) * MOON_ORBIT_RADIUS
        )
      );
    }
    const moonOrbitGeo = new THREE.BufferGeometry().setFromPoints(moonPts);
    const moonOrbitMat = new THREE.LineBasicMaterial({
      color: 0xcbd5e1,
      transparent: true,
      opacity: 0.5,
    });
    this.moonOrbitLine = new THREE.LineLoop(moonOrbitGeo, moonOrbitMat);
    this.moonOrbitTiltGroup.add(this.moonOrbitLine);

    const nodeGeo = new THREE.SphereGeometry(0.085, 16, 12);
    const nodeMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.85,
    });
    const ascNode = new THREE.Mesh(nodeGeo, nodeMat);
    ascNode.position.set(MOON_ORBIT_RADIUS, 0, 0);
    const descNode = new THREE.Mesh(nodeGeo, nodeMat);
    descNode.position.set(-MOON_ORBIT_RADIUS, 0, 0);
    this.moonNodesGroup.add(ascNode, descNode);
    this.moonOrbitTiltGroup.add(this.moonNodesGroup);

    this.earthSystemGroup.add(this.moonOrbitTiltGroup);

    const ecRefMat = new THREE.LineBasicMaterial({
      color: 0x475569,
      transparent: true,
      opacity: 0.28,
    });
    this.moonEclipticRefLine = new THREE.LineLoop(moonOrbitGeo, ecRefMat);
    this.earthSystemGroup.add(this.moonEclipticRefLine);

    // 3. Sun's Grand Galactic Orbit Path (stationary in world space)
    const galPts: THREE.Vector3[] = [];
    const galSegs = 360;
    const tmpP = new THREE.Vector3();
    for (let i = 0; i < galSegs; i++) {
      const day = (i / galSegs) * ASTRO_CONSTANTS.SUN_GALACTIC_PERIOD_DAYS;
      computeSunGalacticPosition(day, 'galactic', tmpP);
      galPts.push(tmpP.clone());
    }
    const galOrbitGeo = new THREE.BufferGeometry().setFromPoints(galPts);
    const galOrbitMat = new THREE.LineBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.26,
    });
    this.sunGalacticOrbitLine = new THREE.LineLoop(galOrbitGeo, galOrbitMat);
    this.scene.add(this.sunGalacticOrbitLine);

    this.disposables.push(
      earthOrbitGeo,
      earthOrbitMat,
      moonOrbitGeo,
      moonOrbitMat,
      nodeGeo,
      nodeMat,
      ecRefMat,
      galOrbitGeo,
      galOrbitMat
    );
  }

  private buildGalacticTrails(): void {
    const buildTrail = (
      buffer: Float32Array,
      baseHex: number
    ): THREE.Line => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(buffer, 3));

      // Fade alpha-like luminance via vertex colors from tail (0) to head (TRAIL_POINTS - 1)
      const colors = new Float32Array(TRAIL_POINTS * 3);
      const col = new THREE.Color(baseHex);
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const t = i / (TRAIL_POINTS - 1);
        const fade = t * t;
        colors[i * 3] = col.r * fade;
        colors[i * 3 + 1] = col.g * fade;
        colors[i * 3 + 2] = col.b * fade;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.disposables.push(geo, mat);
      return line;
    };

    this.sunTrailLine = buildTrail(this.sunTrailPositions, 0xf59e0b);
    this.earthTrailLine = buildTrail(this.earthTrailPositions, 0x38bdf8);
    this.moonTrailLine = buildTrail(this.moonTrailPositions, 0x94a3b8);
  }

  private updateTrails(force = false): void {
    if (!this.toggles.showTrails) return;
    if (!force && Math.abs(this.simDays - this.lastTrailSimDays) < 0.35) {
      return;
    }
    this.lastTrailSimDays = this.simDays;

    const span = TRAIL_SPAN_DAYS;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const frac = i / (TRAIL_POINTS - 1);
      const sampleDay = this.simDays - (1 - frac) * span;
      computeOrbitalPositions(
        sampleDay,
        this.motionFrame,
        _tSun,
        _tEarthRel,
        _tEarth,
        _tMoonL,
        _tMoonW
      );
      const idx = i * 3;
      this.sunTrailPositions[idx] = _tSun.x;
      this.sunTrailPositions[idx + 1] = _tSun.y;
      this.sunTrailPositions[idx + 2] = _tSun.z;

      this.earthTrailPositions[idx] = _tEarth.x;
      this.earthTrailPositions[idx + 1] = _tEarth.y;
      this.earthTrailPositions[idx + 2] = _tEarth.z;

      this.moonTrailPositions[idx] = _tMoonW.x;
      this.moonTrailPositions[idx + 1] = _tMoonW.y;
      this.moonTrailPositions[idx + 2] = _tMoonW.z;
    }

    (
      this.sunTrailLine.geometry.getAttribute('position') as THREE.BufferAttribute
    ).needsUpdate = true;
    (
      this.earthTrailLine.geometry.getAttribute('position') as THREE.BufferAttribute
    ).needsUpdate = true;
    (
      this.moonTrailLine.geometry.getAttribute('position') as THREE.BufferAttribute
    ).needsUpdate = true;
  }

  private applyOrbitalPositions(orbital: OrbitalPositions, deltaSec: number): void {
    // Move Sun assembly, point light, Earth orbit ring, and ecliptic grid with Sun's galactic position
    this.sunGroup.position.copy(orbital.sunPos);
    this.sunPointLight.position.copy(orbital.sunPos);
    this.earthOrbitLine.position.copy(orbital.sunPos);
    this.eclipticGrid.position.set(
      orbital.sunPos.x,
      orbital.sunPos.y - 0.02,
      orbital.sunPos.z
    );

    // Sun rotation around its 7.25° tilted axis
    this.sunTiltFrame.rotation.y = (this.simDays / 25.05) * Math.PI * 2;

    // Position Earth system
    this.earthSystemGroup.position.copy(orbital.earthPos);
    this.earthMesh.rotation.y = orbital.earthSpinAngle;
    this.earthCloudMesh.rotation.y = orbital.earthSpinAngle * 1.07 + 0.4;

    // Position Moon locally relative to Earth
    this.moonMesh.position.copy(orbital.moonLocalPos);
    this.moonMesh.rotation.y = orbital.moonOrbitAngle + Math.PI;

    this.moonOrbitTiltGroup.rotation.set(0, 0, 0);
    this.moonOrbitTiltGroup.rotateY(orbital.nodeAngle);
    this.moonOrbitTiltGroup.rotateX(ASTRO_CONSTANTS.MOON_INCLINATION_RAD);

    // Sun -> Earth unit vector (from sunPos to earthPos)
    _vSunToEarth.copy(orbital.earthRelPos).normalize();
    _vEarthToSun.copy(_vSunToEarth).negate();

    // Position parallel solar directional light upstream toward Sun
    this.sunDirLight.position
      .copy(orbital.earthPos)
      .addScaledVector(_vSunToEarth, -16);
    this.sunDirLight.target.position.copy(orbital.earthPos);
    this.sunDirLight.target.updateMatrixWorld();

    this.earthAtmosMat.uniforms.uSunDir.value.copy(_vEarthToSun);
    if (this.earthMat.userData.shader) {
      this.earthMat.userData.shader.uniforms.uSunDir.value.copy(_vEarthToSun);
    }

    // Shadow cones point away from Sun
    _qAlign.setFromUnitVectors(_vUpAxis, _vSunToEarth);
    this.earthShadowCone.quaternion.copy(_qAlign);

    _vSunToMoon.copy(orbital.moonWorldPos).sub(orbital.sunPos).normalize();
    _qAlign.setFromUnitVectors(_vUpAxis, _vSunToMoon);
    this.moonShadowCone.position.copy(orbital.moonLocalPos);
    this.moonShadowCone.quaternion.copy(_qAlign);

    const inSolarEclipse =
      orbital.eclipseState === 'solar-total' ||
      orbital.eclipseState === 'solar-partial';
    const inLunarEclipse =
      orbital.eclipseState === 'lunar-total' ||
      orbital.eclipseState === 'lunar-partial';

    this.earthShadowCone.visible = this.toggles.showShadowCones;
    this.moonShadowCone.visible = this.toggles.showShadowCones;

    if (inLunarEclipse) {
      const targetEmissive = orbital.eclipseState === 'lunar-total' ? 0.55 : 0.25;
      this.moonMat.emissive.setHex(0x8c240c);
      this.moonMat.emissiveIntensity = THREE.MathUtils.damp(
        this.moonMat.emissiveIntensity,
        targetEmissive,
        6,
        Math.max(deltaSec, 0.016)
      );
      this.moonMat.color.setHex(0xd46b4e);
    } else {
      this.moonMat.emissiveIntensity = THREE.MathUtils.damp(
        this.moonMat.emissiveIntensity,
        0,
        8,
        Math.max(deltaSec, 0.016)
      );
      this.moonMat.color.setHex(0xffffff);
    }

    if (this.earthMat.userData.shader) {
      const sh = this.earthMat.userData.shader;
      if (inSolarEclipse) {
        sh.uniforms.uEclipseStrength.value =
          orbital.eclipseState === 'solar-total' ? 1.0 : 0.65;
        const earthDist = orbital.earthRelPos.length();
        const moonDist = _tSun.copy(orbital.moonWorldPos).sub(orbital.sunPos).length();
        if (moonDist > 0.01) {
          sh.uniforms.uMoonShadowCenter.value
            .copy(orbital.sunPos)
            .addScaledVector(
              _vSunToMoon,
              earthDist - ASTRO_CONSTANTS.EARTH_RADIUS * 0.88
            );
        }
      } else {
        sh.uniforms.uEclipseStrength.value = 0.0;
      }
    }
  }

  private getTargetWorldPosition(target: CameraTarget, out: THREE.Vector3): void {
    switch (target) {
      case 'sun':
      case 'overview':
      case 'top':
        out.copy(this.sunGroup.position);
        break;
      case 'earth':
        out.copy(this.earthSystemGroup.position);
        break;
      case 'moon':
        out.copy(this.earthSystemGroup.position).add(this.moonMesh.position);
        break;
      case 'fixed':
        out.copy(this.controls.target);
        break;
    }
  }

  private getDesiredCameraOffset(target: CameraTarget, out: THREE.Vector3): void {
    switch (target) {
      case 'overview':
        out.set(24, 24, 52);
        break;
      case 'top':
        out.set(0, 72, 0.01);
        break;
      case 'sun':
        out.set(6.5, 4.0, 9.5);
        break;
      case 'earth': {
        const radial = _vSunToEarth
          .copy(this.earthSystemGroup.position)
          .sub(this.sunGroup.position)
          .normalize();
        const tangentX = -radial.z;
        const tangentZ = radial.x;
        out.set(
          -radial.x * 2.4 + tangentX * 2.8,
          1.75,
          -radial.z * 2.4 + tangentZ * 2.8
        );
        break;
      }
      case 'moon': {
        const radial = _vSunToEarth
          .copy(this.earthSystemGroup.position)
          .sub(this.sunGroup.position)
          .normalize();
        const tangentX = -radial.z;
        const tangentZ = radial.x;
        out.set(
          -radial.x * 0.9 + tangentX * 1.15,
          0.55,
          -radial.z * 0.9 + tangentZ * 1.15
        );
        break;
      }
      case 'fixed':
        out.copy(this.camera.position).sub(this.controls.target);
        break;
    }
  }

  public focusEclipseView(type: 'solar' | 'lunar'): void {
    this.cameraTarget = 'earth';
    this.isCameraTransitioning = false;
    const earthPos = this.earthSystemGroup.position;
    const radial = _vSunToEarth
      .copy(earthPos)
      .sub(this.sunGroup.position)
      .normalize();
    const tangentX = -radial.z;
    const tangentZ = radial.x;

    const radialSign = type === 'solar' ? -4.2 : 3.6;
    _vDesiredTarget.copy(earthPos).addScaledVector(radial, type === 'solar' ? -1.8 : 2.2);
    _vDesiredCamPos
      .copy(_vDesiredTarget)
      .addScaledVector(radial, radialSign)
      .add(new THREE.Vector3(tangentX * 6.8, 2.6, tangentZ * 6.8));

    this.controls.target.copy(_vDesiredTarget);
    this.camera.position.copy(_vDesiredCamPos);
    this.controls.update();
    _vPrevTarget.copy(earthPos);
    this.hasInitialTarget = true;
  }

  private applyCameraTargetImmediate(target: CameraTarget): void {
    this.cameraTarget = target;
    this.getTargetWorldPosition(target, _vDesiredTarget);
    this.getDesiredCameraOffset(target, _vCamOffset);
    this.controls.target.copy(_vDesiredTarget);
    this.camera.position.copy(_vDesiredTarget).add(_vCamOffset);
    this.controls.update();
    _vPrevTarget.copy(_vDesiredTarget);
    this.hasInitialTarget = true;
    this.isCameraTransitioning = false;
  }

  // === PUBLIC API FOR REACT HUD ===

  public setPlayback(isPlaying: boolean, daysPerSec: number): void {
    this.isPlaying = isPlaying;
    this.daysPerSec = daysPerSec;
  }

  public setMotionFrame(frame: MotionReferenceFrame): void {
    if (this.motionFrame === frame) return;
    this.motionFrame = frame;

    const orbital = computeOrbitalPositions(
      this.simDays,
      this.motionFrame,
      _vSun,
      _vEarthRel,
      _vEarth,
      _vMoonLocal,
      _vMoonWorld
    );
    this.applyOrbitalPositions(orbital, 0.016);
    this.sunGalacticOrbitLine.visible =
      this.toggles.showOrbits && this.motionFrame === 'galactic';

    // Re-center camera on current target after coordinate frame switch
    if (this.cameraTarget !== 'fixed') {
      this.getTargetWorldPosition(this.cameraTarget, _vCurrTarget);
      if (this.hasInitialTarget) {
        _vDelta.copy(_vCurrTarget).sub(_vPrevTarget);
        this.camera.position.add(_vDelta);
        this.controls.target.add(_vDelta);
        _vPrevTarget.copy(_vCurrTarget);
      }
    }

    this.updateTrails(true);
    this.callbacks.onTelemetryTick(this.simDays, orbital);
  }

  public setSimDays(days: number): void {
    const bigJump = Math.abs(days - this.simDays) > 2;
    this.simDays = days;
    const orbital = computeOrbitalPositions(
      this.simDays,
      this.motionFrame,
      _vSun,
      _vEarthRel,
      _vEarth,
      _vMoonLocal,
      _vMoonWorld
    );
    this.applyOrbitalPositions(orbital, 0.016);
    if (this.cameraTarget !== 'fixed') {
      this.getTargetWorldPosition(this.cameraTarget, _vCurrTarget);
      if (this.hasInitialTarget) {
        _vDelta.copy(_vCurrTarget).sub(_vPrevTarget);
        this.camera.position.add(_vDelta);
        this.controls.target.add(_vDelta);
        _vPrevTarget.copy(_vCurrTarget);
      }
    }
    this.updateTrails(bigJump);
    this.callbacks.onTelemetryTick(this.simDays, orbital);
  }

  public setCameraTarget(target: CameraTarget): void {
    if (target === 'fixed') {
      // Freeze camera & focus at current Sun vicinity so user sees Sun fly through space
      this.cameraTarget = 'fixed';
      this.isCameraTransitioning = false;
      this.controls.target.copy(this.sunGroup.position);
      return;
    }
    this.cameraTarget = target;
    this.isCameraTransitioning = true;
    this.getTargetWorldPosition(target, _vPrevTarget);
    this.hasInitialTarget = true;
  }

  public setToggles(toggles: VisualToggles): void {
    this.toggles = toggles;
    this.earthOrbitLine.visible = toggles.showOrbits;
    this.moonOrbitLine.visible = toggles.showOrbits;
    this.moonEclipticRefLine.visible = toggles.showOrbits;
    this.moonNodesGroup.visible = toggles.showOrbits;
    this.eclipticGrid.visible = toggles.showOrbits;
    this.sunGalacticOrbitLine.visible =
      toggles.showOrbits && this.motionFrame === 'galactic';

    this.sunGuideGroup.visible = toggles.showAxes;
    this.earthAxisGroup.visible = toggles.showAxes;
    this.moonAxisGroup.visible = toggles.showAxes;

    this.earthShadowCone.visible = toggles.showShadowCones;
    this.moonShadowCone.visible = toggles.showShadowCones;

    this.sunTrailLine.visible = toggles.showTrails;
    this.earthTrailLine.visible = toggles.showTrails;
    this.moonTrailLine.visible = toggles.showTrails;
    if (toggles.showTrails) {
      this.updateTrails(true);
    }

    if (!toggles.showLabels) {
      this.hideAllLabels();
    }
  }

  private hideAllLabels(): void {
    const els = [this.labelRefs.sun, this.labelRefs.earth, this.labelRefs.moon];
    for (const el of els) {
      if (el) el.style.opacity = '0';
    }
  }

  private updateProjectedLabels(): void {
    if (!this.toggles.showLabels) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;

    const entries: Array<{
      el: HTMLDivElement | null;
      worldPos: THREE.Vector3;
      yOffset: number;
    }> = [
      {
        el: this.labelRefs.sun,
        worldPos: this.sunGroup.position,
        yOffset: ASTRO_CONSTANTS.SUN_RADIUS + 0.85,
      },
      {
        el: this.labelRefs.earth,
        worldPos: this.earthSystemGroup.position,
        yOffset: ASTRO_CONSTANTS.EARTH_RADIUS + 0.6,
      },
      {
        el: this.labelRefs.moon,
        worldPos: _vMoonWorld.copy(this.earthSystemGroup.position).add(this.moonMesh.position),
        yOffset: ASTRO_CONSTANTS.MOON_RADIUS + 0.35,
      },
    ];

    for (const entry of entries) {
      if (!entry.el) continue;
      _vLabelWorld.copy(entry.worldPos);
      _vLabelWorld.y += entry.yOffset;
      _vProject.copy(_vLabelWorld).project(this.camera);

      if (_vProject.z > 1 || _vProject.z < -1) {
        entry.el.style.opacity = '0';
        continue;
      }

      const x = (_vProject.x * 0.5 + 0.5) * w;
      const y = (-_vProject.y * 0.5 + 0.5) * h;

      if (x < 30 || x > w - 30 || y < 30 || y > h - 30) {
        entry.el.style.opacity = '0';
      } else {
        entry.el.style.opacity = '1';
        entry.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    this.pointerDownPos.set(e.clientX, e.clientY);
  }

  private handlePointerUp(e: PointerEvent): void {
    const moveDist = Math.hypot(
      e.clientX - this.pointerDownPos.x,
      e.clientY - this.pointerDownPos.y
    );
    if (moveDist > 6) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.clickableMeshes, false);

    if (hits.length > 0) {
      const bodyId = hits[0].object.userData.bodyId as CelestialBodyId | undefined;
      if (bodyId) {
        this.callbacks.onSelectBody(bodyId);
        this.setCameraTarget(bodyId);
      }
    }
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = (): void => {
    if (this.disposed) return;

    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, 0.1);
    const elapsed = this.clock.elapsedTime;

    if (this.isPlaying) {
      this.simDays += delta * this.daysPerSec;
    }

    this.sunShaderMat.uniforms.uTime.value = elapsed;

    const orbital = computeOrbitalPositions(
      this.simDays,
      this.motionFrame,
      _vSun,
      _vEarthRel,
      _vEarth,
      _vMoonLocal,
      _vMoonWorld
    );
    this.applyOrbitalPositions(orbital, delta);
    this.updateTrails(this.forceTrailRebuild);
    this.forceTrailRebuild = false;

    // Follow moving target (unless user chose 'fixed' space camera)
    if (this.cameraTarget !== 'fixed') {
      this.getTargetWorldPosition(this.cameraTarget, _vCurrTarget);
      if (this.hasInitialTarget) {
        _vDelta.copy(_vCurrTarget).sub(_vPrevTarget);
        this.camera.position.add(_vDelta);
        this.controls.target.add(_vDelta);
      }
      _vPrevTarget.copy(_vCurrTarget);

      if (this.isCameraTransitioning) {
        this.getDesiredCameraOffset(this.cameraTarget, _vCamOffset);
        _vDesiredCamPos.copy(_vCurrTarget).add(_vCamOffset);

        const dampFactor = 6.5;
        this.controls.target.x = THREE.MathUtils.damp(
          this.controls.target.x,
          _vCurrTarget.x,
          dampFactor,
          delta
        );
        this.controls.target.y = THREE.MathUtils.damp(
          this.controls.target.y,
          _vCurrTarget.y,
          dampFactor,
          delta
        );
        this.controls.target.z = THREE.MathUtils.damp(
          this.controls.target.z,
          _vCurrTarget.z,
          dampFactor,
          delta
        );

        this.camera.position.x = THREE.MathUtils.damp(
          this.camera.position.x,
          _vDesiredCamPos.x,
          dampFactor,
          delta
        );
        this.camera.position.y = THREE.MathUtils.damp(
          this.camera.position.y,
          _vDesiredCamPos.y,
          dampFactor,
          delta
        );
        this.camera.position.z = THREE.MathUtils.damp(
          this.camera.position.z,
          _vDesiredCamPos.z,
          dampFactor,
          delta
        );

        if (
          this.camera.position.distanceTo(_vDesiredCamPos) < 0.08 &&
          this.controls.target.distanceTo(_vCurrTarget) < 0.05
        ) {
          this.isCameraTransitioning = false;
        }
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateProjectedLabels();

    if (elapsed - this.lastUiEmitTime > 0.08) {
      this.lastUiEmitTime = elapsed;
      this.callbacks.onTelemetryTick(this.simDays, orbital);
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.boundOnResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.boundOnPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.boundOnPointerUp);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.boundOnContextLost);
    this.renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this.boundOnContextRestored
    );

    this.controls.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
