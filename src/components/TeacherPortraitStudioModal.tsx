import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Crosshair,
  Download,
  Eraser,
  Loader2,
  RotateCcw,
  Sliders,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import {
  BgSamplePoint,
  DEFAULT_PORTRAIT_STUDIO_OPTIONS,
  PortraitCutoutResult,
  PortraitStudioOptions,
  processTeacherPortraitCutout,
} from '../lib/teacherPortraitStudio';

interface TeacherPortraitStudioModalProps {
  sourceUrl: string;
  teacherName: string;
  saving: boolean;
  onClose: () => void;
  onApplyCutout: (result: PortraitCutoutResult, isCutout: boolean) => Promise<void>;
}

const CHECKER_BG: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
  backgroundColor: '#ffffff',
};

export const TeacherPortraitStudioModal: React.FC<TeacherPortraitStudioModalProps> = ({
  sourceUrl,
  teacherName,
  saving,
  onClose,
  onApplyCutout,
}) => {
  const [options, setOptions] = useState<PortraitStudioOptions>(DEFAULT_PORTRAIT_STUDIO_OPTIONS);
  const [result, setResult] = useState<PortraitCutoutResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [previewBackdrop, setPreviewBackdrop] = useState<'purple' | 'checker' | 'white'>('purple');
  const [pickMode, setPickMode] = useState(false);
  const sourceImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let active = true;
    setProcessing(true);
    setError('');
    const timer = window.setTimeout(() => {
      void processTeacherPortraitCutout(sourceUrl, options)
        .then((res) => {
          if (active) setResult(res);
        })
        .catch((err) => {
          if (active) {
            setError(err instanceof Error ? err.message : 'Unable to process image locally.');
          }
        })
        .finally(() => {
          if (active) setProcessing(false);
        });
    }, 140);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [sourceUrl, options]);

  const handleSourceImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!pickMode || !sourceImgRef.current) return;
    const rect = sourceImgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const pt: BgSamplePoint = { x, y };
    setOptions((prev) => ({
      ...prev,
      removeBackground: true,
      samplePoints: [...prev.samplePoints, pt],
    }));
  };

  const handleDownloadCutout = () => {
    if (!result?.pngDataUrl) return;
    const a = document.createElement('a');
    a.href = result.pngDataUrl;
    a.download = `${(teacherName || 'teacher').replace(/\s+/g, '_')}_Cutout.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-3 bg-white shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base sm:text-lg font-bold text-gray-900">
                On-Device Teacher Portrait &amp; Background Studio
              </h3>
              <span className="px-2 py-0.5 rounded-md bg-violet-50 border border-violet-200 text-[10px] font-semibold text-violet-700">
                Local Canvas · Transparent PNG
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Removes the background and balances portrait lighting directly in your browser using the actual uploaded photo of {teacherName}.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close portrait studio"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Interactive Source + Cutout Preview */}
          <div className="lg:col-span-7 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Original Photo (Click-to-Sample Background) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                    Original Uploaded Photo
                  </span>
                  <button
                    type="button"
                    onClick={() => setPickMode((p) => !p)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                      pickMode
                        ? 'bg-violet-600 border-violet-600 text-white'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-violet-300'
                    }`}
                  >
                    <Crosshair className="w-3 h-3" />
                    {pickMode ? 'Click BG Spots...' : 'Pick Extra BG Spot'}
                  </button>
                </div>

                <div
                  className={`relative aspect-[4/5] rounded-2xl overflow-hidden border ${
                    pickMode ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200'
                  } bg-gray-50 flex items-center justify-center`}
                >
                  <img
                    ref={sourceImgRef}
                    src={sourceUrl}
                    alt="Original teacher upload"
                    onClick={handleSourceImageClick}
                    className={`w-full h-full object-contain ${
                      pickMode ? 'cursor-crosshair' : ''
                    }`}
                  />
                  {options.samplePoints.map((pt, idx) => (
                    <span
                      key={`${pt.x}-${pt.y}-${idx}`}
                      className="absolute w-3.5 h-3.5 -ml-1.5 -mt-1.5 rounded-full border-2 border-white bg-violet-600 shadow-sm pointer-events-none"
                      style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
                    />
                  ))}
                </div>
                {options.samplePoints.length > 0 && (
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>{options.samplePoints.length} extra background spot(s) sampled</span>
                    <button
                      type="button"
                      onClick={() =>
                        setOptions((prev) => ({
                          ...prev,
                          samplePoints: prev.samplePoints.slice(0, -1),
                        }))
                      }
                      className="inline-flex items-center gap-1 text-violet-700 font-semibold hover:underline cursor-pointer"
                    >
                      <Undo2 className="w-3 h-3" />
                      Undo Spot
                    </button>
                  </div>
                )}
              </div>

              {/* Processed Transparent PNG Preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                    Live Cutout Preview
                  </span>
                  <div className="inline-flex p-0.5 rounded-lg bg-gray-100 border border-gray-200 text-[10px] font-semibold">
                    {(
                      [
                        { id: 'purple', label: 'ID Card' },
                        { id: 'checker', label: 'PNG' },
                        { id: 'white', label: 'White' },
                      ] as const
                    ).map((bg) => (
                      <button
                        key={bg.id}
                        type="button"
                        onClick={() => setPreviewBackdrop(bg.id)}
                        className={`px-2 py-0.5 rounded-md cursor-pointer ${
                          previewBackdrop === bg.id
                            ? 'bg-white text-violet-700 shadow-2xs'
                            : 'text-gray-600'
                        }`}
                      >
                        {bg.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  className="relative aspect-[4/5] rounded-2xl overflow-hidden border border-violet-200 flex items-end justify-center"
                  style={
                    previewBackdrop === 'checker'
                      ? CHECKER_BG
                      : previewBackdrop === 'purple'
                      ? {
                          background:
                            'radial-gradient(circle at 50% 42%, #8B5CF6 0%, #6D28D9 48%, #4C1D95 100%)',
                        }
                      : { backgroundColor: '#FFFFFF' }
                  }
                >
                  {processing && !result ? (
                    <div className="m-auto flex flex-col items-center text-gray-500">
                      <Loader2 className="w-6 h-6 animate-spin text-violet-600 mb-2" />
                      <span className="text-xs">Processing pixels locally...</span>
                    </div>
                  ) : result?.pngDataUrl ? (
                    <img
                      src={result.pngDataUrl}
                      alt="Processed teacher cutout"
                      className={`max-w-full max-h-full object-contain ${
                        options.removeBackground ? 'drop-shadow-lg' : ''
                      }`}
                    />
                  ) : null}

                  {processing && result && (
                    <div className="absolute top-2.5 right-2.5 px-2 py-1 rounded-lg bg-white/90 text-[10px] font-semibold text-violet-700 flex items-center gap-1 shadow-xs">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Updating...
                    </div>
                  )}
                </div>

                {result && (
                  <p className="text-[11px] text-gray-500">
                    Output: <span className="font-mono">{result.width}×{result.height}px</span> PNG
                    {options.removeBackground ? ` · ~${result.removedPercent}% background removed` : ''}
                  </p>
                )}
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="rounded-xl bg-violet-50/70 border border-violet-100 p-3 text-[11px] text-gray-600 leading-relaxed">
              <span className="font-semibold text-violet-800">Tip for best results:</span> If small pockets of wall remain (e.g., beside arms or shoulders), click{' '}
              <span className="font-semibold text-gray-900">Pick Extra BG Spot</span> and tap directly on those areas in the original photo. For complex busy backgrounds, you can also click{' '}
              <span className="font-semibold text-gray-900">Upload Edited PNG</span> in the Admin panel to upload a pre-cut transparent PNG.
            </div>
          </div>

          {/* Right: Background Removal & Lighting Sliders */}
          <div className="lg:col-span-5 space-y-4">
            {/* Background Removal Controls */}
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-4 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Eraser className="w-4 h-4 text-violet-600" />
                  <span className="text-xs font-bold text-gray-900">Background Removal</span>
                </div>
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.removeBackground}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, removeBackground: e.target.checked }))
                    }
                    className="accent-violet-600"
                  />
                  Remove BG
                </label>
              </div>

              {options.removeBackground && (
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-[11px] font-medium text-gray-700 mb-1">
                      <span>Background Tolerance</span>
                      <span className="font-mono text-violet-700">{options.tolerance}</span>
                    </div>
                    <input
                      type="range"
                      min={12}
                      max={90}
                      value={options.tolerance}
                      onChange={(e) =>
                        setOptions((prev) => ({ ...prev, tolerance: Number(e.target.value) }))
                      }
                      className="w-full accent-violet-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] font-medium text-gray-700 mb-1">
                      <span>Edge Feathering</span>
                      <span className="font-mono text-violet-700">{options.feather}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={4}
                      value={options.feather}
                      onChange={(e) =>
                        setOptions((prev) => ({ ...prev, feather: Number(e.target.value) }))
                      }
                      className="w-full accent-violet-600"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3 pt-1">
                    <label className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.purpleRimGlow}
                        onChange={(e) =>
                          setOptions((prev) => ({ ...prev, purpleRimGlow: e.target.checked }))
                        }
                        className="accent-violet-600"
                      />
                      Purple Edge Blend
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.autoFrame}
                        onChange={(e) =>
                          setOptions((prev) => ({ ...prev, autoFrame: e.target.checked }))
                        }
                        className="accent-violet-600"
                      />
                      Auto-Frame Portrait
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Lighting & Portrait Clarity Controls */}
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-violet-600" />
                  <span className="text-xs font-bold text-gray-900">Lighting &amp; Clarity</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOptions(DEFAULT_PORTRAIT_STUDIO_OPTIONS)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-medium text-gray-700 mb-1">
                  <span>Brightness</span>
                  <span className="font-mono text-gray-600">
                    {options.brightness > 0 ? `+${options.brightness}` : options.brightness}
                  </span>
                </div>
                <input
                  type="range"
                  min={-25}
                  max={30}
                  value={options.brightness}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, brightness: Number(e.target.value) }))
                  }
                  className="w-full accent-violet-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-medium text-gray-700 mb-1">
                  <span>Contrast</span>
                  <span className="font-mono text-gray-600">
                    {options.contrast > 0 ? `+${options.contrast}` : options.contrast}
                  </span>
                </div>
                <input
                  type="range"
                  min={-20}
                  max={35}
                  value={options.contrast}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, contrast: Number(e.target.value) }))
                  }
                  className="w-full accent-violet-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-medium text-gray-700 mb-1">
                  <span>Skin Tone Warmth</span>
                  <span className="font-mono text-gray-600">
                    {options.warmth > 0 ? `+${options.warmth}` : options.warmth}
                  </span>
                </div>
                <input
                  type="range"
                  min={-15}
                  max={25}
                  value={options.warmth}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, warmth: Number(e.target.value) }))
                  }
                  className="w-full accent-violet-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-medium text-gray-700 mb-1">
                  <span>Portrait Crispness</span>
                  <span className="font-mono text-gray-600">{options.sharpen}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={80}
                  value={options.sharpen}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, sharpen: Number(e.target.value) }))
                  }
                  className="w-full accent-violet-600"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={!result || processing || saving}
                onClick={() => {
                  if (result) {
                    void onApplyCutout(result, options.removeBackground);
                  }
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold cursor-pointer"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                {saving ? 'Saving PNG...' : 'Apply to ID Card & Profile'}
              </button>

              <button
                type="button"
                disabled={!result || processing}
                onClick={handleDownloadCutout}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 disabled:opacity-50 text-xs font-semibold text-gray-700 cursor-pointer"
                title="Download processed PNG"
              >
                <Download className="w-3.5 h-3.5 text-violet-600" />
                PNG
              </button>
            </div>
            <p className="text-[11px] text-gray-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-violet-500 shrink-0" />
              Saves with full alpha transparency for ID card back side &amp; homepage profile.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
