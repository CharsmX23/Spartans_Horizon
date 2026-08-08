import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, X, RefreshCw, Upload } from 'lucide-react';

/**
 * Live camera capture for proof photos — the second way into the existing verification
 * flow, alongside picking a file. What comes out is a `File`, identical in kind to one the
 * file picker would hand back, so everything downstream (validation, preview, verify-proof,
 * the streak write) is untouched and cannot tell the two apart.
 *
 * ── Why getUserMedia and not only `<input capture>` ───────────────────────────
 * `<input type="file" accept="image/*" capture="user">` is one line and opens the camera
 * app on a phone — but on a laptop it degrades to an ordinary file picker, which is the
 * case this was added for. So the live stream is the primary path and the capture input is
 * the fallback, offered whenever the stream cannot be opened.
 *
 * ── The two failures that actually happen ─────────────────────────────────────
 * 1. Permission denied. Common, recoverable, and the message has to say the browser is
 *    holding the block — retrying in-page does nothing until the site permission changes.
 * 2. No secure context. `navigator.mediaDevices` is undefined on plain http from anything
 *    that is not localhost, so testing on a phone over the LAN (http://192.168.x.x:5173)
 *    silently has no camera API at all. That is a confusing enough failure to name
 *    explicitly rather than report as "camera unavailable".
 *
 * The stream is stopped on unmount and on every exit path. A live camera light left on
 * after the panel closes reads as a bug even when nothing is being recorded — and nothing
 * ever is: no frame leaves this component except the one still the user presses for.
 */

/** Long edge of the captured still. Keeps a 4K webcam well inside the 5 MB proof limit. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.9;

type Phase =
  | { state: 'starting' }
  | { state: 'live' }
  | { state: 'denied' }
  | { state: 'insecure' }
  | { state: 'error'; message: string };

interface Props {
  accent: string;
  /** Receives the still. The caller treats it exactly as a picked file. */
  onCapture: (file: File) => void;
  onCancel: () => void;
  /** Opens the caller's file picker — offered when the live stream cannot start. */
  onUseUpload: () => void;
}

export default function CameraCapture({ accent, onCapture, onCancel, onUseUpload }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>({ state: 'starting' });

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setPhase({ state: 'starting' });

    // Undefined rather than throwing, on http from a non-localhost origin. Checked before
    // the call so the message can name the actual cause.
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setPhase({ state: 'insecure' });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // `facingMode` is a hint, not a guarantee — a laptop has one camera and gives you
        // that one. Not `exact`, which would fail outright on a device with no front
        // camera rather than falling back to the camera it does have.
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // iOS Safari will not autoplay without this having already been set in the markup;
        // the call is here for the browsers that need the explicit nudge.
        await videoRef.current.play().catch(() => {});
      }
      setPhase({ state: 'live' });
    } catch (e: unknown) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPhase({ state: 'denied' });
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setPhase({ state: 'error', message: 'No camera found on this device.' });
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setPhase({ state: 'error', message: 'Your camera is already in use by another app.' });
      } else {
        setPhase({
          state: 'error',
          message: e instanceof Error && e.message ? e.message : 'Could not start the camera.',
        });
      }
    }
  }, []);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setPhase({ state: 'error', message: 'The camera has not produced a frame yet — try again.' });
      return;
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setPhase({ state: 'error', message: 'This browser could not process the frame.' });
      return;
    }

    // Drawn unmirrored on purpose. The preview below is flipped because an unmirrored
    // selfie view feels wrong to move in front of — but the saved frame is what Gemini
    // judges, and mirroring it would reverse any text in shot, which is exactly the
    // evidence a proof photo usually turns on.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setPhase({ state: 'error', message: 'Could not read the captured frame.' });
          return;
        }
        stop();
        onCapture(new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  }

  const failed = phase.state === 'denied' || phase.state === 'insecure' || phase.state === 'error';

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {!failed && (
        <div style={{
          width: '100%', borderRadius: 12, overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.12)', background: '#000',
          position: 'relative', minHeight: 200,
        }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%', maxHeight: 300, objectFit: 'cover', display: 'block',
              transform: 'scaleX(-1)',
            }}
          />
          {phase.state === 'starting' && (
            <div style={{
              position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
              color: 'rgba(255,255,255,0.6)', fontSize: 13,
            }}>
              Waiting for camera…
            </div>
          )}
        </div>
      )}

      {failed && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Camera className="w-9 h-9" style={{ color: 'rgba(255,255,255,0.35)' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
            {phase.state === 'denied'
              ? 'Camera access blocked'
              : phase.state === 'insecure'
              ? 'Camera needs a secure connection'
              : 'Camera unavailable'}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', maxWidth: 380, lineHeight: 1.5 }}>
            {phase.state === 'denied'
              ? 'Your browser is blocking the camera for this site. Allow it in the address-bar '
                + 'permissions, then try again — or upload a photo instead.'
              : phase.state === 'insecure'
              ? 'Browsers only expose the camera over HTTPS or on localhost. If you opened this '
                + 'over the network by IP, upload a photo instead.'
              : phase.state === 'error'
              ? phase.message
              : ''}
          </div>

          {/* The `<input capture>` fallback lives on the caller's picker: on a phone the
              OS camera app opens from it, which is the whole point of offering it here. */}
          <div className="flex gap-2 flex-wrap justify-center">
            <button
              onClick={onUseUpload}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition hover:brightness-110 flex items-center gap-2"
              style={{ background: accent }}
            >
              <Upload className="w-4 h-4" /> Upload a photo
            </button>
            {phase.state !== 'insecure' && (
              <button
                onClick={() => void start()}
                className="px-4 py-2 rounded-lg text-sm text-white/70 hover:text-white transition flex items-center gap-2"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Try again
              </button>
            )}
            <button
              onClick={() => { stop(); onCancel(); }}
              className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white transition"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!failed && (
        <div className="flex gap-3">
          <button
            onClick={() => { stop(); onCancel(); }}
            className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white transition flex items-center gap-2"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
          <button
            onClick={capture}
            disabled={phase.state !== 'live'}
            className="px-6 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-2 transition hover:opacity-90 disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${accent}, ${accent}bb)` }}
          >
            <Camera className="w-4 h-4" /> Capture
          </button>
        </div>
      )}
    </div>
  );
}
