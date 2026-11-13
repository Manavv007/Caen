import { checkCapability } from '@caen/tryon/capability.js';
import { startCamera, stopCamera, listVideoInputDevices } from '@caen/tryon/camera.js';
import { createVisionClient } from '@caen/tryon/vision-client.js';
import { TrackingLoop } from '@caen/tryon/frame-scheduler.js';
import { PerfGovernor } from '@caen/tryon/perf-governor.js';
import { setRendererOptions, setOverlayPixelRatio } from '@caen/tryon/three-runtime.js';
import { RingTryOnPipeline } from '@caen/tryon/ring-tryon-pipeline.js';
import { FaceTryOnPipeline } from '@caen/tryon/face-tryon-pipeline.js';
import { NecklaceTryOnPipeline } from '@caen/tryon/necklace-tryon-pipeline.js';
import { NoseRingTryOnPipeline } from '@caen/tryon/nose-ring-pipeline.js';
import MODELS from '../data/models.json';

// Product catalogs below move to the database in Phase 3. Model URLs come
// from scripts/build-models.mjs (compressed, content-hashed .glb files).

// Rings. the_ring_1_carat: CC-BY-4.0, commercial use allowed with credit.
const RING_CATALOG = {
  'CELESTE-SOLITAIRE-RING': {
    url: MODELS.the_ring_1_carat,
    credit: '"The Ring: 1 carat" by Evan (sketchfab.com/Evanz), CC-BY-4.0',
    creditUrl: 'https://sketchfab.com/3d-models/the-ring-1-carat-378f6df2c4f444399b83db2037258470',
  },
};
const RING_ALIASES = { solitaire: 'CELESTE-SOLITAIRE-RING' };
const DEFAULT_RING_SKU = 'CELESTE-SOLITAIRE-RING';

// Earrings. lengthMm = real length
// from the hook's top to the bottom of the drop; sets the on-ear size.
const EARRING_CATALOG = {
  'GOLDEN-BALL-CRYSTAL-DROP-EARRINGS': {
    url: MODELS.golden_ball_crystal_diamond_drop_earrings,
    lengthMm: 48,
    credit: '"Golden Ball Crystal Diamond Drop Earrings" by DineshThennarasan (sketchfab.com/dineshthennarasan), CC-BY-4.0',
    creditUrl: 'https://sketchfab.com/3d-models/golden-ball-crystal-diamond-drop-earrings-863d3b5c1a714cfb88dc01c7ea0fbcfe',
  },
};
const DEFAULT_EARRING_SKU = 'GOLDEN-BALL-CRYSTAL-DROP-EARRINGS';

// Necklaces. lengthMm = real chain
// length (front arc that is visible on the wearer).
const NECKLACE_CATALOG = {
  'GOLD-NECKLACE-CHAIN': {
    url: MODELS.gold_necklace__chain,
    lengthMm: 450,
    credit: '"Gold necklace / chain" by Mckai (sketchfab.com/Mckai), CC-BY-4.0',
    creditUrl: 'https://sketchfab.com/3d-models/gold-necklace-chain-8bb2ebea4fbd4a3a9b21cba9f5d5fdc8',
  },
};
const DEFAULT_NECKLACE_SKU = 'GOLD-NECKLACE-CHAIN';

// Nose rings. diameterMm = real outer
// diameter of the ring; sets its size relative to the face.
const NOSE_RING_CATALOG = {
  'POINTY-NOSE-RING': {
    url: MODELS.pointy_nose_ring,
    diameterMm: 12,
    credit: '"Pointy Nose Ring" by Tiko (sketchfab.com/tikoavp), CC-BY-4.0',
    creditUrl: 'https://sketchfab.com/3d-models/pointy-nose-ring-c1edf8f97caa4b019aa57cbe24566e34',
  },
};
const DEFAULT_NOSE_RING_SKU = 'POINTY-NOSE-RING';

const urlParams = new URLSearchParams(window.location.search);
// Face-tracked categories share one tracker; 'earrings' / 'necklaces' accepted as aliases.
const rawCategory = (urlParams.get('category') || 'ring').toLowerCase();
const CATEGORY_ALIASES = {
  earrings: 'earring', necklaces: 'necklace',
  nosering: 'nose', 'nose-ring': 'nose', nose_ring: 'nose', nosepin: 'nose', 'nose-pin': 'nose', nosepiercing: 'nose',
};
const category = CATEGORY_ALIASES[rawCategory] || rawCategory;
const FACE_CATEGORIES = ['earring', 'necklace', 'nose'];
const sku = urlParams.get('sku') || 'UNKNOWN-SKU';
// ?ring=solitaire switches the model directly (testing).
const ringKey = RING_ALIASES[urlParams.get('ring')] || (RING_CATALOG[sku] ? sku : DEFAULT_RING_SKU);
const RING_ENTRY = RING_CATALOG[ringKey];
const RING_MODEL_URL = RING_ENTRY.url;
const EARRING_ENTRY = EARRING_CATALOG[sku] || EARRING_CATALOG[DEFAULT_EARRING_SKU];
const NECKLACE_ENTRY = NECKLACE_CATALOG[sku] || NECKLACE_CATALOG[DEFAULT_NECKLACE_SKU];
const NOSE_RING_ENTRY = NOSE_RING_CATALOG[sku] || NOSE_RING_CATALOG[DEFAULT_NOSE_RING_SKU];
const CREDIT_ENTRY = category === 'ring' ? RING_ENTRY : category === 'earring' ? EARRING_ENTRY : category === 'necklace' ? NECKLACE_ENTRY : category === 'nose' ? NOSE_RING_ENTRY : null;
if (CREDIT_ENTRY && CREDIT_ENTRY.credit) {
  const creditEl = document.getElementById('model-credit');
  const a = document.createElement('a');
  a.href = CREDIT_ENTRY.creditUrl;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = CREDIT_ENTRY.credit;
  a.className = 'underline';
  creditEl.append('3D model: ', a);
  creditEl.classList.remove('hidden');
}

// ?debug=1 draws the hand skeleton, the skin-measurement crop (blue box)
// and the measured finger edges (blue dots = measured, red = rejected).
const SHOW_DEBUG_SKELETON = urlParams.get('debug') === '1';
// The debug recorder reads the WebGL canvas back, which needs the drawing
// buffer kept; everyone else gets the faster default.
// Render quality tier (pixel-ratio cap); steps down if tracking can't keep up.
const governor = new PerfGovernor({
  onChange: (tier) => setOverlayPixelRatio(pipeline && pipeline.scene && pipeline.scene.renderer, tier.maxPixelRatio),
});
setRendererOptions({ preserveDrawingBuffer: SHOW_DEBUG_SKELETON, maxPixelRatio: governor.tier.maxPixelRatio });
if (SHOW_DEBUG_SKELETON) document.getElementById('debug-panel').classList.remove('hidden');
/** Debug-only module, fetched only with ?debug=1. */
const loadSessionRecorder = () => import('@caen/tryon/session-recorder.js').then((m) => m.SessionRecorder);
document.getElementById('category-badge').textContent = category;

const views = {
  checking: document.getElementById('view-checking'),
  unsupported: document.getElementById('view-unsupported'),
  startingCamera: document.getElementById('view-starting-camera'),
  cameraError: document.getElementById('view-camera-error'),
  live: document.getElementById('view-live'),
};
const debugOutput = document.getElementById('debug-output');
const videoEl = document.getElementById('camera-video');
const overlayCanvas = document.getElementById('overlay-canvas');
const debugCanvas = document.getElementById('debug-canvas');
if (SHOW_DEBUG_SKELETON) debugCanvas.classList.remove('hidden');
const switchCameraBtn = document.getElementById('switch-camera-btn');
const statusPill = document.getElementById('status-pill');
const modelLoadingIndicator = document.getElementById('model-loading-indicator');
const sizingPanel = document.getElementById('sizing-panel');
const sizingTitle = document.getElementById('sizing-title');
const sizingHint = document.getElementById('sizing-hint');
const sizingBar = document.getElementById('sizing-bar');
const resizeBtn = document.getElementById('resize-btn');
const recordBtn = document.getElementById('record-btn');
const recordLabel = document.getElementById('record-label');

let currentStream = null;
let currentFacingMode = 'user';
let trackingLoop = null;
let trackingToken = 0; // bumps on every stop, so a start that finishes late can tell it was cancelled
let lastStatus = '';
let pipeline = null;
let recorder = null;
let lastDebugLog = 0;

// User-facing hint for why a sizing frame was rejected.
const SIZING_HINTS = {
  'fingers-touching': 'Spread your fingers slightly apart',
  'hand-not-flat': 'Turn the back of your hand (or palm) flat to the camera',
  'finger-tilted': 'Keep your fingers pointing up, not toward the camera',
  moving: 'Hold your hand still',
  'finger-not-measured': 'Hold your hand flat and still, fingers slightly apart',
  'no-scale': 'Hold your hand flat and still, fingers slightly apart',
};

function updateSizingUi(info) {
  const s = info && info.sizing;
  const sizing = !!(info && info.handDetected && s && s.state === 'sizing');
  sizingPanel.classList.toggle('hidden', !sizing);
  resizeBtn.classList.toggle('hidden', !(s && s.locked));
  if (!sizing) return;
  sizingBar.style.width = `${Math.round(s.progress * 100)}%`;
  sizingHint.textContent = SIZING_HINTS[s.lastRejectReason] || 'Hold your hand flat and still, fingers slightly apart';
}

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });
}

function logDebug(data) {
  debugOutput.textContent = JSON.stringify(data, null, 2);
}

function goToFallback() {
  // Placeholder: Task 10 wires this to the real 360Â°/static product
  // viewer instead of an alert.
  alert('360Â° product viewer fallback will be wired up in a later step.');
}

// Landmarkers per category. Necklaces run pose on every other frame only:
// the torso moves slowly and the face drives the fine placement.
const VISION_KINDS = category === 'ring' ? ['hand']
  : category === 'necklace' ? ['face', 'pose']
    : FACE_CATEGORIES.includes(category) ? ['face'] : [];
const kindsForFrame = (i) => (category === 'necklace' && i % 2 === 1 ? ['face'] : VISION_KINDS);
// ?vision=main forces the old main-thread tracking (A/B comparison on a phone).
const VISION_PREFER = urlParams.get('vision') === 'main' ? 'main' : 'worker';
// Render on requestAnimationFrame and extrapolate between detections
// (render-smoothing.js); ?smooth=0 renders once per detection, as before (A/B).
const SMOOTH = urlParams.get('smooth') !== '0';
const MODEL_URL = { ring: RING_MODEL_URL, earring: EARRING_ENTRY.url, necklace: NECKLACE_ENTRY.url, nose: NOSE_RING_ENTRY.url }[category];

let visionPromise = null;
/** Loads the landmarkers once per page (kept across camera switches). */
function getVision() {
  if (!visionPromise) {
    visionPromise = createVisionClient(VISION_KINDS, { prefer: VISION_PREFER }).catch((err) => {
      visionPromise = null; // allow "Try again"
      throw err;
    });
  }
  return visionPromise;
}

function disposeVision() {
  if (visionPromise) visionPromise.then((v) => v.dispose(), () => {});
  visionPromise = null;
}

function createPipeline() {
  const debug = SHOW_DEBUG_SKELETON ? debugCanvas : null;
  if (category === 'ring') {
    return new RingTryOnPipeline({ overlayCanvas, debugCanvas: debug, modelUrl: RING_MODEL_URL, smooth: SMOOTH });
  }
  if (category === 'necklace') {
    const cutBackside = urlParams.get('cutBackside') !== '0';
    const cutZParam = urlParams.get('cutZ');
    const cutZ = cutZParam !== null ? parseFloat(cutZParam) : -0.02;
    const neckDownParam = urlParams.get('neckDown');
    const neckDown = neckDownParam !== null ? parseFloat(neckDownParam) : 0.80;
    // Sideways nudge in face widths (+ = right), e.g. ?neckX=-0.03
    const neckXParam = urlParams.get('neckX');
    const neckX = neckXParam !== null ? parseFloat(neckXParam) : 0;
    return new NecklaceTryOnPipeline({
      overlayCanvas,
      debugCanvas: debug,
      smooth: SMOOTH,
      modelUrl: NECKLACE_ENTRY.url,
      lengthMm: NECKLACE_ENTRY.lengthMm,
      neckDown,
      neckX,
      cutBackside,
      cutZ,
    });
  }
  if (category === 'nose') {
    // Tuning from the URL while the placement is being refined:
    //   ?side=right|left  ?noseTilt=deg  ?noseRoll=deg (gap turned toward the nose centre; 180 = gap down)
    //   ?noseCut=-0.34  ring height hidden below (diameters from the centre, toward the gap; -1 = hide nothing)
    //   ?noseX= ?noseY= ?noseZ=  piercing offset in face widths (X out, Y down, Z forward)
    //   ?noseDrop=  ring centre below the piercing, in ring diameters
    //   ?noseMm=  ring outer diameter in mm
    const num = (k) => { const v = urlParams.get(k); return v !== null && v !== '' && Number.isFinite(parseFloat(v)) ? parseFloat(v) : undefined; };
    const offset = {};
    if (num('noseX') !== undefined) offset.out = num('noseX');
    if (num('noseY') !== undefined) offset.down = num('noseY');
    if (num('noseZ') !== undefined) offset.forward = num('noseZ');
    return new NoseRingTryOnPipeline({
      overlayCanvas,
      debugCanvas: debug,
      smooth: SMOOTH,
      modelUrl: NOSE_RING_ENTRY.url,
      diameterMm: num('noseMm') ?? NOSE_RING_ENTRY.diameterMm,
      side: urlParams.get('side') === 'right' ? 'right' : 'left',
      tiltDeg: num('noseTilt'),
      rollDeg: num('noseRoll'),
      offset,
      drop: num('noseDrop'),
      cutHidden: num('noseCut'),
    });
  }
  return new FaceTryOnPipeline({
    overlayCanvas,
    debugCanvas: debug,
    smooth: SMOOTH,
    modelUrl: EARRING_ENTRY.url,
    lengthMm: EARRING_ENTRY.lengthMm,
  });
}

const r1 = (v, d = 1) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);

/** renderer.render() calls per second (render on demand skips unchanged frames). */
let renderRate = { t: 0, rendered: 0, skipped: 0, fps: 0, skippedPerSec: 0 };
function sampleRenderRate() {
  const gate = pipeline && pipeline.scene && pipeline.scene.renderGate;
  if (!gate) return renderRate;
  const now = performance.now();
  const dt = (now - renderRate.t) / 1000;
  if (renderRate.t && dt > 0 && gate.rendered >= renderRate.rendered) {
    renderRate.fps = (gate.rendered - renderRate.rendered) / dt;
    renderRate.skippedPerSec = (gate.skipped - renderRate.skipped) / dt;
  }
  renderRate = { ...renderRate, t: now, rendered: gate.rendered, skipped: gate.skipped };
  return renderRate;
}

/** Tracking/perf numbers shown in the ?debug=1 panel. */
function perfDebug(vision) {
  const rr = sampleRenderRate();
  return {
    vision: vision.mode,
    visionFallback: vision.fallbackReason || undefined,
    delegates: vision.delegates,
    trackingFps: r1(trackingLoop ? trackingLoop.resultsPerSecond : 0),
    renderFps: r1(rr.fps),
    renderSkippedPerSec: r1(rr.skippedPerSec),
    droppedFrames: trackingLoop ? trackingLoop.droppedFrames : 0,
    workerDetectMs: vision.lastWorkerMs != null ? r1(vision.lastWorkerMs) : undefined,
    qualityTier: governor.tier.name,
    smooth: SMOOTH,
  };
}

function setStatus(status) {
  if (status !== lastStatus) {
    lastStatus = status;
    statusPill.textContent = status;
  }
}

const isNecklace = category === 'necklace';
const isNose = category === 'nose';
const FACE_IDLE = isNecklace ? 'Show your face and neck to the camera' : 'Show your face to the camera';
const FACE_ACTIVE = isNecklace ? 'Necklace on â€” turn your head to see it'
  : isNose ? 'Nose ring on â€” turn your head to see it'
    : 'Earrings on â€” turn your head to see them';

function frameInput(timestampMs, frame) {
  const rect = overlayCanvas.getBoundingClientRect();
  return {
    source: frame || videoEl,
    sourceWidth: frame ? frame.width : videoEl.videoWidth,
    sourceHeight: frame ? frame.height : videoEl.videoHeight,
    displaySize: { width: rect.width, height: rect.height },
    mirror: currentFacingMode === 'user',
    timestampMs,
  };
}

function handleRingResult({ results, frame }, timestampMs, vision) {
  const info = pipeline.processFrame({ ...frameInput(timestampMs, frame), handResult: results.hand });
  let status = 'Show your hand to the camera';
  if (info.handDetected) {
    status = info.sizing && info.sizing.locked ? 'Ring fitted â€” move freely' : 'Sizing your ringâ€¦';
  }
  setStatus(status);
  updateSizingUi(info);

  if (SHOW_DEBUG_SKELETON && performance.now() - lastDebugLog > 500) {
    lastDebugLog = performance.now();
    const r = (v, d = 2) => r1(v, d);
    logDebug({
      category, sku,
      ...perfDebug(vision),
      skinSegmentation: pipeline.segmentationStatus,
      skinSegmentationError: pipeline.segmentationError,
      sizing: info.sizing && {
        state: info.sizing.state,
        progress: r(info.sizing.progress),
        lockSource: info.sizing.lockSource,
        scaleMode: info.sizing.scaleMode,
        lastRejectReason: info.sizing.lastRejectReason,
      },
      hand3dTrusted: info.worldTrusted,
      hand3dKnuckleSpanMm: r(info.knuckleSpanMm, 0),
      hand: info.hand, backFacing: info.backFacing,
      fingerWidthPx: r(info.fingerWidthPx, 1),
      knuckleWidthPx: r(info.knuckleWidthPx, 1),
      measuredWidthPx: r(info.measuredWidthPx, 1),
      tiltDeg: r(info.tiltDeg, 1),
      handFitResidualMm: r(info.residualMm, 1),
    });
  }
}

let lastPoseResult = null;

function handleFaceResult({ results, frame }, timestampMs, vision) {
  if (results.pose) lastPoseResult = results.pose;
  const info = pipeline.processFrame({
    ...frameInput(timestampMs, frame),
    faceResult: results.face,
    ...(isNecklace ? { poseResult: lastPoseResult } : {}),
  });
  setStatus(info.faceDetected ? FACE_ACTIVE : FACE_IDLE);
  window.__faceInfo = info;
  if (SHOW_DEBUG_SKELETON) window.__faceResult = results.face;

  if (SHOW_DEBUG_SKELETON && performance.now() - lastDebugLog > 500) {
    lastDebugLog = performance.now();
    const r = r1;
    const common = { category, sku, ...perfDebug(vision), faceDetected: info.faceDetected };
    const angles = { yawDeg: r(info.yawDeg), pitchDeg: r(info.pitchDeg), rollDeg: r(info.rollDeg), faceWidthPx: r(info.faceWidthPx) };
    if (isNecklace) {
      logDebug({
        ...common,
        poseDetected: info.poseDetected,
        trackingMode: info.trackingMode,
        landmarks: info.landmarkCount,
        poseLandmarks: info.poseLandmarkCount,
        ...angles,
        necklaceScale: r(info.necklaceScale, 4),
        necklaceVisibility: r(info.necklaceVisibility, 2),
      });
    } else if (isNose) {
      logDebug({
        ...common,
        side: info.side,
        ...angles,
        ringDiameterPx: r(info.ringDiameterPx),
        ringVisibility: r(info.ringVisibility, 2),
      });
    } else {
      logDebug({
        ...common,
        landmarks: info.landmarkCount,
        ...angles,
        earringLengthPx: r(info.earringLengthPx),
        earringLengthMm: EARRING_ENTRY.lengthMm,
      });
    }
  }
}

async function startTracking() {
  if (!VISION_KINDS.length) {
    statusPill.textContent = `Live camera connected (${category} tracking not yet implemented)`;
    return;
  }
  const token = trackingToken;
  const what = category === 'ring' ? 'hand' : isNecklace ? 'face and pose' : 'face';
  modelLoadingIndicator.classList.remove('hidden');
  modelLoadingIndicator.lastChild.textContent = ` Loading ${what} trackingâ€¦`;

  // Tracking models and the jewellery scene load in parallel.
  const next = createPipeline();
  let vision;
  try {
    [vision] = await Promise.all([getVision(), next.init()]);
  } catch (err) {
    next.dispose();
    if (token !== trackingToken) return;
    modelLoadingIndicator.classList.add('hidden');
    statusPill.textContent = `${category === 'ring' ? 'Hand' : 'Face'} tracking failed to load â€” showing camera only`;
    logDebug({ category, sku, trackingLoadError: String(err) });
    return;
  }
  if (token !== trackingToken) { // stopped (camera switch / back) while loading
    next.dispose();
    return;
  }
  pipeline = next;
  if (category === 'ring') pipeline.reset();
  modelLoadingIndicator.classList.add('hidden');
  setStatus(category === 'ring' ? 'Show your hand to the camera' : FACE_IDLE);
  lastPoseResult = null;

  const handle = category === 'ring' ? handleRingResult : handleFaceResult;
  // Ring sizing measures the skin around the landmarks, so it needs the exact
  // frame they came from; face categories only sample lighting from the video.
  const keepFrame = category === 'ring';
  trackingLoop = new TrackingLoop(videoEl, {
    detect: (video, timestampMs, i) => vision.detect(video, timestampMs, kindsForFrame(i), { keepFrame }),
    onResult: (detection, timestampMs) => {
      try {
        handle(detection, timestampMs, vision);
      } finally {
        if (detection.frame) detection.frame.close();
      }
      governor.update(performance.now(), trackingLoop.resultsPerSecond);
    },
    onError: (err) => logDebug({ category, sku, ...perfDebug(vision), trackingError: String((err && err.message) || err) }),
  });
  trackingLoop.start();
  if (SMOOTH) startRenderLoop(pipeline);

  if (SHOW_DEBUG_SKELETON) {
    const SessionRecorder = await loadSessionRecorder();
    if (token !== trackingToken) return;
    recorder = new SessionRecorder({
      videoEl,
      overlayCanvas,
      isMirrored: () => currentFacingMode === 'user',
      pipeline,
      ...(category === 'ring' ? {} : { filePrefix: isNecklace ? 'necklacetryon' : isNose ? 'noseringtryon' : 'earringtryon' }),
    });
    recordBtn.classList.remove('hidden');
  }
}

resizeBtn.addEventListener('click', () => {
  if (pipeline) pipeline.reset();
  updateSizingUi(null);
});

recordBtn.addEventListener('click', async () => {
  if (!recorder || recorder.active) return;
  recordBtn.disabled = true;
  try {
    const res = await recorder.record(10000, (ms) => {
      recordLabel.textContent = `Recordingâ€¦ ${Math.ceil(ms / 1000)}s`;
    });
    recordLabel.textContent = res.videoSaved ? 'Saved (JSON + video)' : 'Saved (JSON)';
  } catch (err) {
    recordLabel.textContent = 'Recording failed';
    logDebug({ recordError: String(err && err.message || err) });
  }
  setTimeout(() => {
    recordLabel.textContent = 'Record 10s';
    recordBtn.disabled = false;
  }, 2500);
});

let renderLoopHandle = null;

/**
 * Smooth mode: renders on requestAnimationFrame (skipped by the scene when
 * nothing moved). Below the 'high' tier at most ~30 renders/s: that is
 * already 2–3× the tracking rate on a budget phone, and rendering every 60 Hz
 * frame there takes GPU time from tracking.
 */
function startRenderLoop(p) {
  stopRenderLoop();
  let last = 0;
  const tick = () => {
    if (pipeline !== p) return; // pipeline replaced or stopped
    renderLoopHandle = requestAnimationFrame(tick);
    const now = performance.now();
    const minGapMs = governor.tier.name === 'high' ? 0 : 1000 / 30 - 4; // 4 ms slack for rAF jitter
    if (now - last < minGapMs) return;
    last = now;
    p.renderFrame(now);
  };
  renderLoopHandle = requestAnimationFrame(tick);
}

function stopRenderLoop() {
  if (renderLoopHandle !== null) cancelAnimationFrame(renderLoopHandle);
  renderLoopHandle = null;
}

function stopTracking() {
  trackingToken++;
  stopRenderLoop();
  if (trackingLoop) {
    trackingLoop.stop();
    trackingLoop = null;
  }
  if (pipeline) {
    pipeline.dispose();
    pipeline = null;
  }
  recorder = null;
  recordBtn.classList.add('hidden');
  updateSizingUi(null);
}

async function initCamera(facingMode = 'user') {
  showView('startingCamera');
  currentFacingMode = facingMode;
  stopTracking();

  const result = await startCamera(videoEl, { facingMode });
  logDebug({ category, sku, cameraResult: { ...result, stream: result.stream ? '[MediaStream]' : null } });

  if (!result.success) {
    document.getElementById('camera-error-message').textContent = result.message;
    showView('cameraError');
    return;
  }

  currentStream = result.stream;
  showView('live');

  const devices = await listVideoInputDevices();
  switchCameraBtn.classList.toggle('hidden', devices.length < 2);

  await startTracking();
}

switchCameraBtn.addEventListener('click', async () => {
  stopCamera(videoEl, currentStream);
  const nextFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  await initCamera(nextFacingMode);
});

document.getElementById('retry-camera-btn').addEventListener('click', () => initCamera(currentFacingMode));
document.getElementById('fallback-btn-error').addEventListener('click', goToFallback);
document.getElementById('fallback-btn-unsupported').addEventListener('click', goToFallback);

function releaseAll() {
  stopTracking();
  disposeVision();
  stopCamera(videoEl, currentStream);
}

document.getElementById('back-btn').addEventListener('click', () => {
  releaseAll();
  history.back();
});

// Release camera + tracking resources on any unload path (tab close,
// swipe-back, etc.), not just the explicit Back button.
window.addEventListener('pagehide', releaseAll);

async function boot() {
  showView('checking');
  const capability = await checkCapability();
  logDebug({ category, sku, capability });

  if (!capability.supported) {
    document.getElementById('unsupported-message').textContent = capability.message;
    showView('unsupported');
    return;
  }

  // Start downloading tracking models and the jewellery model while the
  // camera permission prompt is up, instead of after it.
  if (VISION_KINDS.length) getVision().catch(() => {}); // errors surface in startTracking()
  if (MODEL_URL) fetch(MODEL_URL).catch(() => {});

  await initCamera('user');
}

boot();
