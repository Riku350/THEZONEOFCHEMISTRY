import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  QrCode,
  RefreshCw,
  Search,
  SwitchCamera,
  XCircle,
} from 'lucide-react';
import { QrVerificationResult, verifyQrCodeAgainstFirestore } from '../lib/firestoreService';
import { ScanHistoryEntry } from '../types';
import { ResolvedImage } from './ResolvedImage';

interface AdminQrScannerProps {
  adminEmail: string;
  scanHistory: ScanHistoryEntry[];
}

export const AdminQrScanner: React.FC<AdminQrScannerProps> = ({ adminEmail, scanHistory }) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const readerElementId = 'zoc-qr-reader-viewport';

  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<QrVerificationResult | null>(null);
  const [manualInput, setManualInput] = useState('');

  const stopCamera = useCallback(async () => {
    const instance = scannerRef.current;
    if (!instance) return;
    try {
      if (instance.isScanning) {
        await instance.stop();
      }
      await instance.clear();
    } catch {
      // Ignore cleanup race when switching views
    }
    scannerRef.current = null;
    setCameraActive(false);
  }, []);

  const handleDecodedCode = useCallback(
    async (decodedText: string) => {
      if (processingRef.current) return;
      processingRef.current = true;
      setVerifying(true);

      try {
        if (scannerRef.current && scannerRef.current.isScanning) {
          scannerRef.current.pause(true);
        }
      } catch {
        // Ignore if pause unavailable
      }

      try {
        const verified = await verifyQrCodeAgainstFirestore(decodedText, adminEmail);
        setResult(verified);
      } catch (err) {
        console.error('QR verification error:', err);
        setResult({
          statusResult: 'INVALID',
          reason: 'Verification failed due to database connection error.',
          scannedCode: decodedText,
          scannedAt: new Date(),
        });
      } finally {
        setVerifying(false);
      }
    },
    [adminEmail]
  );

  const startCamera = useCallback(
    async (targetFacing: 'environment' | 'user') => {
      setCameraError('');
      await stopCamera();

      try {
        const html5QrCode = new Html5Qrcode(readerElementId);
        scannerRef.current = html5QrCode;
        processingRef.current = false;

        await html5QrCode.start(
          { facingMode: targetFacing },
          {
            fps: 12,
            qrbox: { width: 240, height: 240 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            void handleDecodedCode(decodedText);
          },
          () => {
            // Frame had no QR code — silent
          }
        );

        setFacingMode(targetFacing);
        setCameraActive(true);
      } catch (err) {
        console.error('Camera start failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        setCameraError(
          msg.includes('NotAllowedError') || msg.includes('Permission')
            ? 'Camera permission denied. Allow camera access in browser settings or use Manual Verification below.'
            : 'Unable to access camera on this device. Switch cameras or use Manual Verification below.'
        );
        setCameraActive(false);
      }
    },
    [handleDecodedCode, stopCamera]
  );

  useEffect(() => {
    return () => {
      void stopCamera();
    };
  }, [stopCamera]);

  const handleNextScan = () => {
    setResult(null);
    processingRef.current = false;
    if (scannerRef.current) {
      try {
        scannerRef.current.resume();
      } catch {
        void startCamera(facingMode);
      }
    }
  };

  const handleSwitchCamera = () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setResult(null);
    void startCamera(nextFacing);
  };

  const handleManualVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    processingRef.current = false;
    await handleDecodedCode(manualInput.trim());
    setManualInput('');
  };

  const profile = result?.student;
  const pendingApp = result?.application;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">
            QR Student Scanner
          </h2>
          <p className="text-xs sm:text-sm text-gray-500">
            Scan official Digital Student IDs for instant live Firestore verification.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!cameraActive ? (
            <button
              type="button"
              onClick={() => void startCamera('environment')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              Open Rear Camera
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSwitchCamera}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-700 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <SwitchCamera className="w-4 h-4" />
                {facingMode === 'environment' ? 'Front Camera' : 'Rear Camera'}
              </button>
              <button
                type="button"
                onClick={() => void stopCamera()}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <CameraOff className="w-4 h-4" />
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Live Camera Feed + Manual Fallback */}
        <div className="lg:col-span-5 space-y-4">
          <div className="app-card rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-violet-700">
                {cameraActive
                  ? `Active · ${facingMode === 'environment' ? 'Rear Camera' : 'Front Camera'}`
                  : 'Camera Standby'}
              </p>
              {verifying && (
                <span className="inline-flex items-center gap-1.5 text-xs text-violet-600 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Verifying...
                </span>
              )}
            </div>

            <div className="relative rounded-xl overflow-hidden bg-gray-50 border border-gray-200 min-h-[260px] flex items-center justify-center">
              <div id={readerElementId} className="w-full" />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-100 text-violet-600 flex items-center justify-center mb-3">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900">Scanner Ready</p>
                  <p className="mt-1 text-xs text-gray-500 max-w-xs">
                    Tap &ldquo;Open Rear Camera&rdquo; to scan Student ID QR codes continuously.
                  </p>
                </div>
              )}
            </div>

            {cameraError && (
              <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 leading-relaxed">
                {cameraError}
              </div>
            )}
          </div>

          {/* Manual Student ID / QR Token Verification */}
          <div className="app-card rounded-2xl p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Manual Verification</h3>
            <p className="text-xs text-gray-500 mb-3">
              Enter a Student ID or Application Number to verify directly.
            </p>
            <form onSubmit={handleManualVerify} className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="ZOC-2026-123456"
                className="flex-1 rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3 py-2 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
              />
              <button
                type="submit"
                disabled={verifying}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Search className="w-4 h-4" />
                Verify
              </button>
            </form>
          </div>
        </div>

        {/* Right: Scanned Student Verification Result Card */}
        <div className="lg:col-span-7">
          {!result ? (
            <div className="app-card rounded-2xl p-8 sm:p-10 text-center min-h-[380px] flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-2xl bg-violet-50 border border-violet-100 text-violet-600 flex items-center justify-center mb-4">
                <QrCode className="w-7 h-7" />
              </div>
              <h3 className="font-display text-lg font-bold text-gray-900">
                Waiting for Next Scan
              </h3>
              <p className="mt-1.5 text-xs sm:text-sm text-gray-500 max-w-sm">
                Point the camera at a Student ID QR code. Verified details, 4-digit security code, and fee status will appear here.
              </p>
            </div>
          ) : (
            <div className="app-card rounded-2xl overflow-hidden">
              {/* Status Banner */}
              <div
                className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b ${
                  result.statusResult === 'VALID'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : result.statusResult === 'PENDING'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  {result.statusResult === 'VALID' && (
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                  )}
                  {result.statusResult === 'PENDING' && (
                    <Clock className="w-6 h-6 text-amber-600 shrink-0" />
                  )}
                  {result.statusResult === 'INVALID' && (
                    <XCircle className="w-6 h-6 text-red-600 shrink-0" />
                  )}
                  <div>
                    <p className="font-display text-sm sm:text-base font-bold">
                      {result.statusResult === 'VALID'
                        ? 'APPROVED · VALID STUDENT'
                        : result.statusResult === 'PENDING'
                        ? 'PENDING APPROVAL'
                        : 'INVALID ID / REJECTED'}
                    </p>
                    <p className="text-xs opacity-80">{result.reason}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleNextScan}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-900 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Next Scan
                </button>
              </div>

              {/* Verified Profile Details */}
              <div className="p-5">
                {profile ? (
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-5">
                    <div className="sm:col-span-4 flex flex-col items-center">
                      <div className="w-32 h-40 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                        <ResolvedImage
                          url={profile.photoUrl}
                          mediaId={profile.photoMediaId}
                          isPrivate
                          alt={profile.studentName}
                          className="w-full h-full object-cover"
                          fallbackLabel={profile.studentName}
                        />
                      </div>
                      <div className="mt-3 w-32 rounded-xl bg-violet-50 border border-violet-200 py-2 text-center">
                        <p className="text-[10px] text-violet-700 font-semibold uppercase tracking-wide">
                          4-Digit Code
                        </p>
                        <p className="font-mono text-xl font-bold text-violet-900 tabular-nums">
                          {profile.securityCode}
                        </p>
                      </div>
                    </div>

                    <div className="sm:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
                      <div className="sm:col-span-2">
                        <p className="text-xs text-gray-500">Student Name</p>
                        <p className="font-display text-lg font-bold text-gray-900">
                          {profile.studentName}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Father&apos;s Name</p>
                        <p className="font-medium text-gray-900">{profile.fatherName}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Student ID</p>
                        <p className="font-mono font-semibold text-violet-700">
                          {profile.studentId}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Class</p>
                        <p className="font-medium text-gray-800">{profile.studentClass}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Course</p>
                        <p className="font-medium text-gray-800">{profile.course}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Batch Timing</p>
                        <p className="font-medium text-gray-800">{profile.batch}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Phone</p>
                        <p className="font-mono text-gray-800 tabular-nums">
                          {profile.studentMobile}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Admission Status</p>
                        <p
                          className={`font-semibold ${
                            profile.status === 'active' ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {profile.status === 'active' ? 'Approved · Active' : 'Suspended'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Fee Status</p>
                        <p
                          className={`font-mono font-semibold text-xs tabular-nums ${
                            profile.paymentStatus === 'PAID'
                              ? 'text-emerald-600'
                              : profile.paymentStatus === 'PARTIAL'
                              ? 'text-amber-600'
                              : 'text-red-600'
                          }`}
                        >
                          {profile.paymentStatus} (₹{profile.paidAmount.toLocaleString('en-IN')} / ₹
                          {profile.feeAmount.toLocaleString('en-IN')})
                        </p>
                      </div>
                    </div>
                  </div>
                ) : pendingApp ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
                    <div>
                      <p className="text-xs text-gray-500">Applicant Name</p>
                      <p className="font-display text-base font-bold text-gray-900">
                        {pendingApp.studentName}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Application No.</p>
                      <p className="font-mono text-amber-700 font-semibold">
                        {pendingApp.applicationNumber}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Father&apos;s Name</p>
                      <p className="text-gray-800">{pendingApp.fatherName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Class & Course</p>
                      <p className="text-gray-800">
                        {pendingApp.studentClass} · {pendingApp.course}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Batch</p>
                      <p className="text-gray-800">{pendingApp.batch}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Phone</p>
                      <p className="font-mono text-gray-800 tabular-nums">
                        {pendingApp.studentMobile}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="py-5 text-center">
                    <p className="text-sm text-gray-700">
                      Scanned Code:{' '}
                      <span className="font-mono text-red-600 break-all">{result.scannedCode}</span>
                    </p>
                    <p className="mt-1.5 text-xs text-gray-500">
                      This QR code does not match any active student record.
                    </p>
                  </div>
                )}

                <div className="mt-5 pt-3.5 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                  <span className="font-mono tabular-nums">
                    {result.scannedAt.toLocaleString('en-IN')}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextScan}
                    className="font-semibold text-violet-700 hover:text-violet-900 cursor-pointer"
                  >
                    Clear & Next Scan →
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scan History Audit Table */}
      <div className="app-card rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-violet-600" />
            <h3 className="font-display text-base font-bold text-gray-900">Recent Scans</h3>
          </div>
          <span className="text-xs font-mono text-gray-500 tabular-nums">
            {scanHistory.length} records
          </span>
        </div>

        {scanHistory.length === 0 ? (
          <p className="text-xs sm:text-sm text-gray-500 py-6 text-center">
            No QR scans recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500">
                  <th className="pb-2.5 font-medium">Time</th>
                  <th className="pb-2.5 font-medium">Student</th>
                  <th className="pb-2.5 font-medium">Scanned ID</th>
                  <th className="pb-2.5 font-medium">Status</th>
                  <th className="pb-2.5 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {scanHistory.slice(0, 30).map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50/70">
                    <td className="py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap tabular-nums">
                      {entry.scannedAt?.toDate
                        ? entry.scannedAt.toDate().toLocaleString('en-IN')
                        : 'Just now'}
                    </td>
                    <td className="py-2.5 font-medium text-gray-900">
                      {entry.studentName || 'Unknown'}
                    </td>
                    <td className="py-2.5 font-mono text-xs text-violet-700">
                      {entry.studentId || entry.scannedCode}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`text-xs font-semibold ${
                          entry.statusResult === 'VALID'
                            ? 'text-emerald-600'
                            : entry.statusResult === 'PENDING'
                            ? 'text-amber-600'
                            : 'text-red-600'
                        }`}
                      >
                        {entry.statusResult === 'VALID'
                          ? 'VALID'
                          : entry.statusResult === 'PENDING'
                          ? 'PENDING'
                          : 'INVALID'}
                      </span>
                    </td>
                    <td className="py-2.5 text-xs text-gray-500 max-w-xs truncate">
                      {entry.reason || '—'}
                    </td>
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
