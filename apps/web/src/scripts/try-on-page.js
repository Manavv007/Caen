import { checkCapability } from '@caen/tryon/capability.js';
import { startCamera, stopCamera, listVideoInputDevices } from '@caen/tryon/camera.js';
import {
  loadHandLandmarker,
  disposeHandLandmarker,
  HandTrackingSession,
  getHandLandmarkerDelegate,
} from '@caen/tryon/hand-tracking.js';
import { RingTryOnPipeline } from '@caen/tryon/ring-tryon-pipeline.js';
import {
  loadFaceLandmarker,
  disposeFaceLandmarker,
  FaceTrackingSession,
  getFaceLandmarkerDelegate,
} from '@caen/tryon/face-tracking.js';
import {
  loadPoseLandmarker,
  disposePoseLandmarker,
  PoseTrackingSession,
  getPoseLandmarkerDelegate,
} from '@caen/tryon/pose-tracking.js';
import { FaceTryOnPipeline } from '@caen/tryon/face-tryon-pipeline.js';
import { NecklaceTryOnPipeline } from '@caen/tryon/necklace-tryon-pipeline.js';
import { NoseRingTryOnPipeline } from '@caen/tryon/nose-ring-pipeline.js';
import { setRendererOptions } from '@caen/tryon/three-runtime.js';
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
setRendererOptions({ preserveDrawingBuffer: SHOW_DEBUG_SKELETON });
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
let trackingSession = null;
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
  // Placeholder: Task 10 wires this to the real 360°/static product
  // viewer instead of an alert.
  alert('360° product viewer fallback will be wired up in a later step.');
}

// Face tracking for earrings and necklaces (necklaces also use pose tracking).
async function startFaceTracking() {
  modelLoadingIndicator.classList.remove('hidden');
  modelLoadingIndicator.lastChild.textContent = ' Loading face tracking…';
  try {
    await loadFaceLandmarker();
    
    // Necklaces also load pose tracking for body-anchored placement.
    if (category === 'necklace') {
      modelLoadingIndicator.lastChild.textContent = ' Loading pose tracking…';
      await loadPoseLandmarker();
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
      pipeline = new NecklaceTryOnPipeline({
        overlayCanvas,
        debugCanvas: SHOW_DEBUG_SKELETON ? debugCanvas : null,
        modelUrl: NECKLACE_ENTRY.url,
        lengthMm: NECKLACE_ENTRY.lengthMm,
        neckDown,
        neckX,
        cutBackside,
        cutZ,
      });
    } else if (category === 'nose') {
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
      pipeline = new NoseRingTryOnPipeline({
        overlayCanvas,
        debugCanvas: SHOW_DEBUG_SKELETON ? debugCanvas : null,
        modelUrl: NOSE_RING_ENTRY.url,
        diameterMm: num('noseMm') ?? NOSE_RING_ENTRY.diameterMm,
        side: urlParams.get('side') === 'right' ? 'right' : 'left',
        tiltDeg: num('noseTilt'),
        rollDeg: num('noseRoll'),
        offset,
        drop: num('noseDrop'),
        cutHidden: num('noseCut'),
      });
    } else {
      pipeline = new FaceTryOnPipeline({
        overlayCanvas,
        debugCanvas: SHOW_DEBUG_SKELETON ? debugCanvas : null,
        modelUrl: EARRING_ENTRY.url,
        lengthMm: EARRING_ENTRY.lengthMm,
      });
    }
    await pipeline.init();
  } catch (err) {
    modelLoadingIndicator.classList.add('hidden');
    statusPill.textContent = 'Face tracking failed to load — showing camera only';
    logDebug({ category, sku, faceTrackingLoadError: String(err) });
    return;
  }
  modelLoadingIndicator.classList.add('hidden');

  const isNecklace = category === 'necklace';
  const isNose = category === 'nose';
  const idleMsg = isNecklace ? 'Show your face and neck to the camera' : 'Show your face to the camera';
  const activeMsg = isNecklace ? 'Necklace on — turn your head to see it'
    : isNose ? 'Nose ring on — turn your head to see it'
      : 'Earrings on — turn your head to see them';
  statusPill.textContent = idleMsg;

  // Dual tracking for necklaces: run face + pose in parallel.
  if (isNecklace) {
    let lastFaceResult = null;
    let lastPoseResult = null;
    let lastVideoTime = -1;
    
    const faceSession = new FaceTrackingSession(videoEl, (result) => {
      lastFaceResult = result;
    });
    const poseSession = new PoseTrackingSession(videoEl, (result) => {
      lastPoseResult = result;
    });
    
    faceSession.start();
    poseSession.start();
    
    const loop = () => {
      if (!trackingSession) return;
      if (videoEl.readyState >= 2 && videoEl.currentTime !== lastVideoTime) {
        lastVideoTime = videoEl.currentTime;
        const rect = overlayCanvas.getBoundingClientRect();
        const info = pipeline.processFrame({
          source: videoEl,
          sourceWidth: videoEl.videoWidth,
          sourceHeight: videoEl.videoHeight,
          displaySize: { width: rect.width, height: rect.height },
          faceResult: lastFaceResult,
          poseResult: lastPoseResult,
          mirror: currentFacingMode === 'user',
          timestampMs: performance.now(),
        });
        const status = info.faceDetected ? activeMsg : idleMsg;
        if (status !== lastStatus) {
          lastStatus = status;
          statusPill.textContent = status;
        }
        window.__faceInfo = info;
        if (SHOW_DEBUG_SKELETON) window.__faceResult = lastFaceResult;
        if (SHOW_DEBUG_SKELETON && performance.now() - lastDebugLog > 500) {
          lastDebugLog = performance.now();
          const r = (v, d = 1) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);
          logDebug({
            category, sku,
            faceDelegate: getFaceLandmarkerDelegate(),
            poseDelegate: getPoseLandmarkerDelegate(),
            faceDetected: info.faceDetected,
            poseDetected: info.poseDetected,
            trackingMode: info.trackingMode,
            landmarks: info.landmarkCount,
            poseLandmarks: info.poseLandmarkCount,
            yawDeg: r(info.yawDeg), pitchDeg: r(info.pitchDeg), rollDeg: r(info.rollDeg),
            faceWidthPx: r(info.faceWidthPx),
            necklaceScale: r(info.necklaceScale, 4),
            necklaceVisibility: r(info.necklaceVisibility, 2),
          });
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    
    trackingSession = { stop: () => { faceSession.stop(); poseSession.stop(); trackingSession = null; } };
  } else {
    // Earrings and nose rings: face-only tracking.
    trackingSession = new FaceTrackingSession(videoEl, (result) => {
      const rect = overlayCanvas.getBoundingClientRect();
      const info = pipeline.processFrame({
        source: videoEl,
        sourceWidth: videoEl.videoWidth,
        sourceHeight: videoEl.videoHeight,
        displaySize: { width: rect.width, height: rect.height },
        faceResult: result,
        mirror: currentFacingMode === 'user',
        timestampMs: performance.now(),
      });
      const status = info.faceDetected ? activeMsg : idleMsg;
      if (status !== lastStatus) {
        lastStatus = status;
        statusPill.textContent = status;
      }
      window.__faceInfo = info;
      if (SHOW_DEBUG_SKELETON) window.__faceResult = result;
      if (SHOW_DEBUG_SKELETON && performance.now() - lastDebugLog > 500) {
        lastDebugLog = performance.now();
        const r = (v, d = 1) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);
        if (category === 'nose') {
          logDebug({
            category, sku,
            faceDelegate: getFaceLandmarkerDelegate(),
            faceDetected: info.faceDetected,
            side: info.side,
            yawDeg: r(info.yawDeg), pitchDeg: r(info.pitchDeg), rollDeg: r(info.rollDeg),
            faceWidthPx: r(info.faceWidthPx),
            ringDiameterPx: r(info.ringDiameterPx),
            ringVisibility: r(info.ringVisibility, 2),
          });
          return;
        }
        logDebug({
          category, sku,
          faceDelegate: getFaceLandmarkerDelegate(),
          faceDetected: info.faceDetected,
          landmarks: info.landmarkCount,
          yawDeg: r(info.yawDeg), pitchDeg: r(info.pitchDeg), rollDeg: r(info.rollDeg),
          faceWidthPx: r(info.faceWidthPx),
          earringLengthPx: r(info.earringLengthPx),
          earringLengthMm: EARRING_ENTRY.lengthMm,
        });
      }
    });
    trackingSession.start();
  }

  if (SHOW_DEBUG_SKELETON) {
    const SessionRecorder = await loadSessionRecorder();
    recorder = new SessionRecorder({
      videoEl,
      overlayCanvas,
      isMirrored: () => currentFacingMode === 'user',
      pipeline,
      filePrefix: isNecklace ? 'necklacetryon' : isNose ? 'noseringtryon' : 'earringtryon',
    });
    recordBtn.classList.remove('hidden');
  }
}

// Rings use hand tracking; earrings and necklaces use face tracking.
async function startTrackingForCategory() {
  if (FACE_CATEGORIES.includes(category)) {
    await startFaceTracking();
    return;
  }
  if (category !== 'ring') {
    statusPill.textContent = `Live camera connected (${category} tracking not yet implemented)`;
    return;
  }

  modelLoadingIndicator.classList.remove('hidden');
  try {
    await loadHandLandmarker();
    pipeline = new RingTryOnPipeline({
      overlayCanvas,
      debugCanvas: SHOW_DEBUG_SKELETON ? debugCanvas : null,
      modelUrl: RING_MODEL_URL,
    });
    await pipeline.init();
  } catch (err) {
    modelLoadingIndicator.classList.add('hidden');
    statusPill.textContent = 'Hand tracking failed to load — showing camera only';
    logDebug({ category, sku, handTrackingLoadError: String(err) });
    return;
  }
  modelLoadingIndicator.classList.add('hidden');
  statusPill.textContent = 'Show your hand to the camera';
  pipeline.reset();

  trackingSession = new HandTrackingSession(videoEl, (result) => {
    const rect = overlayCanvas.getBoundingClientRect();
    const info = pipeline.processFrame({
      source: videoEl,
      sourceWidth: videoEl.videoWidth,
      sourceHeight: videoEl.videoHeight,
      displaySize: { width: rect.width, height: rect.height },
      handResult: result,
      mirror: currentFacingMode === 'user',
      timestampMs: performance.now(),
    });

    let status = 'Show your hand to the camera';
    if (info.handDetected) {
      status = info.sizing && info.sizing.locked ? 'Ring fitted — move freely' : 'Sizing your ring…';
    }
    if (status !== lastStatus) {
      lastStatus = status;
      statusPill.textContent = status;
    }
    updateSizingUi(info);

    if (SHOW_DEBUG_SKELETON && performance.now() - lastDebugLog > 500) {
      lastDebugLog = performance.now();
      const r = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);
      logDebug({
        category, sku,
        handDelegate: getHandLandmarkerDelegate(),
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
  });
  trackingSession.start();

  if (SHOW_DEBUG_SKELETON) {
    const SessionRecorder = await loadSessionRecorder();
    recorder = new SessionRecorder({
      videoEl,
      overlayCanvas,
      isMirrored: () => currentFacingMode === 'user',
      pipeline,
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
      recordLabel.textContent = `Recording… ${Math.ceil(ms / 1000)}s`;
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

function stopTracking() {
  if (trackingSession) {
    trackingSession.stop();
    trackingSession = null;
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

  await startTrackingForCategory();
}

switchCameraBtn.addEventListener('click', async () => {
  stopCamera(videoEl, currentStream);
  const nextFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  await initCamera(nextFacingMode);
});

document.getElementById('retry-camera-btn').addEventListener('click', () => initCamera(currentFacingMode));
document.getElementById('fallback-btn-error').addEventListener('click', goToFallback);
document.getElementById('fallback-btn-unsupported').addEventListener('click', goToFallback);

document.getElementById('back-btn').addEventListener('click', () => {
  stopTracking();
  disposeHandLandmarker();
  disposeFaceLandmarker();
  disposePoseLandmarker();
  stopCamera(videoEl, currentStream);
  history.back();
});

// Release camera + tracking resources on any unload path (tab close,
// swipe-back, etc.), not just the explicit Back button.
window.addEventListener('pagehide', () => {
  stopTracking();
  disposeHandLandmarker();
  disposeFaceLandmarker();
  disposePoseLandmarker();
  stopCamera(videoEl, currentStream);
});

async function boot() {
  showView('checking');
  const capability = await checkCapability();
  logDebug({ category, sku, capability });

  if (!capability.supported) {
    document.getElementById('unsupported-message').textContent = capability.message;
    showView('unsupported');
    return;
  }

  await initCamera('user');
}

boot();
