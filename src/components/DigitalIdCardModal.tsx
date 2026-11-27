import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  FileText,
  Layers,
  Loader2,
  Printer,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  CR80_HEIGHT_MM,
  CR80_WIDTH_MM,
  downloadIdCardPdf,
  downloadIdCardPng,
  renderIdCardBothSidesDataUrls,
} from '../lib/idCardRenderer';
import { InstituteSettings, StudentRecord } from '../types';

interface DigitalIdCardModalProps {
  student: StudentRecord;
  settings: InstituteSettings;
  onClose: () => void;
  onRegenerateCode?: (student: StudentRecord) => Promise<void>;
}

type PreviewSide = 'both' | 'front' | 'back';

export const DigitalIdCardModal: React.FC<DigitalIdCardModalProps> = ({
  student,
  settings,
  onClose,
  onRegenerateCode,
}) => {
  const [frontUrl, setFrontUrl] = useState<string>('');
  const [backUrl, setBackUrl] = useState<string>('');
  const [viewSide, setViewSide] = useState<PreviewSide>('both');
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    setRendering(true);
    void renderIdCardBothSidesDataUrls(student, settings)
      .then(({ frontUrl: f, backUrl: b }) => {
        if (mounted) {
          setFrontUrl(f);
          setBackUrl(b);
        }
      })
      .finally(() => {
        if (mounted) setRendering(false);
      });
    return () => {
      mounted = false;
    };
  }, [student, settings]);

  const handleDownloadPng = async (side: 'front' | 'back') => {
    setBusy(true);
    try {
      await downloadIdCardPng(student, settings, side);
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadPdf = async () => {
    setBusy(true);
    try {
      await downloadIdCardPdf(student, settings);
    } finally {
      setBusy(false);
    }
  };

  const handlePrintBothSides = () => {
    if (!frontUrl || !backUrl) return;
    document.body.classList.add('printing-cr80');
    const cleanup = () => {
      document.body.classList.remove('printing-cr80');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    window.setTimeout(cleanup, 1500);
  };

  const handleRegenerate = async () => {
    if (!onRegenerateCode) return;
    setBusy(true);
    try {
      await onRegenerateCode(student);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className="no-print fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        onClick={onClose}
      >
        <div
          className="max-w-4xl w-full bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xl my-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-gray-200">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-bold text-gray-900">
                  Double-Sided Student ID Card
                </h2>
                <span className="text-[11px] font-mono text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-md">
                  CR80 · {CR80_WIDTH_MM.toFixed(2)} × {CR80_HEIGHT_MM.toFixed(2)} mm
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                {student.studentName} ·{' '}
                <span className="font-mono text-violet-700 font-semibold">{student.studentId}</span>{' '}
                · Code: <span className="font-mono text-gray-900">{student.securityCode}</span>
              </p>
            </div>
            <button
              type="button"
              aria-label="Close ID card preview"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Preview Controls + CR80 Card Area */}
          <div className="p-4 sm:p-5 bg-gray-50 space-y-4 max-h-[82vh] overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="inline-flex p-1 rounded-xl bg-white border border-gray-200">
                {(
                  [
                    { id: 'both', label: 'Both Sides' },
                    { id: 'front', label: 'Front Side' },
                    { id: 'back', label: 'Back Side' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setViewSide(tab.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      viewSide === tab.id
                        ? 'bg-violet-600 text-white'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-violet-600" />
                Duplex-aligned Front &amp; Back for physical CR80 printing
              </p>
            </div>

            {rendering ? (
              <div className="aspect-[1348/850] max-w-2xl mx-auto w-full rounded-2xl bg-white border border-gray-200 flex flex-col items-center justify-center text-gray-500">
                <Loader2 className="w-6 h-6 animate-spin text-violet-600 mb-2" />
                <p className="text-xs font-medium">Rendering High-Resolution Front &amp; Back ID Card...</p>
              </div>
            ) : viewSide === 'both' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                    Front Side — Student Details
                  </p>
                  <img
                    src={frontUrl}
                    alt={`Front Side ID Card for ${student.studentName}`}
                    className="w-full aspect-[1348/850] rounded-xl border border-gray-200 shadow-xs bg-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                    Back Side — Meet Your Teacher
                  </p>
                  <img
                    src={backUrl}
                    alt={`Back Side ID Card for ${settings.teacherName}`}
                    className="w-full aspect-[1348/850] rounded-xl border border-gray-200 shadow-xs bg-white"
                  />
                </div>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                  {viewSide === 'front'
                    ? 'Front Side — Student Details'
                    : 'Back Side — Meet Your Teacher'}
                </p>
                <img
                  src={viewSide === 'front' ? frontUrl : backUrl}
                  alt={
                    viewSide === 'front'
                      ? `Front Side ID Card for ${student.studentName}`
                      : `Back Side ID Card for ${settings.teacherName}`
                  }
                  className="w-full aspect-[1348/850] rounded-xl border border-gray-200 shadow-sm bg-white"
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="pt-1 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || rendering}
                  onClick={() => void handleDownloadPdf()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  {busy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileText className="w-3.5 h-3.5" />
                  )}
                  Download Complete PDF (Front &amp; Back)
                </button>
                <button
                  type="button"
                  disabled={busy || rendering}
                  onClick={handlePrintBothSides}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-gray-100 border border-gray-200 disabled:opacity-60 text-gray-800 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-violet-600" />
                  Print Both Sides
                </button>
                <button
                  type="button"
                  disabled={busy || rendering}
                  onClick={() => void handleDownloadPng('front')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-gray-100 border border-gray-200 disabled:opacity-60 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-gray-500" />
                  Front PNG
                </button>
                <button
                  type="button"
                  disabled={busy || rendering}
                  onClick={() => void handleDownloadPng('back')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-gray-100 border border-gray-200 disabled:opacity-60 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-gray-500" />
                  Back PNG
                </button>
              </div>

              {onRegenerateCode && (
                <button
                  type="button"
                  disabled={busy || rendering}
                  onClick={() => void handleRegenerate()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                  New Security Code
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dedicated In-DOM Print Portal for Exact CR80 Double-Sided Physical Printing */}
      {frontUrl &&
        backUrl &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="print-only-id-sheets" aria-hidden="true">
            <div className="cr80-print-page">
              <p
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#6D28D9',
                  marginBottom: '6mm',
                  fontFamily: 'sans-serif',
                  letterSpacing: '0.06em',
                }}
              >
                FRONT SIDE — STUDENT DETAILS ({student.studentId}) · CR80 85.60 × 53.98 mm
              </p>
              <img src={frontUrl} alt="" className="cr80-card-physical" />
            </div>
            <div className="cr80-print-page">
              <p
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#6D28D9',
                  marginBottom: '6mm',
                  fontFamily: 'sans-serif',
                  letterSpacing: '0.06em',
                }}
              >
                BACK SIDE — MEET YOUR TEACHER ({settings.teacherName}) · CR80 85.60 × 53.98 mm
              </p>
              <img src={backUrl} alt="" className="cr80-card-physical" />
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
