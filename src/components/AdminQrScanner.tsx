import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
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
  getClientIstNow,
} from '../lib/attendanceUtils';
import {
  QrAttendanceResult,
  recordQrAttendanceTransaction,
} from '../lib/firestoreService';
import {
  AttendanceRecord,
  BatchItem,
  InstituteSettings,
  ScanHistoryEntry,
} from '../types';
import { ResolvedImage } from './ResolvedImage';

interface AdminQrScannerProps {
  adminEmail: string;
  batches: BatchItem[];
  attendance: AttendanceRecord[];
  scanHistory: ScanHistoryEntry[];
  settings: InstituteSettings;
  onToggleExitTracking: (enabled: boolean) => Promise<void>;
}

function playFeedbackTone(kind: 'success' | 'info' | 'error') {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (kind === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(784, now);
      osc.frequency.setValueAtTime(1046.5, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.23);
    } else if (kind === 'info') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.3, now);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.17);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.setValueAtTime(180, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.25);
    }
    window.setTimeout(() => void ctx.close(), 400);
  } catch {
    // Audio playback optional if blocked by browser autoplay policy
  }
}

export const AdminQrScanner: React.FC<AdminQrScannerProps> = ({
  adminEmail,
  batches,
  attendance,
  scanHistory,
  settings,
  onToggleExitTracking,
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const inFlightRef = useRef(false);
  const lastDecodedRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const mountedRef = useRef(true);
  const readerElementId = 'zoc-auto-qr-attendance-viewport';

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [exitToggleBusy, setExitToggleBusy] = useState(false);
  const [latestResult, setLatestResult] = useState<QrAttendanceResult | null>(null);
  const [sessionFeed, setSessionFeed] = useState<QrAttendanceResult[]>([]);
  const [manualInput, setManualInput] = useState('');

  // Keep latest props in refs so continuous scanner callback never needs restart
  const batchesRef = useRef(batches);
  const exitTrackingRef = useRef(Boolean(settings.attendanceExitTracking));
  const soundRef = useRef(soundEnabled);

  useEffect(() => {
    batchesRef.current = batches;
  }, [batches]);

  useEffect(() => {
    exitTrackingRef.current = Boolean(settings.attendanceExitTracking);
  }, [settings.attendanceExitTracking]);

  useEffect(() => {
    soundRef.current = soundEnabled;
  }, [soundEnabled]);

  const stopCamera = useCallback(async () => {
    const instance = scannerRef.current;
    scannerRef.current = null;
    if (!instance) return;
    try {
      if (instance.isScanning) {
        await instance.stop();
      }
      await instance.clear();
    } catch {
      // Ignore cleanup race when switching tabs
    }
    if (mountedRef.current) {
      setCameraActive(false);
    }
  }, []);

  /**
   * Continuous non-blocking QR handler:
   * Never pauses the camera or waits for any manual button click.
   * Debounces identical QR text for 2.5s so Student 1 -> Student 2 -> Student 3 flows instantly.
   */
  const processScannedCode = useCallback(
    async (decodedText: string, bypassDebounce = false) => {
      const normalized = decodedText.trim();
      if (!normalized) return;

      const now = Date.now();
      if (
        !bypassDebounce &&
        lastDecodedRef.current.code === normalized &&
        now - lastDecodedRef.current.at < 2600
      ) {
        return;
      }
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      lastDecodedRef.current = { code: normalized, at: now };
      if (mountedRef.current) setProcessing(true);

      try {
        const res = await recordQrAttendanceTransaction(
          normalized,
          batchesRef.current,
          adminEmail,
          exitTrackingRef.current
        );
        if (!mountedRef.current) return;

        setLatestResult(res);
        setSessionFeed((prev) => [res, ...prev].slice(0, 15));

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
        const nowIst = getClientIstNow();
        const fallbackRes: QrAttendanceResult = {
          outcome: 'REJECTED_INVALID',
          title: 'Scan Error',
          message:
            err instanceof Error
              ? err.message
              : 'Unable to record attendance due to database connection error.',
          scannedCode: normalized,
          attendanceDate: nowIst.date,
          timeLabel: `${nowIst.time} IST`,
        };
        if (mountedRef.current) {
          setLatestResult(fallbackRes);
          setSessionFeed((prev) => [fallbackRes, ...prev].slice(0, 15));
          if (soundRef.current) playFeedbackTone('error');
        }
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setProcessing(false);
      }
    },
    [adminEmail]
  );

  const startCamera = useCallback(
    async (targetFacing: 'environment' | 'user') => {
      if (!mountedRef.current) return;
      setCameraError('');
      setCameraStarting(true);
      await stopCamera();

      const container = document.getElementById(readerElementId);
      if (!container || !mountedRef.current) {
        setCameraStarting(false);
        return;
      }

      try {
        const html5QrCode = new Html5Qrcode(readerElementId);
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: targetFacing },
          {
            fps: 12,
            qrbox: { width: 240, height: 240 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            void processScannedCode(decodedText, false);
          },
          () => {
            // No QR code in current frame — keep scanning silently
          }
        );

        if (mountedRef.current) {
          setFacingMode(targetFacing);
          setCameraActive(true);
          setCameraStarting(false);
        }
      } catch (err) {
        console.error('Camera auto-start failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        if (mountedRef.current) {
          setCameraError(
            msg.includes('NotAllowedError') || msg.includes('Permission')
              ? 'Camera permission was blocked by browser. Allow camera access or use Quick ID Input below.'
              : 'Rear camera is unavailable on this device. Try switching camera or use Quick ID Input below.'
          );
          setCameraActive(false);
          setCameraStarting(false);
        }
      }
    },
    [processScannedCode, stopCamera]
  );

  // Automatically activate rear camera immediately when teacher/admin opens QR Scanner
  useEffect(() => {
    mountedRef.current = true;
    const timer = window.setTimeout(() => {
      void startCamera('environment');
    }, 150);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(timer);
      void stopCamera();
    };
  }, [startCamera, stopCamera]);

  const handleSwitchCamera = () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    void startCamera(nextFacing);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    const code = manualInput.trim();
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

  const todayIst = getClientIstNow().date;
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
          badge: 'bg-emerald-600 text-white',
        };
      case 'EXIT_RECORDED':
        return {
          banner: 'bg-violet-50 border-violet-200 text-violet-900',
          icon: <ExitIcon className="w-5 h-5 text-violet-600 shrink-0" />,
          badge: 'bg-violet-600 text-white',
        };
      case 'ALREADY_PRESENT':
        return {
          banner: 'bg-amber-50 border-amber-200 text-amber-900',
          icon: <Clock className="w-5 h-5 text-amber-600 shrink-0" />,
          badge: 'bg-amber-500 text-white',
        };
      default:
        return {
          banner: 'bg-red-50 border-red-200 text-red-900',
          icon: <XCircle className="w-5 h-5 text-red-600 shrink-0" />,
          badge: 'bg-red-600 text-white',
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
            Continuous rear-camera scanning · Instant attendance recording in IST ({formatIstDisplayDate(todayIst)})
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

          {!cameraActive ? (
            <button
              type="button"
              disabled={cameraStarting}
              onClick={() => void startCamera('environment')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              {cameraStarting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Camera className="w-3.5 h-3.5" />
              )}
              {cameraStarting ? 'Starting Camera...' : 'Restart Camera'}
            </button>
          ) : (
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
                onClick={() => void stopCamera()}
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
                <span
                  className={`w-2 h-2 rounded-full ${
                    cameraActive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'
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
              {processing && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-700">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving...
                </span>
              )}
            </div>

            <div className="relative rounded-xl overflow-hidden bg-gray-950/5 border border-gray-200 min-h-[265px] flex items-center justify-center">
              <div id={readerElementId} className="w-full" />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gray-50">
                  <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-100 text-violet-600 flex items-center justify-center mb-3">
                    {cameraStarting ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : (
                      <QrCode className="w-6 h-6" />
                    )}
                  </div>
                  <p className="text-sm font-semibold text-gray-900">
                    {cameraStarting ? 'Opening Rear Camera...' : 'Ready for Continuous Scanning'}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 max-w-xs">
                    Scan Student 1, then immediately hold up Student 2 — attendance saves automatically with zero button presses.
                  </p>
                </div>
              )}
            </div>

            {cameraError && (
              <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2 text-xs text-amber-800 leading-relaxed">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{cameraError}</span>
              </div>
            )}
          </div>

          {/* Quick Manual / USB Barcode Scanner Input */}
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
                disabled={processing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
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
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Scanner active — ready for next student automatically
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
                {sessionFeed.slice(0, 6).map((item, idx) => (
                  <div
                    key={`${item.scannedCode}-${idx}`}
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
