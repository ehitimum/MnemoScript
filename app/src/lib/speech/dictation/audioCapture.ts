/**
 * Microphone capture for offline dictation. Kept tiny on purpose: the VAD
 * (`@ricky0123/vad-web`) owns the AudioContext/worklet and just asks us for a
 * MediaStream via its `getStream` option, so this is where we inject the
 * browser-level denoise constraints (stage ① of the gatekeeper).
 */

export interface CaptureOptions {
  /** Enable the browser's noise-suppression / echo-cancellation / AGC DSP. */
  denoise: boolean;
}

export function isMicSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

export async function getMicStream({ denoise }: CaptureOptions): Promise<MediaStream> {
  if (!isMicSupported()) {
    throw new DOMException('Microphone capture is not available on this device.', 'NotSupportedError');
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      noiseSuppression: denoise,
      echoCancellation: denoise,
      autoGainControl: denoise,
    },
    video: false,
  });
}

/** Turn a getUserMedia / capture error into a short, user-facing message. */
export function humanizeMicError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone permission was denied. Enable it for the app and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found on this device.';
    case 'NotReadableError':
      return 'The microphone is already in use by another app.';
    case 'NotSupportedError':
      return 'Dictation is not available on this device’s WebView.';
    default:
      return 'Could not start dictation. Please try again.';
  }
}
