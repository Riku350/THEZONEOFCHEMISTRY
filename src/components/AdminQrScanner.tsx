import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  LogOut as ExitIcon,
  QrCode,
  RefreshCw,
  Search,
  SwitchCamera,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import {
  formatIstDisplayDate,
  formatIstShortTime,
  formatIstTime,
  getSyncedServerIstNow,
  syncServerIstOffset,
} from '../lib/attendanceUtils';
import { CameraFacing, FastQrCameraEngine } from '../lib/fastQrEngine';
import {
  QrAttendanceResult,
  recordQrAttendanceTransaction,
} from '../lib/firestoreService';
import {
  AttendanceRecord,
  BatchItem,
  InstituteSettings,
  ScanHistoryEntry,
  StudentRecord,
} from '../types';
import { ResolvedImage } from './ResolvedImage';

interface AdminQrScannerProps {
  adminEmail: string;
  batches: BatchItem[];
  students?: StudentRecord[];
  attendance: AttendanceRecord[];
  scanHistory: ScanHistoryEntry[];
  settings: InstituteSettings;
  onToggleExitTracking: (enabled: boolean) => Promise<void>;
}

interface CameraErrorState {
  title: string;
  detail: string;
  isPermissionDenied: boolean;
}

const SAME_CODE_COOLDOWN_MS = 2200;
const OVERLAY_AUTO_HIDE_MS = 2600;

interface CameraViewportProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraActive: boolean;
  cameraStarting: boolean;
  cameraError: CameraErrorState | null;
  facingMode: CameraFacing;
  overlayResult: QrAttendanceResult | null;
  pendingCount: number;
  onRestartCamera: () => void;
}

/**
 * Isolated memoized video viewport:
 * Keeps the live <video> element stably mounted so result updates and session feed
 * renders NEVER remount, flicker, or interrupt the continuous 720p QR camera stream.
 */
const CameraVideoViewport = React.memo<CameraViewportProps>(
  ({
    videoRef,
    cameraActive,
    cameraStarting,
    cameraError,
    facingMode,
    overlayResult,
    pendingCount,
    onRestartCamera,
  }) => {
    const overlayStyle = useMemo(() => {
      if (!overlayResult) return null;
      if (
        overlayResult.outcome === 'MARKED_PRESENT' ||
        overlayResult.outcome === 'EXIT_RECORDED'
      ) {
        return {
          container: 'bg-emerald-600/95 border-emerald-300/60 text-white',
          subtext: 'text-emerald-50',
          icon: <CheckCircle2 className="w-4 h-4 text-white shrink-0" />,
        };
      }
      if (overlayResult.outcome === 'ALREADY_PRESENT') {
        return {
          container: 'bg-amber-500/95 border-amber-200/70 text-white',
          subtext: 'text-amber-50',
          icon: <Clock className="w-4 h-4 text-white shrink-0" />,
        };
      }
      return {
        container: 'bg-red-600/95 border-red-300/60 text-white',
        subtext: 'text-red-50',
        icon: <XCircle className="w-4 h-4 text-white shrink-0" />,
      };
    }, [overlayResult]);

    return (
      <div className="relative rounded-xl overflow-hidden bg-gray-950 border border-gray-200 aspect-[4/3] min-h-[260px] flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${
            facingMode === 'user' ? 'scale-x-[-1]' : ''
          } ${cameraActive ? 'opacity-100' : 'opacity-0'}`}
        />

        {/* Crisp static corner viewfinder — zero heavy animations or CPU cost */}
        {cameraActive && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative w-52 h-52 sm:w-56 sm:h-56">
              <span className="absolute top-0 left-0 w-7 h-7 border-t-3 border-l-3 border-white/90 rounded-tl-xl" />
              <span className="absolute top-0 right-0 w-7 h-7 border-t-3 border-r-3 border-white/90 rounded-tr-xl" />
              <span className="absolute bottom-0 left-0 w-7 h-7 border-b-3 border-l-3 border-white/90 rounded-bl-xl" />
              <span className="absolute bottom-0 right-0 w-7 h-7 border-b-3 border-r-3 border-white/90 rounded-br-xl" />
            </div>
          </div>
        )}

        {/* Tiny non-blocking indicator when slow network has pending commit(s) */}
        {cameraActive && pendingCount > 0 && (
          <div className="pointer-events-none absolute top-2.5 right-2.5 rounded-lg bg-gray-900/75 px-2.5 py-1 text-[11px] font-medium text-white flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            Verifying{pendingCount > 1 ? ` (${pendingCount})` : ''}
          </div>
        )}

        {/* Small Auto-Disappearing Scan Result Overlay — camera keeps scanning underneath */}
        {overlayResult && overlayStyle && (
          <div
            role="status"
            aria-live="polite"
            className={`pointer-events-none absolute inset-x-2.5 bottom-2.5 rounded-xl border px-3 py-2.5 shadow-lg ${overlayStyle.container}`}
          >
            <div className="flex items-center gap-2.5">
              {overlayResult.student ? (
                <div className="w-10 h-12 rounded-lg overflow-hidden border border-white/40 bg-white/15 shrink-0">
                  <ResolvedImage
                    url={overlayResult.student.photoUrl}
                    mediaId={overlayResult.student.photoMediaId}
                    isPrivate
                    alt={overlayResult.student.studentName}
                    className="w-full h-full object-cover"
                    fallbackLabel={overlayResult.student.studentName}
                  />
                </div>
              ) : (
                <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
                  {overlayStyle.icon}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {overlayStyle.icon}
                  <p className="text-xs sm:text-[13px] font-bold truncate leading-tight">
                    {overlayResult.title}
                  </p>
                </div>
                {overlayResult.student ? (
                  <>
                    <p className="text-xs font-semibold truncate mt-0.5">
                      {overlayResult.student.studentName}
                    </p>
                    <p className={`text-[11px] font-mono truncate ${overlayStyle.subtext}`}>
                      {overlayResult.student.studentId} ·{' '}
                      {overlayResult.exitTimeLabel
                        ? `Exit ${overlayResult.exitTimeLabel}`
                        : overlayResult.entryTimeLabel || overlayResult.timeLabel}
                    </p>
                  </>
                ) : (
                  <p className={`text-[11px] truncate mt-0.5 ${overlayStyle.subtext}`}>
                    {overlayResult.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Idle / Starting / Error Overlay when camera is not active */}
        {!cameraActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center bg-gray-50">
            <div className="w-11 h-11 rounded-2xl bg-violet-50 border border-violet-100 text-violet-600 flex items-center justify-center mb-2.5">
              {cameraStarting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : cameraError ? (
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              ) : (
                <QrCode className="w-5 h-5" />
              )}
            </div>
            <p className="text-sm font-semibold text-gray-900">
              {cameraStarting
                ? 'Starting Rear Camera...'
                : cameraError
                ? cameraError.title
                : 'Camera Paused'}
            </p>
            <p className="mt-1 text-xs text-gray-500 max-w-xs leading-relaxed">
              {cameraStarting
                ? 'Preparing instant 720p continuous QR scanner.'
                : cameraError
                ? cameraError.detail
                : 'Tap Restart Camera to resume continuous student QR scanning.'}
            </p>
            {!cameraStarting && (
              <button
                type="button"
                onClick={onRestartCamera}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Restart Camera
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
);
CameraVideoViewport.displayName = 'CameraVideoViewport';

export const AdminQrScanner: React.FC<AdminQrScannerProps> = ({
  adminEmail,
  batches,
  students,
  attendance,
  scanHistory,
  settings,
  onToggleExitTracking,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<FastQrCameraEngine | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const overlayTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const cameraWantedRef = useRef(true);
  const facingRef = useRef<CameraFacing>('environment');

  // Per-QR concurrency & cooldown maps (allows Student 1 -> Student 2 -> ... -> Student 20 with 0 wait)
  const inFlightCodesRef = useRef<Map<string, number>>(new Map());
  const recentCodesRef = useRef<Map<string, number>>(new Map());
  const activeRequestsRef = useRef(0);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(true);
  const [facingMode, setFacingMode] = useState<CameraFacing>('environment');
  const [cameraError, setCameraError] = useState<CameraErrorState | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [exitToggleBusy, setExitToggleBusy] = useState(false);
  const [overlayResult, setOverlayResult] = useState<QrAttendanceResult | null>(null);
  const [latestResult, setLatestResult] = useState<QrAttendanceResult | null>(null);
  const [sessionFeed, setSessionFeed] = useState<QrAttendanceResult[]>([]);
  const [manualInput, setManualInput] = useState('');

  // Mutable refs for live callback access without ever restarting the camera stream
  const batchesRef = useRef(batches);
  const exitTrackingRef = useRef(Boolean(settings.attendanceExitTracking));
  const soundRef = useRef(soundEnabled);
  const studentBatchHintMapRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    batchesRef.current = batches;
  }, [batches]);

  useEffect(() => {
    exitTrackingRef.current = Boolean(settings.attendanceExitTracking);
  }, [settings.attendanceExitTracking]);

  useEffect(() => {
    soundRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    const map = new Map<string, string>();
    if (students) {
      for (const s of students) {
        if (s.studentId && s.batch) {
          map.set(s.studentId, s.batch);
        }
      }
    }
    studentBatchHintMapRef.current = map;
  }, [students]);

  const playFeedbackTone = useCallback((kind: 'success' | 'info' | 'error') => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (kind === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1174.66, now + 0.06);
        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.17);
      } else if (kind === 'info') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(622.25, now);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.start(now);
        osc.stop(now + 0.15);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.setValueAtTime(175, now + 0.08);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.21);
      }
    } catch {
      // Optional audio feedback
    }
  }, []);

  const showTemporaryOverlay = useCallback((res: QrAttendanceResult) => {
    if (overlayTimerRef.current !== null) {
      window.clearTimeout(overlayTimerRef.current);
    }
    setOverlayResult(res);
    overlayTimerRef.current = window.setTimeout(() => {
      overlayTimerRef.current = null;
      if (mountedRef.current) {
        setOverlayResult(null);
      }
    }, OVERLAY_AUTO_HIDE_MS);
  }, []);

  /**
   * Non-blocking per-code QR processor:
   * - Same QR code is deduplicated while in-flight and for 2.2s after scan
   * - Different students scan immediately in parallel without waiting on earlier commits
   * - Never fakes success: green confirmation appears ONLY after Firebase transaction commits
   */
  const processScannedCode = useCallback(
    async (decodedText: string, bypassCooldown = false) => {
      const normalized = decodedText.trim();
      if (!normalized) return;

      const canonicalKey = normalized.startsWith('ZOC:')
        ? normalized.slice(4).trim().toUpperCase()
        : normalized.toUpperCase();

      const now = Date.now();
      if (inFlightCodesRef.current.has(canonicalKey)) {
        return;
      }
      if (!bypassCooldown) {
        const lastAt = recentCodesRef.current.get(canonicalKey);
        if (lastAt !== undefined && now - lastAt < SAME_CODE_COOLDOWN_MS) {
          return;
        }
      }

      // Periodically prune expired cooldown entries to keep memory O(1)
      if (recentCodesRef.current.size > 40) {
        for (const [k, ts] of recentCodesRef.current.entries()) {
          if (now - ts > SAME_CODE_COOLDOWN_MS * 2) {
            recentCodesRef.current.delete(k);
          }
        }
      }

      inFlightCodesRef.current.set(canonicalKey, now);
      recentCodesRef.current.set(canonicalKey, now);
      activeRequestsRef.current += 1;
      if (mountedRef.current) setPendingCount(activeRequestsRef.current);

      try {
        const res = await recordQrAttendanceTransaction(
          normalized,
          batchesRef.current,
          adminEmail,
          exitTrackingRef.current,
          studentBatchHintMapRef.current
        );
        if (!mountedRef.current) return;

        // Refresh cooldown anchor after completion so lingering card in frame doesn't double-fire
        recentCodesRef.current.set(canonicalKey, Date.now());

        showTemporaryOverlay(res);
        setLatestResult(res);
        setSessionFeed((prev) => [res, ...prev].slice(0, 20));

        if (soundRef.current) {
          if (res.outcome === 'MARKED_PRESENT' || res.outcome === 'EXIT_RECORDED') {
            playFeedbackTone('success');
          } else if (res.outcome === 'ALREADY_PRESENT') {
            playFeedbackTone('info');
          } else {
            playFeedbackTone('error');
          }
        }
      } catch (err) {
        console.error('Automatic QR attendance error:', err);
        const nowIst = getSyncedServerIstNow();
        const fallbackRes: QrAttendanceResult = {
          outcome: 'REJECTED_INVALID',
          title: 'Network / Database Error',
          message:
            err instanceof Error
              ? err.message
              : 'Could not reach Firebase. Check internet connection and re-scan.',
          scannedCode: normalized,
          attendanceDate: nowIst.date,
          timeLabel: `${nowIst.time} IST`,
        };
        // Allow immediate retry after transient network error
        recentCodesRef.current.delete(canonicalKey);
        if (mountedRef.current) {
          showTemporaryOverlay(fallbackRes);
          setLatestResult(fallbackRes);
          setSessionFeed((prev) => [fallbackRes, ...prev].slice(0, 20));
          if (soundRef.current) playFeedbackTone('error');
        }
      } finally {
        inFlightCodesRef.current.delete(canonicalKey);
        activeRequestsRef.current = Math.max(0, activeRequestsRef.current - 1);
        if (mountedRef.current) setPendingCount(activeRequestsRef.current);
      }
    },
    [adminEmail, playFeedbackTone, showTemporaryOverlay]
  );

  const stopCamera = useCallback((userInitiated = false) => {
    if (userInitiated) {
      cameraWantedRef.current = false;
    }
    engineRef.current?.stop();
    if (mountedRef.current) {
      setCameraActive(false);
      setCameraStarting(false);
    }
  }, []);

  const startCamera = useCallback(
    async (targetFacing: CameraFacing) => {
      if (!mountedRef.current) return;
      const videoEl = videoRef.current;
      if (!videoEl) return;

      cameraWantedRef.current = true;
      facingRef.current = targetFacing;
      setCameraError(null);
      setCameraStarting(true);

      if (!engineRef.current) {
        engineRef.current = new FastQrCameraEngine();
      }

      try {
        await engineRef.current.start({
          videoEl,
          facingMode: targetFacing,
          onDetect: (rawCode) => {
            void processScannedCode(rawCode, false);
          },
          onInterrupted: (reason) => {
            if (!mountedRef.current) return;
            setCameraActive(false);
            setCameraError({
              title: 'Camera Stream Interrupted',
              detail: reason,
              isPermissionDenied: false,
            });
          },
        });

        if (mountedRef.current) {
          setFacingMode(targetFacing);
          setCameraActive(true);
          setCameraStarting(false);
        }
      } catch (err) {
        console.error('Camera start failed:', err);
        const errName = err instanceof DOMException ? err.name : '';
        const errMsg = err instanceof Error ? err.message : String(err);
        const isPermission =
          errName === 'NotAllowedError' ||
          errName === 'PermissionDeniedError' ||
          errName === 'SecurityError' ||
          /permission|denied|notallowed/i.test(errMsg);

        if (mountedRef.current) {
          setCameraActive(false);
          setCameraStarting(false);
          setCameraError(
            isPermission
              ? {
                  title: 'Camera Permission Required',
                  detail:
                    'Allow camera access in your browser address bar or site settings, then tap Restart Camera.',
                  isPermissionDenied: true,
                }
              : {
                  title: 'Camera Unavailable',
                  detail:
                    errName === 'NotReadableError'
                      ? 'Camera is currently being used by another app. Close the other app and tap Restart Camera.'
                      : 'Unable to open rear camera on this device. Try switching camera, Restart Camera, or use Quick ID Input below.',
                  isPermissionDenied: false,
                }
          );
        }
      }
    },
    [processScannedCode]
  );

  // Immediately activate rear camera + warm server IST offset on mount (zero artificial delay)
  useEffect(() => {
    mountedRef.current = true;
    void syncServerIstOffset();
    void startCamera('environment');

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        mountedRef.current &&
        cameraWantedRef.current &&
        engineRef.current &&
        !engineRef.current.isRunning
      ) {
        void startCamera(facingRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      cameraWantedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (overlayTimerRef.current !== null) {
        window.clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
      engineRef.current?.stop();
      engineRef.current = null;
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [startCamera]);

  const handleRestartCamera = useCallback(() => {
    void startCamera(facingRef.current);
  }, [startCamera]);

  const handleSwitchCamera = useCallback(() => {
    const nextFacing: CameraFacing = facingRef.current === 'environment' ? 'user' : 'environment';
    void startCamera(nextFacing);
  }, [startCamera]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualInput.trim();
    if (!code) return;
    setManualInput('');
    await processScannedCode(code, true);
  };

  const handleToggleExit = async () => {
    if (exitToggleBusy) return;
    setExitToggleBusy(true);
    try {
      await onToggleExitTracking(!settings.attendanceExitTracking);
    } finally {
      setExitToggleBusy(false);
    }
  };

  const todayIst = getSyncedServerIstNow().date;
  const todaysAttendance = useMemo(
    () => attendance.filter((a) => a.attendanceDate === todayIst && a.attendanceStatus === 'Present'),
    [attendance, todayIst]
  );

  const outcomeTone = (outcome: QrAttendanceResult['outcome']) => {
    switch (outcome) {
      case 'MARKED_PRESENT':
        return {
          banner: 'bg-emerald-50 border-emerald-200 text-emerald-900',
          icon: <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />,
        };
      case 'EXIT_RECORDED':
        return {
          banner: 'bg-violet-50 border-violet-200 text-violet-900',
          icon: <ExitIcon className="w-5 h-5 text-violet-600 shrink-0" />,
        };
      case 'ALREADY_PRESENT':
        return {
          banner: 'bg-amber-50 border-amber-200 text-amber-900',
          icon: <Clock className="w-5 h-5 text-amber-600 shrink-0" />,
        };
      default:
        return {
          banner: 'bg-red-50 border-red-200 text-red-900',
          icon: <XCircle className="w-5 h-5 text-red-600 shrink-0" />,
        };
    }
  };

  return (
    <div className="space-y-5">
      {/* Header + Camera Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">
            Automatic QR Attendance Scanner
          </h2>
          <p className="text-xs sm:text-sm text-gray-500">
            Continuous 720p rear-camera scanning · Instant attendance in IST ({formatIstDisplayDate(todayIst)})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSoundEnabled((s) => !s)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
            title={soundEnabled ? 'Mute scan beep' : 'Enable scan beep'}
          >
            {soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5 text-violet-600" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-gray-400" />
            )}
            {soundEnabled ? 'Sound On' : 'Muted'}
          </button>

          <button
            type="button"
            disabled={cameraStarting}
            onClick={handleRestartCamera}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60 ${
              cameraActive
                ? 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-700'
                : 'bg-violet-600 hover:bg-violet-700 text-white'
            }`}
          >
            {cameraStarting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {cameraStarting ? 'Starting...' : 'Restart Camera'}
          </button>

          {cameraActive && (
            <>
              <button
                type="button"
                onClick={handleSwitchCamera}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-700 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <SwitchCamera className="w-3.5 h-3.5" />
                {facingMode === 'environment' ? 'Front' : 'Rear'}
              </button>
              <button
                type="button"
                onClick={() => stopCamera(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <CameraOff className="w-3.5 h-3.5" />
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      {/* Entry/Exit Tracking Mode Toggle Card */}
      <div className="app-card rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs sm:text-sm font-semibold text-gray-900">
            Separate Entry &amp; Exit Tracking
          </p>
          <p className="text-xs text-gray-500">
            {settings.attendanceExitTracking
              ? 'Enabled: 1st scan records Entry Time, 2nd scan (after 1 min) records Exit Time.'
              : 'Disabled: One scan per student per batch per day; repeated scans show "Already Marked Present".'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(settings.attendanceExitTracking)}
          disabled={exitToggleBusy}
          onClick={() => void handleToggleExit()}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
            settings.attendanceExitTracking ? 'bg-violet-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
              settings.attendanceExitTracking ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Live Auto-Scanning Rear Camera + Quick Manual Input */}
        <div className="lg:col-span-5 space-y-4">
          <div className="app-card rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Camera
                  className={`w-3.5 h-3.5 ${
                    cameraActive ? 'text-emerald-600' : 'text-gray-400'
                  }`}
                />
                <p className="text-xs font-semibold text-gray-900">
                  {cameraActive
                    ? `Continuous Scan · ${facingMode === 'environment' ? 'Rear Camera' : 'Front Camera'}`
                    : cameraStarting
                    ? 'Activating Rear Camera...'
                    : 'Camera Paused'}
                </p>
              </div>
              <span className="text-[11px] font-mono text-gray-500 tabular-nums">
                Present: {todaysAttendance.length}
              </span>
            </div>

            <CameraVideoViewport
              videoRef={videoRef}
              cameraActive={cameraActive}
              cameraStarting={cameraStarting}
              cameraError={cameraError}
              facingMode={facingMode}
              overlayResult={overlayResult}
              pendingCount={pendingCount}
              onRestartCamera={handleRestartCamera}
            />

            {cameraError && (
              <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1.5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">{cameraError.title}</p>
                    <p className="text-amber-800 leading-relaxed mt-0.5">{cameraError.detail}</p>
                  </div>
                </div>
                {cameraError.isPermissionDenied && (
                  <ol className="list-decimal list-inside text-[11px] text-amber-800 space-y-0.5 pl-6">
                    <li>Tap the lock / camera icon in your browser address bar.</li>
                    <li>Set Camera permission to Allow for this website.</li>
                    <li>Tap Restart Camera above to start scanning immediately.</li>
                  </ol>
                )}
              </div>
            )}
          </div>

          {/* Quick Manual / USB Barcode Scanner Input (never locked by background requests) */}
          <div className="app-card rounded-2xl p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Quick ID / Barcode Input</h3>
            <p className="text-xs text-gray-500 mb-3">
              Type or scan with a handheld barcode reader to record attendance instantly.
            </p>
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="ZOC-2026-123456"
                className="flex-1 rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3 py-2 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Search className="w-4 h-4" />
                Mark
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Live Notification Card (Auto-Ready, Zero Next Button) + Session Feed */}
        <div className="lg:col-span-7 space-y-4">
          {!latestResult ? (
            <div className="app-card rounded-2xl p-8 text-center min-h-[240px] flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-100 text-violet-600 flex items-center justify-center mb-3">
                <QrCode className="w-6 h-6" />
              </div>
              <h3 className="font-display text-base font-bold text-gray-900">
                Scanner Ready for Next Student
              </h3>
              <p className="mt-1 text-xs sm:text-sm text-gray-500 max-w-sm">
                Point the rear camera at any approved Student ID QR code. Attendance records automatically and the scanner stays live for the next student.
              </p>
            </div>
          ) : (
            (() => {
              const tone = outcomeTone(latestResult.outcome);
              const stu = latestResult.student;
              return (
                <div className="app-card rounded-2xl overflow-hidden">
                  <div className={`px-4 py-3.5 border-b flex items-center justify-between gap-3 ${tone.banner}`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      {tone.icon}
                      <div className="min-w-0">
                        <p className="font-display text-sm sm:text-base font-bold truncate">
                          {latestResult.title}
                        </p>
                        <p className="text-xs opacity-85 truncate">{latestResult.message}</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono font-semibold whitespace-nowrap shrink-0 tabular-nums">
                      {latestResult.timeLabel}
                    </span>
                  </div>

                  <div className="p-4 sm:p-5">
                    {stu ? (
                      <div>
                        <div className="flex items-center gap-4">
                          <div className="w-16 h-20 rounded-xl overflow-hidden border border-gray-200 bg-gray-50 shrink-0">
                            <ResolvedImage
                              url={stu.photoUrl}
                              mediaId={stu.photoMediaId}
                              isPrivate
                              alt={stu.studentName}
                              className="w-full h-full object-cover"
                              fallbackLabel={stu.studentName}
                            />
                          </div>
                          <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                            <div className="sm:col-span-2">
                              <p className="font-display text-base font-bold text-gray-900 truncate">
                                {stu.studentName}
                              </p>
                              <p className="font-mono text-xs font-semibold text-violet-700">
                                {stu.studentId} · {stu.studentClass} · {stu.course}
                              </p>
                            </div>
                            <div>
                              <span className="text-gray-500">Batch: </span>
                              <span className="font-medium text-gray-900">
                                {latestResult.batchTiming || stu.batch}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500">Date (IST): </span>
                              <span className="font-mono font-medium text-gray-900 tabular-nums">
                                {formatIstDisplayDate(latestResult.attendanceDate)}
                              </span>
                            </div>
                            {latestResult.entryTimeLabel && (
                              <div>
                                <span className="text-gray-500">Entry: </span>
                                <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                                  {latestResult.entryTimeLabel}
                                </span>
                              </div>
                            )}
                            {latestResult.exitTimeLabel && (
                              <div>
                                <span className="text-gray-500">Exit: </span>
                                <span className="font-mono font-semibold text-violet-700 tabular-nums">
                                  {latestResult.exitTimeLabel}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Prominent Fee Summary & Remaining Fees on Scan Result */}
                        {(() => {
                          const totalF = stu.feeAmount || 0;
                          const paidF = stu.paidAmount || 0;
                          const remF = Math.max(0, totalF - paidF);
                          return (
                            <div className="mt-4 rounded-xl bg-violet-50/70 border border-violet-200 p-3.5 grid grid-cols-3 gap-2 text-center">
                              <div>
                                <p className="text-[11px] text-gray-600 font-semibold">TOTAL FEES</p>
                                <p className="font-mono text-xs sm:text-sm font-bold text-gray-900 mt-0.5">
                                  ₹{totalF.toLocaleString('en-IN')}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] text-emerald-700 font-semibold">PAID FEES</p>
                                <p className="font-mono text-xs sm:text-sm font-bold text-emerald-700 mt-0.5">
                                  ₹{paidF.toLocaleString('en-IN')}
                                </p>
                              </div>
                              <div className="bg-white rounded-lg p-1.5 border border-red-200 shadow-xs">
                                <p className="text-[10px] text-red-600 font-black uppercase tracking-wider">
                                  REMAINING
                                </p>
                                <p className="font-mono text-sm sm:text-base font-black text-red-600 mt-0.5">
                                  ₹{remF.toLocaleString('en-IN')}
                                </p>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="text-xs sm:text-sm text-gray-700 space-y-1">
                        <p>
                          Scanned Value:{' '}
                          <span className="font-mono text-red-600 break-all">
                            {latestResult.scannedCode}
                          </span>
                        </p>
                        {latestResult.application && (
                          <p className="text-gray-500">
                            Applicant: {latestResult.application.studentName} (
                            {latestResult.application.applicationNumber})
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
                      <span className="text-emerald-700 font-medium">
                        Scanner active — hold up next student ID immediately
                      </span>
                      <span className="font-mono tabular-nums">
                        Today Present: {todaysAttendance.length}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()
          )}

          {/* Live Current Session Feed */}
          {sessionFeed.length > 0 && (
            <div className="app-card rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-sm font-bold text-gray-900">
                  Live Scan Feed (This Session)
                </h3>
                <span className="text-xs font-mono text-gray-500 tabular-nums">
                  {sessionFeed.length} scans
                </span>
              </div>
              <div className="divide-y divide-gray-100">
                {sessionFeed.slice(0, 8).map((item, idx) => (
                  <div
                    key={`${item.scannedCode}-${item.timeLabel}-${idx}`}
                    className="py-2 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">
                        {item.student?.studentName || item.application?.studentName || item.scannedCode}
                      </p>
                      <p className="text-[11px] text-gray-500 truncate">
                        {item.student?.studentId || item.scannedCode} · {item.title}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`text-[11px] font-semibold ${
                          item.outcome === 'MARKED_PRESENT'
                            ? 'text-emerald-600'
                            : item.outcome === 'EXIT_RECORDED'
                            ? 'text-violet-700'
                            : item.outcome === 'ALREADY_PRESENT'
                            ? 'text-amber-600'
                            : 'text-red-600'
                        }`}
                      >
                        {item.outcome === 'MARKED_PRESENT'
                          ? 'Present'
                          : item.outcome === 'EXIT_RECORDED'
                          ? 'Exit'
                          : item.outcome === 'ALREADY_PRESENT'
                          ? 'Already Marked'
                          : 'Rejected'}
                      </span>
                      <p className="font-mono text-[10px] text-gray-400 tabular-nums">
                        {item.timeLabel}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Today's Recorded Attendance Table (IST) */}
      <div className="app-card rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-violet-600" />
            <h3 className="font-display text-base font-bold text-gray-900">
              Today&apos;s Present Students ({formatIstDisplayDate(todayIst)})
            </h3>
          </div>
          <span className="text-xs font-mono text-violet-700 font-semibold tabular-nums">
            {todaysAttendance.length} present · {scanHistory.length} total scans
          </span>
        </div>

        {todaysAttendance.length === 0 ? (
          <p className="text-xs sm:text-sm text-gray-500 py-6 text-center">
            No attendance marked today yet. Scan a Student ID QR code to start recording.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500">
                  <th className="pb-2.5 font-medium">Student</th>
                  <th className="pb-2.5 font-medium">ID</th>
                  <th className="pb-2.5 font-medium">Batch</th>
                  <th className="pb-2.5 font-medium">Entry (IST)</th>
                  <th className="pb-2.5 font-medium">Exit (IST)</th>
                  <th className="pb-2.5 font-medium">Mode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {todaysAttendance.slice(0, 40).map((rec) => (
                  <tr key={rec.id} className="hover:bg-gray-50/70">
                    <td className="py-2.5 font-semibold text-gray-900">{rec.studentName}</td>
                    <td className="py-2.5 font-mono text-xs text-violet-700">{rec.studentId}</td>
                    <td className="py-2.5 text-xs text-gray-600">
                      {rec.batchTiming || rec.batchId}
                    </td>
                    <td className="py-2.5 font-mono text-xs text-emerald-700 tabular-nums whitespace-nowrap">
                      {rec.entryTime ? formatIstShortTime(rec.entryTime) : '—'}
                    </td>
                    <td className="py-2.5 font-mono text-xs text-violet-700 tabular-nums whitespace-nowrap">
                      {rec.exitTime ? formatIstTime(rec.exitTime) : '—'}
                    </td>
                    <td className="py-2.5 text-xs text-gray-500 uppercase">{rec.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
