/**
 * camera.js
 *
 * Manages the live camera stream for the try-on experience:
 * requesting permission, starting/stopping the stream, attaching it to a
 * <video> element, and surfacing clear, distinct error states instead of
 * failing silently.
 *
 * This module does NOT do any capability pre-checking — that's
 * capability.js's job, and should run before this module is used.
 * This module is the actual `getUserMedia` call, which is also the
 * real permission prompt trigger.
 *
 * Usage:
 *   import { startCamera, stopCamera, CAMERA_ERRORS } from './camera.js';
 *   const result = await startCamera(videoEl, { facingMode: 'user' });
 *   if (!result.success) {
 *     showError(result.errorCode, result.message);
 *   }
 */

export const CAMERA_ERRORS = {
  PERMISSION_DENIED: 'permission_denied',
  NO_CAMERA_FOUND: 'no_camera_found',
  CAMERA_IN_USE: 'camera_in_use',
  CONSTRAINTS_NOT_SATISFIED: 'constraints_not_satisfied',
  INSECURE_OR_UNSUPPORTED: 'insecure_or_unsupported',
  UNKNOWN: 'unknown',
};

const ERROR_MESSAGES = {
  [CAMERA_ERRORS.PERMISSION_DENIED]:
    'Camera access was denied. Please allow camera access in your browser settings and try again.',
  [CAMERA_ERRORS.NO_CAMERA_FOUND]:
    'No camera could be found on this device.',
  [CAMERA_ERRORS.CAMERA_IN_USE]:
    'Your camera seems to be in use by another app. Please close other apps using the camera and try again.',
  [CAMERA_ERRORS.CONSTRAINTS_NOT_SATISFIED]:
    'Your camera does not support the required settings. Try switching cameras if your device has more than one.',
  [CAMERA_ERRORS.INSECURE_OR_UNSUPPORTED]:
    'Camera access is not available. Please make sure the page is loaded over HTTPS and try a recent browser.',
  [CAMERA_ERRORS.UNKNOWN]:
    'Something went wrong while starting the camera. Please try again.',
};

/**
 * Maps a DOMException/getUserMedia error name to our internal error code.
 * See: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#exceptions
 */
function mapErrorNameToCode(err) {
  const name = err && err.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return CAMERA_ERRORS.PERMISSION_DENIED;
    case 'NotFoundError':
      return CAMERA_ERRORS.NO_CAMERA_FOUND;
    case 'NotReadableError':
    case 'TrackStartError':
      return CAMERA_ERRORS.CAMERA_IN_USE;
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return CAMERA_ERRORS.CONSTRAINTS_NOT_SATISFIED;
    case 'TypeError':
      return CAMERA_ERRORS.INSECURE_OR_UNSUPPORTED;
    default:
      return CAMERA_ERRORS.UNKNOWN;
  }
}

/**
 * @typedef {Object} CameraStartResult
 * @property {boolean} success
 * @property {MediaStream|null} stream
 * @property {string|null} errorCode
 * @property {string|null} message
 */

/**
 * Requests camera access and attaches the resulting stream to the given
 * <video> element. Triggers the browser's native permission prompt.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {Object} [options]
 * @param {'user'|'environment'} [options.facingMode='user'] - front vs back camera
 * @param {number} [options.idealWidth=1280]
 * @param {number} [options.idealHeight=720]
 * @returns {Promise<CameraStartResult>}
 */
export async function startCamera(videoEl, options = {}) {
  const {
    facingMode = 'user',
    idealWidth = 1280,
    idealHeight = 720,
  } = options;

  if (!videoEl || typeof videoEl.play !== 'function') {
    return {
      success: false,
      stream: null,
      errorCode: CAMERA_ERRORS.UNKNOWN,
      message: 'Internal error: no valid <video> element was provided.',
    };
  }

  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return {
      success: false,
      stream: null,
      errorCode: CAMERA_ERRORS.INSECURE_OR_UNSUPPORTED,
      message: ERROR_MESSAGES[CAMERA_ERRORS.INSECURE_OR_UNSUPPORTED],
    };
  }

  const constraints = {
    audio: false,
    video: {
      facingMode,
      width: { ideal: idealWidth },
      height: { ideal: idealHeight },
    },
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    videoEl.srcObject = stream;
    videoEl.playsInline = true; // required on iOS Safari to avoid fullscreen takeover
    videoEl.muted = true;

    // A mirrored front camera feels natural (like a mirror); the back
    // camera should not be mirrored. Left to the caller's CSS normally,
    // but we tag it here via a data attribute so callers can style off it.
    videoEl.dataset.facingMode = facingMode;

    await videoEl.play();

    return { success: true, stream, errorCode: null, message: null };
  } catch (err) {
    const errorCode = mapErrorNameToCode(err);
    return {
      success: false,
      stream: null,
      errorCode,
      message: ERROR_MESSAGES[errorCode] || ERROR_MESSAGES[CAMERA_ERRORS.UNKNOWN],
    };
  }
}

/**
 * Stops all tracks on a stream and detaches it from the video element.
 * Always call this when leaving the try-on view to release the camera
 * (otherwise the camera indicator stays on and the device stays locked).
 *
 * @param {HTMLVideoElement} videoEl
 * @param {MediaStream|null} stream
 */
export function stopCamera(videoEl, stream) {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  if (videoEl) {
    videoEl.pause();
    videoEl.srcObject = null;
  }
}

/**
 * Lists available video input devices. Labels are only populated after
 * permission has been granted at least once (browser privacy behavior).
 * Useful for building a camera-switch control on devices with multiple
 * cameras.
 *
 * @returns {Promise<MediaDeviceInfo[]>}
 */
export async function listVideoInputDevices() {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.enumerateDevices !== 'function'
  ) {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  } catch (err) {
    return [];
  }
}
