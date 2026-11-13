/**
 * capability.js
 *
 * Detects whether the current browser/device can run the camera-based
 * AR try-on experience. Every check is done defensively (feature detection,
 * not user-agent sniffing) so we degrade gracefully instead of crashing.
 *
 * Usage:
 *   import { checkCapability } from './capability.js';
 *   const result = await checkCapability();
 *   if (!result.supported) {
 *     showFallback(result.reason);
 *   }
 */

/**
 * @typedef {Object} CapabilityResult
 * @property {boolean} supported - true if try-on can run
 * @property {string|null} reason - machine-readable reason code when unsupported
 * @property {string|null} message - human-readable message safe to show to the user
 * @property {Object} details - individual check results, useful for debugging/telemetry
 */

const REASONS = {
  NO_MEDIA_DEVICES: 'no_media_devices',
  NO_CAMERA: 'no_camera',
  CAMERA_PERMISSION_UNKNOWN_BLOCKED: 'camera_permission_blocked',
  NO_WEBGL: 'no_webgl',
  NO_WASM: 'no_wasm',
  INSECURE_CONTEXT: 'insecure_context',
};

const MESSAGES = {
  [REASONS.NO_MEDIA_DEVICES]:
    'Your browser does not support camera access. Please try a recent version of Chrome, Safari, or Edge.',
  [REASONS.NO_CAMERA]:
    'No camera was found on this device. You can still explore the product using our 360° viewer.',
  [REASONS.CAMERA_PERMISSION_UNKNOWN_BLOCKED]:
    'Camera access appears to be blocked. Please check your browser permissions and try again.',
  [REASONS.NO_WEBGL]:
    'Your browser does not support the 3D graphics needed for try-on. Please try a recent version of Chrome, Safari, or Edge.',
  [REASONS.NO_WASM]:
    'Your browser does not support a required feature (WebAssembly) for try-on.',
  [REASONS.INSECURE_CONTEXT]:
    'Try-on requires a secure connection (HTTPS). Please reload the page over HTTPS.',
};

/**
 * Checks whether the page is running in a secure context.
 * getUserMedia is only available on HTTPS (or localhost) in modern browsers.
 */
function checkSecureContext() {
  // window.isSecureContext is the standard, reliable check.
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

/**
 * Checks for basic MediaDevices / getUserMedia support.
 */
function checkMediaDevicesApi() {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/**
 * Checks whether at least one video input device (camera) is present.
 * Note: enumerateDevices() may return devices with empty labels before
 * permission is granted, but the device count itself is still reliable.
 */
async function checkHasCamera() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
    return { hasCamera: false, checked: false };
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasCamera = devices.some((d) => d.kind === 'videoinput');
    return { hasCamera, checked: true };
  } catch (err) {
    // enumerateDevices failing isn't itself fatal — we fall back to
    // "unknown" and let the actual getUserMedia call be the source of truth.
    return { hasCamera: false, checked: false, error: err && err.message };
  }
}

/**
 * Checks for WebGL support, required by the Three.js renderer.
 */
function checkWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    return !!gl;
  } catch (err) {
    return false;
  }
}

/**
 * Checks for WebAssembly support, required by MediaPipe Tasks Vision.
 */
function checkWasm() {
  try {
    return (
      typeof WebAssembly === 'object' &&
      typeof WebAssembly.instantiate === 'function'
    );
  } catch (err) {
    return false;
  }
}

/**
 * Runs the full capability check. Does NOT itself request camera
 * permission (that happens later, explicitly, when the user opts in) —
 * this only checks whether the browser/device *could* support try-on.
 *
 * @returns {Promise<CapabilityResult>}
 */
export async function checkCapability() {
  const details = {
    secureContext: checkSecureContext(),
    mediaDevicesApi: checkMediaDevicesApi(),
    webgl: checkWebGL(),
    wasm: checkWasm(),
  };

  // Secure context first — nothing else works without it.
  if (!details.secureContext) {
    return {
      supported: false,
      reason: REASONS.INSECURE_CONTEXT,
      message: MESSAGES[REASONS.INSECURE_CONTEXT],
      details,
    };
  }

  if (!details.mediaDevicesApi) {
    return {
      supported: false,
      reason: REASONS.NO_MEDIA_DEVICES,
      message: MESSAGES[REASONS.NO_MEDIA_DEVICES],
      details,
    };
  }

  if (!details.wasm) {
    return {
      supported: false,
      reason: REASONS.NO_WASM,
      message: MESSAGES[REASONS.NO_WASM],
      details,
    };
  }

  if (!details.webgl) {
    return {
      supported: false,
      reason: REASONS.NO_WEBGL,
      message: MESSAGES[REASONS.NO_WEBGL],
      details,
    };
  }

  const cameraCheck = await checkHasCamera();
  details.camera = cameraCheck;

  if (cameraCheck.checked && !cameraCheck.hasCamera) {
    return {
      supported: false,
      reason: REASONS.NO_CAMERA,
      message: MESSAGES[REASONS.NO_CAMERA],
      details,
    };
  }

  // All checks passed (or were inconclusive but not negative, e.g. camera
  // presence couldn't be enumerated — we let the real getUserMedia call
  // in the next step be the final word on that).
  return {
    supported: true,
    reason: null,
    message: null,
    details,
  };
}

export { REASONS as CAPABILITY_REASONS };
