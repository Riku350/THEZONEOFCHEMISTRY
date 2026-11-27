import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Edit3,
  Eraser,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  IdCard,
  Image as ImageIcon,
  Layers,
  Link2,
  Loader2,
  Pin,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { DEFAULT_ID_CARD_MOTIVATIONAL_MESSAGE } from '../config/defaults';
import {
  DEFAULT_SCHEDULED_DAYS,
  formatScheduledDaysSummary,
  WEEKDAY_LABELS,
} from '../lib/attendanceUtils';
import {
  addAuthorizedAdmin,
  addGalleryPhoto,
  deleteBanner,
  deleteBatch,
  deleteCourse,
  deleteGalleryPhoto,
  deleteNotice,
  removeAuthorizedAdmin,
  reorderBanners,
  sanitizeBannerCtaTarget,
  saveBanner,
  saveBatch,
  saveCourse,
  saveInstituteSettings,
  saveNotice,
  uploadTeacherProfilePhoto,
} from '../lib/firestoreService';
import {
  CR80_HEIGHT_MM,
  CR80_WIDTH_MM,
  downloadIdCardPdf,
  renderIdCardBothSidesDataUrls,
} from '../lib/idCardRenderer';
import { resolveMediaSource } from '../lib/media';
import {
  detectImageHasTransparency,
  PortraitCutoutResult,
  renderTeacherBannerPreviewDataUrl,
} from '../lib/teacherPortraitStudio';
import {
  AdminUserRecord,
  BannerItem,
  BatchItem,
  CourseItem,
  GalleryItem,
  InstituteSettings,
  NoticeCategory,
  NoticeItem,
  StudentRecord,
} from '../types';
import { ResolvedImage } from './ResolvedImage';
import { TeacherPortraitStudioModal } from './TeacherPortraitStudioModal';

const inputCls =
  'w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors';

// -----------------------------------------------------------------------------
// 1. HOMEPAGE BANNERS MANAGEMENT (Promotional Slider Above Batch Timings)
// -----------------------------------------------------------------------------
const CTA_PRESET_OPTIONS = [
  { value: 'apply', label: 'Apply for Admission Page' },
  { value: 'attendance', label: 'My Attendance Portal' },
  { value: 'track', label: 'Track My Admission' },
  { value: '#courses', label: 'Homepage — Courses Section' },
  { value: '#batches', label: 'Homepage — Batch Timings' },
  { value: '#about', label: 'Homepage — About Teacher' },
  { value: '#gallery', label: 'Homepage — Photo Gallery' },
  { value: '#contact', label: 'Homepage — Contact Us' },
  { value: 'whatsapp', label: 'Chat on WhatsApp' },
  { value: 'custom', label: 'Custom External Link (https://...)' },
  { value: '', label: 'No Button' },
] as const;

const KNOWN_CTA_PRESETS = new Set<string>([
  '',
  'apply',
  'attendance',
  'track',
  '#courses',
  '#batches',
  '#about',
  '#gallery',
  '#contact',
  'whatsapp',
]);

export const AdminBannersPanel: React.FC<{
  banners: BannerItem[];
  settings: InstituteSettings;
}> = ({ banners, settings }) => {
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [description, setDescription] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [ctaLabel, setCtaLabel] = useState('Apply for Admission');
  const [ctaPreset, setCtaPreset] = useState<string>('apply');
  const [customCtaUrl, setCustomCtaUrl] = useState('');
  const [order, setOrder] = useState(String(banners.length + 1));
  const [active, setActive] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [existingUrl, setExistingUrl] = useState('');
  const [existingMediaId, setExistingMediaId] = useState('');
  const [busy, setBusy] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [msg, setMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');

  // Slider auto-timing state synced to /settings/main
  const [sliderIntervalSec, setSliderIntervalSec] = useState<number>(
    settings.bannerSliderIntervalSec ?? 5
  );
  const [sliderAutoSlide, setSliderAutoSlide] = useState<boolean>(
    settings.bannerAutoSlide !== false
  );
  const [savingTiming, setSavingTiming] = useState(false);

  useEffect(() => {
    setSliderIntervalSec(settings.bannerSliderIntervalSec ?? 5);
    setSliderAutoSlide(settings.bannerAutoSlide !== false);
  }, [settings.bannerSliderIntervalSec, settings.bannerAutoSlide]);

  useEffect(() => {
    if (!file) {
      setFilePreviewUrl('');
      return;
    }
    const objUrl = URL.createObjectURL(file);
    setFilePreviewUrl(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [file]);

  const sortedBanners = useMemo(
    () => [...banners].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [banners]
  );

  const resetForm = () => {
    setTitle('');
    setSubtitle('');
    setDescription('');
    setAnnouncement('');
    setCtaLabel('Apply for Admission');
    setCtaPreset('apply');
    setCustomCtaUrl('');
    setOrder(String(banners.length + 1));
    setActive(true);
    setFile(null);
    setEditingId(null);
    setExistingUrl('');
    setExistingMediaId('');
    setErrMsg('');
  };

  const handleSaveSliderTiming = async () => {
    setSavingTiming(true);
    setMsg('');
    setErrMsg('');
    try {
      const { id: _id, updatedAt: _u, ...rest } = settings;
      await saveInstituteSettings({
        ...rest,
        bannerSliderIntervalSec: Math.max(2, Math.min(30, Number(sliderIntervalSec) || 5)),
        bannerAutoSlide: sliderAutoSlide,
      });
      setMsg(
        sliderAutoSlide
          ? `Homepage banner slider timing saved (${sliderIntervalSec}s auto-slide).`
          : 'Homepage banner slider set to manual mode.'
      );
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to save slider timing.');
    } finally {
      setSavingTiming(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setErrMsg('');
    setMsg('');

    let resolvedTarget = '';
    if (ctaPreset === 'custom') {
      const candidate = customCtaUrl.trim();
      const validated = sanitizeBannerCtaTarget(candidate);
      if (!validated) {
        setErrMsg('Custom button destination must be a valid https:// URL.');
        return;
      }
      resolvedTarget = validated;
    } else {
      resolvedTarget = ctaPreset;
    }

    setBusy(true);
    try {
      await saveBanner(
        {
          id: editingId || undefined,
          title,
          subtitle,
          description,
          announcement,
          ctaLabel: resolvedTarget ? ctaLabel : '',
          ctaTarget: resolvedTarget,
          imageUrl: existingUrl,
          mediaId: existingMediaId,
          order: Number(order) || 1,
          active,
        },
        file
      );
      resetForm();
      setMsg(
        editingId
          ? 'Promotional banner updated and synced to homepage.'
          : 'New promotional banner published to homepage.'
      );
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unable to save banner.');
    } finally {
      setBusy(false);
    }
  };

  const handleMoveBanner = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= sortedBanners.length) return;
    setReordering(true);
    setErrMsg('');
    try {
      const copy = [...sortedBanners];
      const [moved] = copy.splice(index, 1);
      copy.splice(targetIdx, 0, moved);
      await reorderBanners(copy);
      setMsg('Banner slide order updated.');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Could not update banner order.');
    } finally {
      setReordering(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">
            Homepage Banners
          </h2>
          <p className="text-xs sm:text-sm text-gray-500">
            Manage the responsive promotional banner slider displayed above Batch Timings on the homepage.
          </p>
        </div>

        {/* Automatic Slider Timing Bar */}
        <div className="app-card rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={sliderAutoSlide}
              onChange={(e) => setSliderAutoSlide(e.target.checked)}
              className="accent-violet-600"
            />
            Auto-Slide
          </label>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-violet-600" />
            <select
              aria-label="Automatic slider interval"
              value={sliderIntervalSec}
              disabled={!sliderAutoSlide}
              onChange={(e) => setSliderIntervalSec(Number(e.target.value))}
              className="rounded-lg bg-gray-50 border border-gray-200 px-2 py-1 text-xs font-mono text-gray-800 disabled:opacity-50"
            >
              {[3, 4, 5, 6, 8, 10, 12, 15].map((sec) => (
                <option key={sec} value={sec}>
                  {sec}s / slide
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={savingTiming}
            onClick={() => void handleSaveSliderTiming()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
          >
            {savingTiming ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save Timing
          </button>
        </div>
      </div>

      {msg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs sm:text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      {errMsg && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs sm:text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <form onSubmit={handleSubmit} className="lg:col-span-5 app-card rounded-2xl p-5 space-y-3.5">
          <h3 className="font-display text-base font-bold text-gray-900">
            {editingId ? 'Edit Promotional Banner' : 'Add Promotional Banner'}
          </h3>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Banner Title *</label>
            <input
              type="text"
              required
              maxLength={140}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., NEET 2027 Chemistry Target Batch"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Subtitle</label>
            <input
              type="text"
              maxLength={180}
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="e.g., Session 2026–2027 · Guided by Sonu Sir #Baba"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Highlight Tag / Announcement (Optional)
            </label>
            <input
              type="text"
              maxLength={240}
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              placeholder="e.g., Admissions Open — Limited Seats"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea
              rows={2}
              maxLength={480}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short promotional highlight shown on the banner..."
              className={inputCls}
            />
          </div>

          {/* Call-to-Action Button & Destination */}
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-3.5 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-800">
              <Link2 className="w-3.5 h-3.5 text-violet-600" />
              Call-to-Action Button
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Button Label
                </label>
                <input
                  type="text"
                  maxLength={60}
                  value={ctaLabel}
                  disabled={!ctaPreset}
                  onChange={(e) => setCtaLabel(e.target.value)}
                  placeholder="e.g., Apply Now"
                  className={`${inputCls} disabled:opacity-50`}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Button Destination
                </label>
                <select
                  value={ctaPreset}
                  onChange={(e) => setCtaPreset(e.target.value)}
                  className={inputCls}
                >
                  {CTA_PRESET_OPTIONS.map((opt) => (
                    <option key={opt.value || 'none'} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {ctaPreset === 'custom' && (
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  External HTTPS URL *
                </label>
                <input
                  type="url"
                  required
                  maxLength={300}
                  value={customCtaUrl}
                  onChange={(e) => setCustomCtaUrl(e.target.value)}
                  placeholder="https://example.com/brochure"
                  className={`${inputCls} font-mono text-xs`}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Slide Order</label>
              <input
                type="number"
                min={1}
                max={999}
                value={order}
                onChange={(e) => setOrder(e.target.value)}
                className={`${inputCls} font-mono`}
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer pb-2.5">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="accent-violet-600"
                />
                Active on Homepage
              </label>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-700">
                Banner Image (Recommended 16:9 / Wide)
              </label>
              {(file || existingUrl || existingMediaId) && (
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setExistingUrl('');
                    setExistingMediaId('');
                  }}
                  className="text-[11px] font-semibold text-red-600 hover:underline cursor-pointer"
                >
                  Remove Image
                </button>
              )}
            </div>

            {(filePreviewUrl || existingUrl || existingMediaId) && (
              <div className="mb-2 aspect-[16/9] rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
                {filePreviewUrl ? (
                  <img
                    src={filePreviewUrl}
                    alt="Selected banner preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ResolvedImage
                    url={existingUrl}
                    mediaId={existingMediaId}
                    alt={title || 'Banner preview'}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
            )}

            <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-violet-50 border border-dashed border-gray-300 hover:border-violet-400 text-xs font-semibold text-violet-700 cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              {file ? file.name : existingUrl || existingMediaId ? 'Replace Banner Image' : 'Upload Banner Image'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId ? 'Update Banner' : 'Publish Banner'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="lg:col-span-7 space-y-3">
          {sortedBanners.length === 0 ? (
            <div className="app-card rounded-2xl p-8 text-center text-xs sm:text-sm text-gray-500">
              No custom banners uploaded yet. Add a promotional banner on the left to replace the default homepage slides.
            </div>
          ) : (
            sortedBanners.map((b, idx) => (
              <div
                key={b.id}
                className="app-card rounded-2xl p-3.5 flex flex-col sm:flex-row gap-3.5 items-start"
              >
                <div className="w-full sm:w-40 aspect-[16/10] rounded-xl overflow-hidden bg-violet-50 border border-gray-200 shrink-0">
                  <ResolvedImage
                    url={b.imageUrl}
                    mediaId={b.mediaId}
                    alt={b.title}
                    className="w-full h-full object-cover"
                    fallbackLabel="Banner"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                    <span className="font-mono font-semibold text-violet-700">Slide #{idx + 1}</span>
                    <span
                      className={
                        b.active
                          ? 'px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-semibold text-[11px]'
                          : 'px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 font-semibold text-[11px]'
                      }
                    >
                      {b.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <h4 className="font-display font-bold text-gray-900 text-sm mt-1">{b.title}</h4>
                  {b.subtitle && (
                    <p className="text-xs text-violet-700 font-medium mt-0.5">{b.subtitle}</p>
                  )}
                  {b.announcement && (
                    <p className="text-[11px] text-gray-500 mt-0.5">{b.announcement}</p>
                  )}
                  {b.description && (
                    <p className="text-xs text-gray-600 mt-1 line-clamp-2">{b.description}</p>
                  )}
                  {b.ctaLabel && b.ctaTarget && (
                    <p className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 border border-violet-100 text-[11px] font-semibold text-violet-700">
                      Button: {b.ctaLabel} → <span className="font-mono">{b.ctaTarget}</span>
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={reordering || idx === 0}
                      title="Move banner up"
                      onClick={() => void handleMoveBanner(idx, -1)}
                      className="p-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-600 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={reordering || idx === sortedBanners.length - 1}
                      title="Move banner down"
                      onClick={() => void handleMoveBanner(idx, 1)}
                      className="p-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-600 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(b.id);
                        setTitle(b.title);
                        setSubtitle(b.subtitle || '');
                        setDescription(b.description || '');
                        setAnnouncement(b.announcement || '');
                        setCtaLabel(b.ctaLabel || '');
                        const target = b.ctaTarget || '';
                        if (KNOWN_CTA_PRESETS.has(target)) {
                          setCtaPreset(target);
                          setCustomCtaUrl('');
                        } else {
                          setCtaPreset('custom');
                          setCustomCtaUrl(target);
                        }
                        setOrder(String(b.order || idx + 1));
                        setActive(b.active);
                        setExistingUrl(b.imageUrl || '');
                        setExistingMediaId(b.mediaId || '');
                        setFile(null);
                        setErrMsg('');
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void saveBanner({
                          id: b.id,
                          title: b.title,
                          subtitle: b.subtitle,
                          description: b.description,
                          announcement: b.announcement,
                          ctaLabel: b.ctaLabel,
                          ctaTarget: b.ctaTarget,
                          imageUrl: b.imageUrl,
                          mediaId: b.mediaId,
                          order: b.order,
                          active: !b.active,
                        })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer"
                    >
                      {b.active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {b.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteBanner(b.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-xs font-semibold text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 2. GALLERY MANAGEMENT
// -----------------------------------------------------------------------------
export const AdminGalleryPanel: React.FC<{ gallery: GalleryItem[] }> = ({ gallery }) => {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Classroom');
  const [customCategory, setCustomCategory] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;
    setBusy(true);
    setMsg('');
    const finalCat = category === 'Custom' && customCategory.trim() ? customCategory.trim() : category;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const photoTitle =
          title.trim()
            ? files.length > 1
              ? `${title.trim()} (${i + 1})`
              : title.trim()
            : f.name.replace(/\.[^.]+$/, '');
        await addGalleryPhoto(photoTitle, finalCat, f);
      }
      setTitle('');
      setFiles([]);
      setMsg(`Uploaded ${files.length} photo(s).`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">Photo Gallery</h2>
        <p className="text-xs sm:text-sm text-gray-500">
          Upload classroom, lab, and achievement photos with categories.
        </p>
      </div>

      {msg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs sm:text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      <form onSubmit={handleUpload} className="app-card rounded-2xl p-4 sm:p-5 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        <div className="md:col-span-4">
          <label className="block text-xs font-medium text-gray-700 mb-1">Photo Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Organic Lab Session"
            className={inputCls}
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputCls}
          >
            <option value="Classroom">Classroom</option>
            <option value="Laboratory">Laboratory</option>
            <option value="Events">Events</option>
            <option value="Achievements">Achievements</option>
            <option value="Institute">Institute</option>
            <option value="Custom">Custom...</option>
          </select>
        </div>
        {category === 'Custom' && (
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Custom Name</label>
            <input
              type="text"
              required
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="Category"
              className={inputCls}
            />
          </div>
        )}
        <div className="md:col-span-3">
          <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gray-50 hover:bg-violet-50 border border-dashed border-gray-300 hover:border-violet-400 text-xs font-semibold text-violet-700 cursor-pointer transition-colors">
            <Upload className="w-4 h-4" />
            {files.length > 0 ? `${files.length} selected` : 'Select Photo(s)'}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="hidden"
            />
          </label>
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={busy || files.length === 0}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Upload
          </button>
        </div>
      </form>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
        {gallery.map((g) => (
          <div key={g.id} className="app-card rounded-2xl overflow-hidden flex flex-col">
            <div className="aspect-[4/3] bg-gray-100">
              <ResolvedImage
                url={g.imageUrl}
                mediaId={g.mediaId}
                alt={g.title}
                className="w-full h-full object-cover"
                fallbackLabel={g.title}
              />
            </div>
            <div className="p-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-violet-700">{g.category}</p>
                <p className="text-xs font-semibold text-gray-900 truncate">{g.title}</p>
              </div>
              <button
                type="button"
                aria-label="Delete photo"
                onClick={() => void deleteGalleryPhoto(g.id)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 3. NOTICES, COURSES & BATCHES MANAGEMENT
// -----------------------------------------------------------------------------
export const AdminNoticesAndCatalogPanel: React.FC<{
  notices: NoticeItem[];
  courses: CourseItem[];
  batches: BatchItem[];
}> = ({ notices, courses, batches }) => {
  const [section, setSection] = useState<'notices' | 'courses' | 'batches'>('notices');
  const [busy, setBusy] = useState(false);

  const [nTitle, setNTitle] = useState('');
  const [nContent, setNContent] = useState('');
  const [nCategory, setNCategory] = useState<NoticeCategory>('Admission');
  const [nPinned, setNPinned] = useState(false);

  const [cTitle, setCTitle] = useState('');
  const [cCategory, setCCategory] = useState('');
  const [cTarget, setCTarget] = useState('');
  const [cDuration, setCDuration] = useState('10 Months');
  const [cFee, setCFee] = useState('5500');
  const [cDesc, setCDesc] = useState('');

  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [bName, setBName] = useState('');
  const [bTiming, setBTiming] = useState('');
  const [bCapacity, setBCapacity] = useState('60');
  const [bFeeOverride, setBFeeOverride] = useState('');
  const [bScheduledDays, setBScheduledDays] = useState<number[]>(DEFAULT_SCHEDULED_DAYS);
  const [bStartDate, setBStartDate] = useState('');

  const handleAddNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nTitle.trim() || !nContent.trim()) return;
    setBusy(true);
    try {
      await saveNotice({
        title: nTitle,
        content: nContent,
        category: nCategory,
        pinned: nPinned,
        active: true,
      });
      setNTitle('');
      setNContent('');
      setNPinned(false);
    } finally {
      setBusy(false);
    }
  };

  const handleAddCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cTitle.trim()) return;
    setBusy(true);
    try {
      await saveCourse({
        title: cTitle,
        category: cCategory || 'Chemistry',
        targetClass: cTarget,
        duration: cDuration,
        description: cDesc,
        feeAmount: Number(cFee) || 5500,
        active: true,
        order: courses.length + 1,
      });
      setCTitle('');
      setCCategory('');
      setCTarget('');
      setCDesc('');
      setCFee('5500');
    } finally {
      setBusy(false);
    }
  };

  const resetBatchForm = () => {
    setEditingBatchId(null);
    setBName('');
    setBTiming('');
    setBCapacity('60');
    setBFeeOverride('');
    setBScheduledDays(DEFAULT_SCHEDULED_DAYS);
    setBStartDate('');
  };

  const toggleBatchWeekday = (dayNum: number) => {
    setBScheduledDays((prev) => {
      if (prev.includes(dayNum)) {
        return prev.length > 1 ? prev.filter((d) => d !== dayNum) : prev;
      }
      return [...prev, dayNum].sort((a, b) => a - b);
    });
  };

  const handleAddBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bName.trim() || !bTiming.trim()) return;
    setBusy(true);
    try {
      const existingBatch = editingBatchId ? batches.find((b) => b.id === editingBatchId) : null;
      await saveBatch({
        id: editingBatchId || undefined,
        name: bName,
        timing: bTiming,
        capacity: Number(bCapacity) || 60,
        feeOverride: bFeeOverride ? Number(bFeeOverride) : null,
        scheduledDays: bScheduledDays.length > 0 ? bScheduledDays : DEFAULT_SCHEDULED_DAYS,
        scheduleStartDate: bStartDate,
        active: existingBatch ? existingBatch.active : true,
        order: existingBatch ? existingBatch.order : batches.length + 1,
      });
      resetBatchForm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">
            Notices, Courses & Batches
          </h2>
          <p className="text-xs sm:text-sm text-gray-500">
            Manage public notice board, courses, and batch timings.
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-gray-100 border border-gray-200/80">
          {(['notices', 'courses', 'batches'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSection(tab)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold capitalize cursor-pointer transition-colors ${
                section === tab
                  ? 'bg-white text-violet-700 shadow-2xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {section === 'notices' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form onSubmit={handleAddNotice} className="lg:col-span-5 app-card rounded-2xl p-5 space-y-3.5">
            <h3 className="font-display text-base font-bold text-gray-900">Post Notice</h3>
            <input
              type="text"
              required
              value={nTitle}
              onChange={(e) => setNTitle(e.target.value)}
              placeholder="Notice Title"
              className={inputCls}
            />
            <textarea
              rows={3}
              required
              value={nContent}
              onChange={(e) => setNContent(e.target.value)}
              placeholder="Announcement details..."
              className={inputCls}
            />
            <div className="flex items-center justify-between gap-3">
              <select
                value={nCategory}
                onChange={(e) => setNCategory(e.target.value as NoticeCategory)}
                className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-900"
              >
                <option value="Admission">Admission</option>
                <option value="Exam">Exam</option>
                <option value="Schedule">Schedule</option>
                <option value="General">General</option>
              </select>
              <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={nPinned}
                  onChange={(e) => setNPinned(e.target.checked)}
                  className="accent-violet-600"
                />
                Pin to Top
              </label>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold cursor-pointer"
            >
              Publish Notice
            </button>
          </form>

          <div className="lg:col-span-7 space-y-3">
            {notices.map((n) => (
              <div key={n.id} className="app-card rounded-2xl p-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-violet-700">
                    {n.category} {n.pinned ? '· Pinned' : ''} · {n.active ? 'Visible' : 'Hidden'}
                  </p>
                  <h4 className="font-display font-bold text-gray-900 text-sm mt-0.5">{n.title}</h4>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">{n.content}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title="Toggle Pin"
                    onClick={() =>
                      void saveNotice({
                        id: n.id,
                        title: n.title,
                        content: n.content,
                        category: n.category,
                        pinned: !n.pinned,
                        active: n.active,
                      })
                    }
                    className={`p-1.5 rounded-lg cursor-pointer ${
                      n.pinned
                        ? 'text-violet-700 bg-violet-50'
                        : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <Pin className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    title="Delete Notice"
                    onClick={() => void deleteNotice(n.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'courses' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form onSubmit={handleAddCourse} className="lg:col-span-5 app-card rounded-2xl p-5 space-y-3">
            <h3 className="font-display text-base font-bold text-gray-900">Add Course</h3>
            <input
              type="text"
              required
              value={cTitle}
              onChange={(e) => setCTitle(e.target.value)}
              placeholder="Course Title (e.g., NEET Dropper Batch)"
              className={inputCls}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={cCategory}
                onChange={(e) => setCCategory(e.target.value)}
                placeholder="Category"
                className={inputCls}
              />
              <input
                type="number"
                required
                min={0}
                value={cFee}
                onChange={(e) => setCFee(e.target.value)}
                placeholder="Fee (INR)"
                className={`${inputCls} font-mono`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={cTarget}
                onChange={(e) => setCTarget(e.target.value)}
                placeholder="Target Class"
                className={inputCls}
              />
              <input
                type="text"
                value={cDuration}
                onChange={(e) => setCDuration(e.target.value)}
                placeholder="Duration"
                className={inputCls}
              />
            </div>
            <textarea
              rows={2}
              value={cDesc}
              onChange={(e) => setCDesc(e.target.value)}
              placeholder="Short syllabus overview..."
              className={inputCls}
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold cursor-pointer"
            >
              Add Course
            </button>
          </form>

          <div className="lg:col-span-7 space-y-2.5">
            {courses.map((c) => (
              <div key={c.id} className="app-card rounded-2xl p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{c.title}</p>
                  <p className="text-xs text-gray-500">
                    {c.category} · {c.duration} · {c.active ? 'Active' : 'Inactive'}
                  </p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="font-mono font-bold text-violet-700 tabular-nums text-sm">
                    ₹{c.feeAmount.toLocaleString('en-IN')}
                  </span>
                  <button
                    type="button"
                    onClick={() => void deleteCourse(c.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'batches' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form onSubmit={handleAddBatch} className="lg:col-span-5 app-card rounded-2xl p-5 space-y-3.5">
            <h3 className="font-display text-base font-bold text-gray-900">
              {editingBatchId ? 'Edit Batch & Schedule' : 'Add Batch Slot'}
            </h3>
            <input
              type="text"
              required
              value={bName}
              onChange={(e) => setBName(e.target.value)}
              placeholder="Batch Name (e.g., Morning Rankers)"
              className={inputCls}
            />
            <input
              type="text"
              required
              value={bTiming}
              onChange={(e) => setBTiming(e.target.value)}
              placeholder="Timing (e.g., 6 AM – 8 AM)"
              className={inputCls}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                min={1}
                value={bCapacity}
                onChange={(e) => setBCapacity(e.target.value)}
                placeholder="Capacity"
                className={`${inputCls} font-mono`}
              />
              <input
                type="number"
                min={0}
                value={bFeeOverride}
                onChange={(e) => setBFeeOverride(e.target.value)}
                placeholder="Fee Override"
                className={`${inputCls} font-mono`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                Scheduled Class Days (For Attendance Calculation)
              </label>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_LABELS.map((label, idx) => {
                  const active = bScheduledDays.includes(idx);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleBatchWeekday(idx)}
                      className={`py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                        active
                          ? 'bg-violet-600 border-violet-600 text-white'
                          : 'bg-gray-50 border-gray-200 text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                Unselected weekdays automatically show as &ldquo;Class Not Scheduled&rdquo; and never count as absences.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Batch Start Date (Optional)
              </label>
              <input
                type="date"
                value={bStartDate}
                onChange={(e) => setBStartDate(e.target.value)}
                className={`${inputCls} font-mono`}
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold cursor-pointer"
              >
                {editingBatchId ? 'Update Batch' : 'Add Batch Timing'}
              </button>
              {editingBatchId && (
                <button
                  type="button"
                  onClick={resetBatchForm}
                  className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <div className="lg:col-span-7 space-y-2.5">
            {batches.map((b) => (
              <div key={b.id} className="app-card rounded-2xl p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{b.timing}</p>
                  <p className="text-xs text-gray-500">
                    {b.name} · Capacity {b.capacity || 60}
                    {b.feeOverride ? ` · Batch Fee ₹${b.feeOverride.toLocaleString('en-IN')}` : ''}
                  </p>
                  <p className="text-[11px] text-violet-700 font-medium mt-0.5">
                    Classes: {formatScheduledDaysSummary(b.scheduledDays)}
                    {b.scheduleStartDate ? ` · Starts ${b.scheduleStartDate}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title="Edit batch"
                    onClick={() => {
                      setEditingBatchId(b.id);
                      setBName(b.name);
                      setBTiming(b.timing);
                      setBCapacity(String(b.capacity || 60));
                      setBFeeOverride(b.feeOverride ? String(b.feeOverride) : '');
                      setBScheduledDays(
                        b.scheduledDays && b.scheduledDays.length > 0
                          ? b.scheduledDays
                          : DEFAULT_SCHEDULED_DAYS
                      );
                      setBStartDate(b.scheduleStartDate || '');
                    }}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-violet-700 hover:bg-violet-50 cursor-pointer"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    title="Delete batch"
                    onClick={() => void deleteBatch(b.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// 4. INSTITUTE SETTINGS, DOUBLE-SIDED ID CARD STUDIO & ADMIN ACCOUNTS
// -----------------------------------------------------------------------------
const PREVIEW_SAMPLE_STUDENT: StudentRecord = {
  id: 'PREVIEW-SAMPLE',
  studentId: 'ZOC-2026-000001',
  applicationId: 'APP-PREVIEW',
  applicationNumber: 'APP-2026-0001',
  securityCode: '4821',
  qrToken: 'ZOC:PREVIEW-SAMPLE',
  studentName: 'Sample Student Name',
  studentMobile: '0000000000',
  fatherName: 'Sample Father Name',
  studentClass: '12th',
  course: 'NEET / JEE Chemistry',
  batch: 'Morning Batch (7:00 AM)',
  photoUrl: '',
  feeAmount: 0,
  paidAmount: 0,
  paymentStatus: 'PENDING',
  status: 'active',
  academicSession: '2026–2027',
  approvedAt: null,
  updatedAt: null,
};

export const AdminSettingsPanel: React.FC<{
  settings: InstituteSettings;
  admins: AdminUserRecord[];
  students?: StudentRecord[];
  initialSubTab?: 'general' | 'idcard';
}> = ({ settings, admins, students = [], initialSubTab = 'general' }) => {
  const [subTab, setSubTab] = useState<'general' | 'idcard'>(initialSubTab);
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // ID Card Studio preview state
  const [previewStudentId, setPreviewStudentId] = useState<string>('');
  const [previewSide, setPreviewSide] = useState<'both' | 'front' | 'back'>('both');
  const [previewFrontUrl, setPreviewFrontUrl] = useState('');
  const [previewBackUrl, setPreviewBackUrl] = useState('');
  const [renderingPreview, setRenderingPreview] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // On-Device Teacher Portrait & Background Studio + Banner Preview state
  const [studioSourceUrl, setStudioSourceUrl] = useState<string | null>(null);
  const [savingStudioCutout, setSavingStudioCutout] = useState(false);
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState<string | null>(null);
  const [renderingBannerPreview, setRenderingBannerPreview] = useState(false);

  const [newUid, setNewUid] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    if (!previewStudentId && students.length > 0) {
      setPreviewStudentId(students[0].studentId);
    }
  }, [students, previewStudentId]);

  const previewStudent = useMemo<StudentRecord>(() => {
    const match = students.find((s) => s.studentId === previewStudentId) || students[0];
    if (match) return match;
    return {
      ...PREVIEW_SAMPLE_STUDENT,
      academicSession: form.academicSession || '2026–2027',
    };
  }, [students, previewStudentId, form.academicSession]);

  // Live CR80 Front + Back preview whenever on the ID Card sub-tab
  useEffect(() => {
    if (subTab !== 'idcard') return;
    let active = true;
    setRenderingPreview(true);
    const timer = window.setTimeout(() => {
      void renderIdCardBothSidesDataUrls(previewStudent, form)
        .then(({ frontUrl, backUrl }) => {
          if (active) {
            setPreviewFrontUrl(frontUrl);
            setPreviewBackUrl(backUrl);
          }
        })
        .finally(() => {
          if (active) setRenderingPreview(false);
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [subTab, previewStudent, form]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSavedMsg('');
    setErrorMsg('');
    try {
      const { id: _id, updatedAt: _u, ...rest } = form;
      await saveInstituteSettings(rest);
      setSavedMsg(
        subTab === 'idcard'
          ? 'Teacher profile, portrait banner, and Double-Sided ID Card settings saved to Firebase.'
          : 'Institute settings saved.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setBusy(false);
    }
  };

  // Upload Original Teacher Photo -> persists original + opens On-Device Background Removal Studio
  const handleUploadOriginalTeacherPhoto = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid JPG, PNG, or WebP image for the teacher photograph.');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setErrorMsg('Teacher photograph must be smaller than 6 MB.');
      return;
    }

    setUploadingPhoto(true);
    setErrorMsg('');
    setSavedMsg('');
    try {
      // Read local data URL immediately so Canvas background removal never hits CORS issues
      const localDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read uploaded image.'));
        reader.readAsDataURL(file);
      });

      const uploadedOriginal = await uploadTeacherProfilePhoto(file, false, file.name);
      const nextForm: InstituteSettings = {
        ...form,
        teacherPhotoOriginalUrl: uploadedOriginal.url || '',
        teacherPhotoOriginalMediaId: uploadedOriginal.mediaId || '',
        teacherPhotoUrl: uploadedOriginal.url || '',
        teacherPhotoMediaId: uploadedOriginal.mediaId || '',
        teacherPhotoIsCutout: false,
      };
      setForm(nextForm);
      const { id: _id, updatedAt: _u, ...rest } = nextForm;
      await saveInstituteSettings(rest);

      // Immediately open interactive On-Device Background Removal & Portrait Studio
      setStudioSourceUrl(localDataUrl);
      setSavedMsg(
        'Original teacher photo uploaded. Use the Portrait Studio to remove the background and balance lighting, or close to keep the standard photo.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not upload teacher photograph.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Direct Upload of an externally edited Transparent PNG Cutout
  const handleUploadEditedPng = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid PNG image file.');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setErrorMsg('Edited PNG file must be smaller than 6 MB.');
      return;
    }

    setUploadingPhoto(true);
    setErrorMsg('');
    setSavedMsg('');
    try {
      const hasAlpha = await detectImageHasTransparency(file);
      const uploadedPng = await uploadTeacherProfilePhoto(file, true, file.name);
      const nextForm: InstituteSettings = {
        ...form,
        teacherPhotoUrl: uploadedPng.url || '',
        teacherPhotoMediaId: uploadedPng.mediaId || '',
        teacherPhotoIsCutout: hasAlpha,
      };
      setForm(nextForm);
      const { id: _id, updatedAt: _u, ...rest } = nextForm;
      await saveInstituteSettings(rest);
      setSavedMsg(
        hasAlpha
          ? 'Transparent PNG cutout uploaded and applied to ID Card back side and Teacher Profile.'
          : 'Edited PNG uploaded and applied to ID Card back side and Teacher Profile.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not upload edited PNG.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Open Background Removal Studio on currently stored Original (or active) photo
  const handleOpenBackgroundStudio = async () => {
    setErrorMsg('');
    const source = await resolveMediaSource(
      form.teacherPhotoOriginalUrl || form.teacherPhotoUrl,
      form.teacherPhotoOriginalMediaId || form.teacherPhotoMediaId,
      false
    );
    if (!source) {
      setErrorMsg('Please upload an original teacher photograph first.');
      return;
    }
    setStudioSourceUrl(source);
  };

  // Save processed transparent PNG cutout from local Canvas Studio
  const handleApplyStudioCutout = async (result: PortraitCutoutResult, isCutout: boolean) => {
    setSavingStudioCutout(true);
    setErrorMsg('');
    setSavedMsg('');
    try {
      const uploaded = await uploadTeacherProfilePhoto(
        result.pngBlob,
        true,
        `${(form.teacherName || 'teacher').replace(/\s+/g, '_')}_cutout.png`
      );
      const nextForm: InstituteSettings = {
        ...form,
        teacherPhotoUrl: uploaded.url || '',
        teacherPhotoMediaId: uploaded.mediaId || '',
        teacherPhotoIsCutout: isCutout,
      };
      setForm(nextForm);
      const { id: _id, updatedAt: _u, ...rest } = nextForm;
      await saveInstituteSettings(rest);
      setStudioSourceUrl(null);
      setSavedMsg(
        isCutout
          ? 'Transparent PNG portrait cutout saved and applied to ID Card back side & homepage.'
          : 'Enhanced teacher portrait saved and applied to ID Card back side & homepage.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save processed cutout.');
    } finally {
      setSavingStudioCutout(false);
    }
  };

  const handleOpenTeacherBannerPreview = async () => {
    setRenderingBannerPreview(true);
    setErrorMsg('');
    try {
      const url = await renderTeacherBannerPreviewDataUrl(form);
      setBannerPreviewUrl(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not render teacher banner preview.');
    } finally {
      setRenderingBannerPreview(false);
    }
  };

  const handleRemoveTeacherPhoto = async () => {
    setBusy(true);
    setErrorMsg('');
    setSavedMsg('');
    try {
      const nextForm: InstituteSettings = {
        ...form,
        teacherPhotoUrl: '',
        teacherPhotoMediaId: '',
        teacherPhotoOriginalUrl: '',
        teacherPhotoOriginalMediaId: '',
        teacherPhotoIsCutout: false,
      };
      setForm(nextForm);
      const { id: _id, updatedAt: _u, ...rest } = nextForm;
      await saveInstituteSettings(rest);
      setSavedMsg('Teacher photograph removed from ID Card back side and Teacher Profile.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not remove teacher photograph.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadPreviewPdf = async () => {
    setDownloadingPdf(true);
    try {
      await downloadIdCardPdf(previewStudent, form);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handlePrintPreviewBothSides = () => {
    if (!previewFrontUrl || !previewBackUrl) return;
    document.body.classList.add('printing-cr80');
    const cleanup = () => {
      document.body.classList.remove('printing-cr80');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    window.setTimeout(cleanup, 1500);
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUid.trim() || !newEmail.trim()) return;
    setBusy(true);
    setErrorMsg('');
    try {
      await addAuthorizedAdmin(newUid, newEmail, newName || 'Institute Admin');
      setNewUid('');
      setNewEmail('');
      setNewName('');
      setSavedMsg('Authorized administrator added.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add administrator.');
    } finally {
      setBusy(false);
    }
  };

  const hasTeacherPhoto = Boolean(form.teacherPhotoUrl || form.teacherPhotoMediaId);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">
            Settings &amp; ID Card Management
          </h2>
          <p className="text-xs sm:text-sm text-gray-500">
            Configure institute details, admin accounts, and double-sided CR80 Student ID Card teacher branding.
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl bg-gray-100 border border-gray-200 self-start">
          <button
            type="button"
            onClick={() => setSubTab('general')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              subTab === 'general'
                ? 'bg-white text-violet-700 shadow-2xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            General &amp; Admins
          </button>
          <button
            type="button"
            onClick={() => setSubTab('idcard')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              subTab === 'idcard'
                ? 'bg-white text-violet-700 shadow-2xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <IdCard className="w-3.5 h-3.5" />
            ID Card &amp; Teacher Profile
          </button>
        </div>
      </div>

      {savedMsg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs sm:text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{savedMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs sm:text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {subTab === 'general' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form onSubmit={handleSave} className="lg:col-span-7 app-card rounded-2xl p-5 space-y-3.5">
            <h3 className="font-display text-base font-bold text-gray-900">General Settings</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Institute Name</label>
                <input
                  type="text"
                  required
                  value={form.instituteName}
                  onChange={(e) => setForm({ ...form, instituteName: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Lead Teacher</label>
                <input
                  type="text"
                  required
                  value={form.teacherName}
                  onChange={(e) => setForm({ ...form, teacherName: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Academic Session</label>
                <input
                  type="text"
                  value={form.academicSession}
                  onChange={(e) => setForm({ ...form, academicSession: e.target.value })}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Default Fee (INR)</label>
                <input
                  type="number"
                  min={0}
                  value={form.defaultFee}
                  onChange={(e) => setForm({ ...form, defaultFee: Number(e.target.value) })}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">WhatsApp (with 91)</label>
                <input
                  type="text"
                  value={form.whatsappNumber}
                  onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">ID Card Signature</label>
                <input
                  type="text"
                  value={form.signatureText}
                  onChange={(e) => setForm({ ...form, signatureText: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Admission Headline</label>
              <input
                type="text"
                value={form.admissionHeadline}
                onChange={(e) => setForm({ ...form, admissionHeadline: e.target.value })}
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
              <textarea
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className={inputCls}
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.admissionsOpen}
                  onChange={(e) => setForm({ ...form, admissionsOpen: e.target.checked })}
                  className="accent-violet-600"
                />
                Show &ldquo;Admissions Open&rdquo; Card on Homepage
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(form.attendanceExitTracking)}
                  onChange={(e) => setForm({ ...form, attendanceExitTracking: e.target.checked })}
                  className="accent-violet-600"
                />
                Enable Separate Entry &amp; Exit Time Recording in QR Attendance Scanner
              </label>
            </div>

            <div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold cursor-pointer"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Settings
              </button>
            </div>
          </form>

          <div className="lg:col-span-5 space-y-4">
            <form onSubmit={handleAddAdmin} className="app-card rounded-2xl p-5 space-y-3">
              <h3 className="font-display text-base font-bold text-gray-900">Add Admin</h3>
              <input
                type="text"
                required
                value={newUid}
                onChange={(e) => setNewUid(e.target.value)}
                placeholder="Firebase Auth User UID"
                className={`${inputCls} font-mono text-xs`}
              />
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Admin Email"
                className={inputCls}
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Display Name"
                className={inputCls}
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold cursor-pointer"
              >
                Grant Admin Access
              </button>
            </form>

            <div className="app-card rounded-2xl p-5">
              <h3 className="font-display text-sm font-bold text-gray-900 mb-3">
                Authorized Admins ({admins.length})
              </h3>
              <div className="space-y-2">
                {admins.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-xl bg-gray-50 border border-gray-200 p-3 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{a.displayName}</p>
                      <p className="text-[11px] text-gray-500 truncate">{a.email}</p>
                    </div>
                    {a.role !== 'owner' && (
                      <button
                        type="button"
                        onClick={() => void removeAuthorizedAdmin(a.uid)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* =============================================================== */
        /* ADMIN ID CARD & TEACHER PROFILE STUDIO (CR80 DOUBLE-SIDED)      */
        /* =============================================================== */
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Left: Teacher Profile & Back Side Portrait Studio */}
          <form onSubmit={handleSave} className="xl:col-span-6 app-card rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="font-display text-base font-bold text-gray-900">
                Teacher Portrait Studio (ID Card Back Side &amp; Homepage)
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Upload the actual photograph of {form.teacherName || 'SONU SIR #BABA'}, remove the background locally into a transparent PNG cutout, or upload an edited PNG directly.
              </p>
            </div>

            {/* On-Device Teacher Portrait & Background Studio Card */}
            <div className="rounded-2xl bg-violet-50/40 border border-violet-200/80 p-4 space-y-3.5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div
                  className={`w-24 h-28 rounded-xl overflow-hidden border shrink-0 flex items-end justify-center ${
                    form.teacherPhotoIsCutout && hasTeacherPhoto
                      ? 'border-violet-400 bg-gradient-to-b from-violet-600 via-violet-700 to-violet-900'
                      : 'border-violet-200 bg-violet-50'
                  }`}
                >
                  {hasTeacherPhoto ? (
                    <ResolvedImage
                      url={form.teacherPhotoUrl}
                      mediaId={form.teacherPhotoMediaId}
                      alt={form.teacherName || 'Teacher Photograph'}
                      className={
                        form.teacherPhotoIsCutout
                          ? 'w-full h-full object-contain object-bottom drop-shadow-md'
                          : 'w-full h-full object-cover object-top'
                      }
                    />
                  ) : (
                    <div className="m-auto text-center px-1.5">
                      <ImageIcon className="w-6 h-6 text-violet-400 mx-auto" />
                      <p className="text-[10px] font-semibold text-violet-700 mt-1 leading-tight">
                        No Photo
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-bold text-gray-900">
                      Official Teacher Portrait ({form.teacherName || 'SONU SIR #BABA'})
                    </p>
                    {hasTeacherPhoto && (
                      <span className="px-2 py-0.5 rounded-md bg-white border border-violet-200 text-[10px] font-semibold text-violet-700">
                        {form.teacherPhotoIsCutout ? 'Transparent PNG Cutout' : 'Standard Photo'}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-600 leading-relaxed">
                    Uses your actual uploaded photo with on-device background removal &amp; lighting adjustment (local browser canvas — no AI face alteration).
                  </p>
                </div>
              </div>

              {/* Action Controls Row */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold cursor-pointer transition-colors">
                  {uploadingPhoto ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {uploadingPhoto
                    ? 'Uploading...'
                    : hasTeacherPhoto
                    ? 'Replace Original Photo'
                    : 'Upload Original Photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploadingPhoto}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      e.target.value = '';
                      void handleUploadOriginalTeacherPhoto(f);
                    }}
                    className="hidden"
                  />
                </label>

                {hasTeacherPhoto && (
                  <button
                    type="button"
                    disabled={uploadingPhoto || busy}
                    onClick={() => void handleOpenBackgroundStudio()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-violet-50 border border-violet-300 text-xs font-semibold text-violet-700 cursor-pointer transition-colors"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    Remove Background &amp; Tune
                  </button>
                )}

                <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-800 cursor-pointer transition-colors">
                  <FileImage className="w-3.5 h-3.5 text-violet-600" />
                  Upload Edited PNG
                  <input
                    type="file"
                    accept="image/png,image/webp"
                    disabled={uploadingPhoto}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      e.target.value = '';
                      void handleUploadEditedPng(f);
                    }}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  disabled={renderingBannerPreview}
                  onClick={() => void handleOpenTeacherBannerPreview()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-800 cursor-pointer transition-colors"
                >
                  {renderingBannerPreview ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-600" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                  )}
                  Preview Teacher Banner
                </button>

                {hasTeacherPhoto && (
                  <button
                    type="button"
                    disabled={busy || uploadingPhoto}
                    onClick={() => void handleRemoveTeacherPhoto()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-red-50 border border-gray-200 text-xs font-semibold text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Teacher Name</label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={form.teacherName}
                  onChange={(e) => setForm({ ...form, teacherName: e.target.value })}
                  placeholder="SONU SIR #BABA"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Teacher Designation
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={form.teacherDesignation ?? 'Chemistry Teacher'}
                  onChange={(e) => setForm({ ...form, teacherDesignation: e.target.value })}
                  placeholder="Chemistry Teacher"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Institute Signature (Front Side)
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={form.signatureText}
                  onChange={(e) => setForm({ ...form, signatureText: e.target.value })}
                  placeholder="Sonu Sir #Baba"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Teaching Experience (Optional)
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={form.teacherExperience || ''}
                  onChange={(e) => setForm({ ...form, teacherExperience: e.target.value })}
                  placeholder="Enter verified experience if applicable"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Subject Specialization (Optional)
              </label>
              <input
                type="text"
                maxLength={160}
                value={form.teacherSpecialization || ''}
                onChange={(e) => setForm({ ...form, teacherSpecialization: e.target.value })}
                placeholder="e.g., Physical, Organic & Inorganic Chemistry"
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Short Teacher Introduction (ID Card &amp; Homepage)
              </label>
              <textarea
                rows={3}
                maxLength={600}
                value={form.teacherBio || ''}
                onChange={(e) => setForm({ ...form, teacherBio: e.target.value })}
                placeholder="Enter verified teacher introduction / teaching philosophy (leave blank to omit)."
                className={inputCls}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-800">
                  Verified Teacher Contact Details (ID Card Back Side)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      teacherContactNumber: form.phone || '',
                      teacherWhatsappNumber: form.whatsappNumber || '',
                      teacherEmail: form.email || '',
                    })
                  }
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  Copy Institute Contact
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Contact Number
                  </label>
                  <input
                    type="text"
                    maxLength={30}
                    value={form.teacherContactNumber || ''}
                    onChange={(e) => setForm({ ...form, teacherContactNumber: e.target.value })}
                    placeholder="Verified phone"
                    className={`${inputCls} font-mono`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    WhatsApp Number
                  </label>
                  <input
                    type="text"
                    maxLength={30}
                    value={form.teacherWhatsappNumber || ''}
                    onChange={(e) => setForm({ ...form, teacherWhatsappNumber: e.target.value })}
                    placeholder="Verified WhatsApp"
                    className={`${inputCls} font-mono`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Official Email
                  </label>
                  <input
                    type="email"
                    maxLength={160}
                    value={form.teacherEmail || ''}
                    onChange={(e) => setForm({ ...form, teacherEmail: e.target.value })}
                    placeholder="Verified email"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-medium text-gray-700">
                  Motivational Message for Students (Back Side)
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      idCardMotivationalMessage: DEFAULT_ID_CARD_MOTIVATIONAL_MESSAGE,
                    })
                  }
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset Default Quote
                </button>
              </div>
              <textarea
                rows={4}
                maxLength={600}
                value={
                  form.idCardMotivationalMessage !== undefined &&
                  form.idCardMotivationalMessage !== ''
                    ? form.idCardMotivationalMessage
                    : DEFAULT_ID_CARD_MOTIVATIONAL_MESSAGE
                }
                onChange={(e) =>
                  setForm({ ...form, idCardMotivationalMessage: e.target.value })
                }
                className={inputCls}
              />
            </div>

            <div className="pt-1 flex flex-wrap items-center gap-2.5">
              <button
                type="submit"
                disabled={busy || uploadingPhoto}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          </form>

          {/* Right: Live CR80 Front + Back Preview, PDF Download & Print Studio */}
          <div className="xl:col-span-6 app-card rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <h3 className="font-display text-base font-bold text-gray-900">
                  Live Double-Sided CR80 Preview
                </h3>
                <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
                  <Layers className="w-3.5 h-3.5 text-violet-600" />
                  Exact physical CR80: {CR80_WIDTH_MM.toFixed(2)} mm × {CR80_HEIGHT_MM.toFixed(2)} mm
                </p>
              </div>

              <div className="inline-flex p-1 rounded-xl bg-gray-100 border border-gray-200 self-start">
                {(
                  [
                    { id: 'both', label: 'Both' },
                    { id: 'front', label: 'Front' },
                    { id: 'back', label: 'Back' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setPreviewSide(t.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                      previewSide === t.id
                        ? 'bg-white text-violet-700 shadow-2xs'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Select Approved Student for Live Preview */}
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">
                Preview Student Record
              </label>
              {students.length > 0 ? (
                <select
                  value={previewStudent.studentId}
                  onChange={(e) => setPreviewStudentId(e.target.value)}
                  className={inputCls}
                >
                  {students.map((s) => (
                    <option key={s.studentId} value={s.studentId}>
                      {s.studentName} ({s.studentId} · {s.studentClass})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-500">
                  Showing layout sample (no approved students yet). Once a student is approved, select them here to preview and print their card.
                </div>
              )}
            </div>

            {/* Card Canvases */}
            {renderingPreview && !previewFrontUrl ? (
              <div className="aspect-[1348/850] rounded-2xl bg-gray-50 border border-gray-200 flex flex-col items-center justify-center text-gray-500">
                <Loader2 className="w-6 h-6 animate-spin text-violet-600 mb-2" />
                <p className="text-xs">Rendering CR80 preview...</p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {(previewSide === 'both' || previewSide === 'front') && previewFrontUrl && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                      Front Side — Student Details
                    </p>
                    <img
                      src={previewFrontUrl}
                      alt="Front Side CR80 ID Card Preview"
                      className="w-full aspect-[1348/850] rounded-xl border border-gray-200 shadow-xs bg-white"
                    />
                  </div>
                )}
                {(previewSide === 'both' || previewSide === 'back') && previewBackUrl && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                      Back Side — Meet Your Teacher
                    </p>
                    <img
                      src={previewBackUrl}
                      alt="Back Side CR80 ID Card Preview"
                      className="w-full aspect-[1348/850] rounded-xl border border-gray-200 shadow-xs bg-white"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Export & Duplex Print Actions */}
            <div className="pt-1 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={downloadingPdf || !previewFrontUrl}
                onClick={() => void handleDownloadPreviewPdf()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
              >
                {downloadingPdf ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
                Download Complete ID Card PDF
              </button>
              <button
                type="button"
                disabled={!previewFrontUrl || !previewBackUrl}
                onClick={handlePrintPreviewBothSides}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white hover:bg-gray-100 border border-gray-200 disabled:opacity-60 text-gray-800 text-xs font-semibold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-violet-600" />
                Print Both Sides
              </button>
            </div>
          </div>
        </div>
      )}

      {/* On-Device Teacher Portrait & Background Studio Modal */}
      {studioSourceUrl && (
        <TeacherPortraitStudioModal
          sourceUrl={studioSourceUrl}
          teacherName={form.teacherName || 'SONU SIR #BABA'}
          saving={savingStudioCutout}
          onClose={() => setStudioSourceUrl(null)}
          onApplyCutout={handleApplyStudioCutout}
        />
      )}

      {/* Standalone Teacher Profile Promotional Banner Preview Modal */}
      {bannerPreviewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setBannerPreviewUrl(null)}
        >
          <div
            className="w-full max-w-4xl bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-gray-900">
                  Teacher Profile Promotional Banner Preview
                </h3>
                <p className="text-xs text-gray-500">
                  Purple &amp; white coaching composition for {form.teacherName || 'SONU SIR #BABA'} (matches CR80 ID Card back side).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={bannerPreviewUrl}
                  download={`${(form.teacherName || 'Teacher').replace(/\s+/g, '_')}_Profile_Banner.png`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PNG
                </a>
                <button
                  type="button"
                  aria-label="Close banner preview"
                  onClick={() => setBannerPreviewUrl(null)}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-5 bg-gray-50">
              <img
                src={bannerPreviewUrl}
                alt="Teacher Profile Banner Preview"
                className="w-full rounded-xl border border-gray-200 shadow-sm bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* In-DOM Print Portal for Admin ID Card Studio CR80 Duplex Printing */}
      {subTab === 'idcard' &&
        previewFrontUrl &&
        previewBackUrl &&
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
                FRONT SIDE — STUDENT DETAILS ({previewStudent.studentId}) · CR80 85.60 × 53.98 mm
              </p>
              <img src={previewFrontUrl} alt="" className="cr80-card-physical" />
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
                BACK SIDE — MEET YOUR TEACHER ({form.teacherName}) · CR80 85.60 × 53.98 mm
              </p>
              <img src={previewBackUrl} alt="" className="cr80-card-physical" />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
