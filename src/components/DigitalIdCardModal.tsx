import React, { useEffect, useState } from 'react';
import { Download, FileText, Loader2, Printer, RefreshCw, X } from 'lucide-react';
import {
  downloadIdCardPdf,
  downloadIdCardPng,
  renderIdCardDataUrl,
} from '../lib/idCardRenderer';
import { InstituteSettings, StudentRecord } from '../types';

interface DigitalIdCardModalProps {
  student: StudentRecord;
  settings: InstituteSettings;
  onClose: () => void;
  onRegenerateCode?: (student: StudentRecord) => Promise<void>;
}

export const DigitalIdCardModal: React.FC<DigitalIdCardModalProps> = ({
  student,
  settings,
  onClose,
  onRegenerateCode,
}) => {
  const [cardUrl, setCardUrl] = useState<string>('');
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    setRendering(true);
    void renderIdCardDataUrl(student, settings)
      .then((url) => {
        if (mounted) setCardUrl(url);
      })
      .finally(() => {
        if (mounted) setRendering(false);
      });
    return () => {
      mounted = false;
    };
  }, [student, settings]);

  const handleDownloadPng = async () => {
    setBusy(true);
    try {
      await downloadIdCardPng(student, settings);
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
    <div
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="max-w-3xl w-full bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="no-print flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="font-display text-base font-bold text-gray-900">
              Digital Student ID Card
            </h2>
            <p className="text-xs text-gray-500">
              {student.studentName} ·{' '}
              <span className="font-mono text-violet-700">{student.studentId}</span> · PIN:{' '}
              <span className="font-mono text-gray-900">{student.securityCode}</span>
            </p>
          </div>
          <button
            type="button"
            aria-label="Close ID card preview"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 bg-gray-50">
          {rendering ? (
            <div className="aspect-[16/10] w-full rounded-xl bg-white border border-gray-200 flex flex-col items-center justify-center text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin text-violet-600 mb-2" />
              <p className="text-xs font-medium">Generating ID Card...</p>
            </div>
          ) : (
            <img
              src={cardUrl}
              alt={`Digital Student ID Card for ${student.studentName}`}
              className="w-full rounded-xl border border-gray-200 shadow-sm bg-white"
            />
          )}

          <div className="no-print mt-5 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || rendering}
                onClick={handleDownloadPdf}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                Download PDF
              </button>
              <button
                type="button"
                disabled={busy || rendering}
                onClick={handleDownloadPng}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-gray-100 border border-gray-200 disabled:opacity-60 text-gray-800 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-violet-600" />
                Download PNG
              </button>
              <button
                type="button"
                disabled={busy || rendering}
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-gray-100 border border-gray-200 disabled:opacity-60 text-gray-800 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-gray-600" />
                Print
              </button>
            </div>

            {onRegenerateCode && (
              <button
                type="button"
                disabled={busy || rendering}
                onClick={handleRegenerate}
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
  );
};
