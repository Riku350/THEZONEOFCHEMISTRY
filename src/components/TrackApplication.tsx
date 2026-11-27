import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Search,
  XCircle,
} from 'lucide-react';
import { trackApplicationStatus } from '../lib/firestoreService';
import { ApplicationStatusLookup, InstituteSettings, PublicView } from '../types';

interface TrackApplicationProps {
  settings: InstituteSettings;
  onNavigate: (view: PublicView) => void;
}

export const TrackApplication: React.FC<TrackApplicationProps> = ({ settings, onNavigate }) => {
  const [applicationNumber, setApplicationNumber] = useState('');
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ApplicationStatusLookup | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSearched(false);
    setResult(null);

    const cleanedMobile = mobile.replace(/[^0-9]/g, '');
    if (!applicationNumber.trim()) {
      setError('Please enter your Application Number.');
      return;
    }
    if (cleanedMobile.length !== 10) {
      setError('Please enter your 10-digit Registered Mobile Number.');
      return;
    }

    setLoading(true);
    try {
      const record = await trackApplicationStatus(applicationNumber, cleanedMobile);
      setResult(record);
      setSearched(true);
    } catch (err) {
      console.error('Track lookup error:', err);
      setError('Unable to check status right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-8 pb-24">
      <button
        type="button"
        onClick={() => onNavigate('home')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 mb-4 cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      <div className="app-card rounded-2xl p-6">
        <h1 className="font-display text-xl sm:text-2xl font-bold text-gray-900">
          Track Application
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-gray-500">
          Enter your Application Number and Registered Mobile Number.
        </p>

        <form onSubmit={handleSearch} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Application Number
            </label>
            <input
              type="text"
              required
              value={applicationNumber}
              onChange={(e) => setApplicationNumber(e.target.value.toUpperCase())}
              placeholder="ZOC2026-48219"
              className="w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3.5 py-2.5 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Registered Mobile Number
            </label>
            <input
              type="tel"
              required
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
              placeholder="10-digit mobile"
              className="w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3.5 py-2.5 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-center gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Check Status
          </button>
        </form>

        {searched && !result && (
          <div className="mt-5 rounded-xl bg-gray-50 border border-gray-200 p-4 text-center">
            <p className="text-sm font-semibold text-gray-900">Application Not Found</p>
            <p className="mt-1 text-xs text-gray-500">
              Double-check your Application Number and 10-digit Mobile Number.
            </p>
          </div>
        )}

        {result && (
          <div className="mt-5 rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-4">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-gray-200">
              <div>
                <p className="text-xs text-gray-500">Application No.</p>
                <p className="font-mono text-sm font-bold text-gray-900 tabular-nums">
                  {result.applicationNumber}
                </p>
              </div>
              <div>
                {result.status === 'approved' && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                    <CheckCircle2 className="w-4 h-4" />
                    APPROVED
                  </span>
                )}
                {result.status === 'pending' && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600">
                    <Clock className="w-4 h-4" />
                    PENDING
                  </span>
                )}
                {result.status === 'rejected' && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600">
                    <XCircle className="w-4 h-4" />
                    REJECTED
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm">
              <div>
                <p className="text-xs text-gray-500">Student Name</p>
                <p className="font-semibold text-gray-900">{result.studentName}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Class</p>
                <p className="font-medium text-gray-800">{result.studentClass}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Course</p>
                <p className="font-medium text-gray-800">{result.course}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Batch</p>
                <p className="font-medium text-gray-800">{result.batch}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-gray-500">Fee Status</p>
                <p className="font-mono font-semibold text-gray-900 tabular-nums">
                  ₹{result.paidAmount.toLocaleString('en-IN')} / ₹
                  {result.feeAmount.toLocaleString('en-IN')} · {result.paymentStatus}
                </p>
              </div>
              {result.studentId && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">Official Student ID</p>
                  <p className="font-mono font-bold text-violet-700">{result.studentId}</p>
                </div>
              )}
            </div>

            {result.remarks && (
              <div className="rounded-lg bg-white border border-gray-200 p-3 text-xs text-gray-700">
                <strong className="text-gray-900">Note:</strong> {result.remarks}
              </div>
            )}

            <p className="text-xs text-gray-500">
              Support: <span className="font-mono text-gray-800">{settings.phone}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
