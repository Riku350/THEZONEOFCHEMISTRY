import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Instagram,
  Link2,
  Loader2,
  MessageCircle,
  Plus,
  Power,
  Save,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { DEFAULT_SCHEDULED_DAYS, formatScheduledDaysSummary } from '../lib/attendanceUtils';
import {
  deleteBatch,
  sanitizeHttpsUrl,
  saveBatch,
  saveInstituteSettings,
  uploadBatchLogo,
} from '../lib/firestoreService';
import { BatchItem, CourseItem, InstituteSettings } from '../types';
import { ResolvedImage } from './ResolvedImage';

const INPUT_CLS =
  'w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3 py-2 text-xs sm:text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors';

const CLASS_PRESETS = ['Class 10', 'Class 11', 'Class 12', 'NEET', 'JEE'];

function validateOptionalHttpsInput(label: string, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!sanitizeHttpsUrl(trimmed)) {
    return `${label} must be a valid https:// URL (e.g., https://...).`;
  }
  return null;
}

export const AdminSocialLinksPanel: React.FC<{
  settings: InstituteSettings;
  batches: BatchItem[];
  courses: CourseItem[];
}> = ({ settings, batches, courses }) => {
  const [section, setSection] = useState<'batches' | 'global'>('batches');
  const [busy, setBusy] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Global social links form state
  const [globalForm, setGlobalForm] = useState({
    instagramUrl: settings.instagramUrl || '',
    telegramChannelUrl: settings.telegramChannelUrl || '',
    telegramGroupUrl: settings.telegramGroupUrl || '',
    whatsappCommunityUrl: settings.whatsappCommunityUrl || '',
    whatsappNumber: settings.whatsappNumber || '',
    socialLinksActive: settings.socialLinksActive !== false,
  });

  useEffect(() => {
    setGlobalForm({
      instagramUrl: settings.instagramUrl || '',
      telegramChannelUrl: settings.telegramChannelUrl || '',
      telegramGroupUrl: settings.telegramGroupUrl || '',
      whatsappCommunityUrl: settings.whatsappCommunityUrl || '',
      whatsappNumber: settings.whatsappNumber || '',
      socialLinksActive: settings.socialLinksActive !== false,
    });
  }, [settings]);

  // Batch editor state
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [className, setClassName] = useState('Class 12');
  const [courseName, setCourseName] = useState('');
  const [batchName, setBatchName] = useState('');
  const [timing, setTiming] = useState('');
  const [whatsappUrl, setWhatsappUrl] = useState('');
  const [telegramUrl, setTelegramUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [socialLinksActive, setSocialLinksActive] = useState(true);
  const [batchActive, setBatchActive] = useState(true);
  const [logoUrl, setLogoUrl] = useState('');
  const [logoMediaId, setLogoMediaId] = useState('');
  const [filterClass, setFilterClass] = useState<string>('ALL');

  const editingOriginal = useMemo(
    () => (editingBatchId ? batches.find((b) => b.id === editingBatchId) || null : null),
    [batches, editingBatchId]
  );

  const uniqueClasses = useMemo(() => {
    const set = new Set<string>();
    batches.forEach((b) => {
      if (b.className?.trim()) set.add(b.className.trim());
    });
    return Array.from(set);
  }, [batches]);

  const filteredBatches = useMemo(() => {
    if (filterClass === 'ALL') return batches;
    if (filterClass === 'UNASSIGNED') return batches.filter((b) => !b.className?.trim());
    return batches.filter((b) => (b.className || '').trim() === filterClass);
  }, [batches, filterClass]);

  const resetBatchForm = () => {
    setEditingBatchId(null);
    setClassName('Class 12');
    setCourseName('');
    setBatchName('');
    setTiming('');
    setWhatsappUrl('');
    setTelegramUrl('');
    setInstagramUrl('');
    setSocialLinksActive(true);
    setBatchActive(true);
    setLogoUrl('');
    setLogoMediaId('');
  };

  const startEditBatch = (b: BatchItem) => {
    setEditingBatchId(b.id);
    setClassName(b.className || '');
    setCourseName(b.courseName || '');
    setBatchName(b.name);
    setTiming(b.timing);
    setWhatsappUrl(b.whatsappUrl || '');
    setTelegramUrl(b.telegramUrl || '');
    setInstagramUrl(b.instagramUrl || '');
    setSocialLinksActive(b.socialLinksActive !== false);
    setBatchActive(b.active);
    setLogoUrl(b.logoUrl || '');
    setLogoMediaId(b.logoMediaId || '');
    setErrorMsg('');
    setSavedMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveGlobalLinks = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSavedMsg('');

    const urlChecks = [
      validateOptionalHttpsInput('Instagram Profile URL', globalForm.instagramUrl),
      validateOptionalHttpsInput('Telegram Channel URL', globalForm.telegramChannelUrl),
      validateOptionalHttpsInput('Telegram Group URL', globalForm.telegramGroupUrl),
      validateOptionalHttpsInput('WhatsApp Community URL', globalForm.whatsappCommunityUrl),
    ].filter(Boolean);

    if (urlChecks.length > 0) {
      setErrorMsg(urlChecks[0] || 'Please check your URLs.');
      return;
    }

    setBusy(true);
    try {
      const { id: _id, updatedAt: _u, ...restSettings } = settings;
      await saveInstituteSettings({
        ...restSettings,
        instagramUrl: globalForm.instagramUrl.trim(),
        telegramChannelUrl: globalForm.telegramChannelUrl.trim(),
        telegramGroupUrl: globalForm.telegramGroupUrl.trim(),
        whatsappCommunityUrl: globalForm.whatsappCommunityUrl.trim(),
        whatsappNumber: globalForm.whatsappNumber.replace(/[^0-9]/g, '').slice(0, 20),
        socialLinksActive: globalForm.socialLinksActive,
      });
      setSavedMsg('Global social media links saved and synced to the public website.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save social links.');
    } finally {
      setBusy(false);
    }
  };

  const handleUploadBatchLogoFile = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid PNG, JPG, JPEG, or WebP logo file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Batch logo must be smaller than 5 MB.');
      return;
    }

    setUploadingLogo(true);
    setErrorMsg('');
    try {
      const uploaded = await uploadBatchLogo(file, file.name);
      setLogoUrl(uploaded.url);
      setLogoMediaId(uploaded.mediaId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to upload batch logo.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSavedMsg('');

    if (batchName.trim().length < 2 || timing.trim().length < 2) {
      setErrorMsg('Batch Name and Batch Timing are required.');
      return;
    }

    const urlChecks = [
      validateOptionalHttpsInput('Batch WhatsApp Group URL', whatsappUrl),
      validateOptionalHttpsInput('Batch Telegram Group URL', telegramUrl),
      validateOptionalHttpsInput('Batch Instagram URL', instagramUrl),
    ].filter(Boolean);

    if (urlChecks.length > 0) {
      setErrorMsg(urlChecks[0] || 'Please check your batch URLs.');
      return;
    }

    setBusy(true);
    try {
      await saveBatch({
        id: editingBatchId || undefined,
        name: batchName.trim(),
        timing: timing.trim(),
        className: className.trim(),
        courseName: courseName.trim(),
        capacity: editingOriginal?.capacity ?? 60,
        feeOverride: editingOriginal?.feeOverride ?? null,
        scheduledDays: editingOriginal?.scheduledDays ?? DEFAULT_SCHEDULED_DAYS,
        scheduleStartDate: editingOriginal?.scheduleStartDate ?? '',
        whatsappUrl: whatsappUrl.trim(),
        telegramUrl: telegramUrl.trim(),
        instagramUrl: instagramUrl.trim(),
        socialLinksActive,
        logoUrl,
        logoMediaId,
        active: batchActive,
        order: editingOriginal?.order ?? batches.length + 1,
      });
      setSavedMsg(
        editingBatchId
          ? 'Batch details, logo, and social links updated.'
          : 'New batch with social links added.'
      );
      resetBatchForm();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save batch.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleBatchSocialActive = async (b: BatchItem) => {
    setBusy(true);
    setErrorMsg('');
    try {
      await saveBatch({
        id: b.id,
        name: b.name,
        timing: b.timing,
        className: b.className || '',
        courseName: b.courseName || '',
        capacity: b.capacity ?? 60,
        feeOverride: b.feeOverride ?? null,
        scheduledDays: b.scheduledDays ?? DEFAULT_SCHEDULED_DAYS,
        scheduleStartDate: b.scheduleStartDate ?? '',
        whatsappUrl: b.whatsappUrl || '',
        telegramUrl: b.telegramUrl || '',
        instagramUrl: b.instagramUrl || '',
        socialLinksActive: !(b.socialLinksActive !== false),
        logoUrl: b.logoUrl || '',
        logoMediaId: b.logoMediaId || '',
        active: b.active,
        order: b.order,
      });
      setSavedMsg(
        b.socialLinksActive !== false
          ? `Social links paused for ${b.name}.`
          : `Social links activated for ${b.name}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update batch status.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBatch = async (b: BatchItem) => {
    setBusy(true);
    setErrorMsg('');
    try {
      await deleteBatch(b.id);
      if (editingBatchId === b.id) resetBatchForm();
      setSavedMsg(`Deleted batch "${b.name}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete batch.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">
            Social Media &amp; Batch Links
          </h2>
          <p className="text-xs sm:text-sm text-gray-500">
            Manage official institute social accounts, class-wise batch groups, and batch logos.
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl bg-gray-100 border border-gray-200 self-start">
          <button
            type="button"
            onClick={() => {
              setSection('batches');
              setErrorMsg('');
              setSavedMsg('');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              section === 'batches'
                ? 'bg-white text-violet-700 shadow-2xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            Batch-Wise Links ({batches.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setSection('global');
              setErrorMsg('');
              setSavedMsg('');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              section === 'global'
                ? 'bg-white text-violet-700 shadow-2xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Global Social Links
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

      {section === 'global' ? (
        <form onSubmit={handleSaveGlobalLinks} className="app-card rounded-2xl p-5 sm:p-6 max-w-3xl space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-gray-900">
                Official Institute Social Links
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Only configured &amp; activated links are displayed on the public website. Leave any field empty to hide it.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Instagram Profile URL
              </label>
              <input
                type="url"
                value={globalForm.instagramUrl}
                onChange={(e) => setGlobalForm({ ...globalForm, instagramUrl: e.target.value })}
                placeholder="https://instagram.com/yourhandle"
                className={INPUT_CLS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Telegram Channel URL
              </label>
              <input
                type="url"
                value={globalForm.telegramChannelUrl}
                onChange={(e) =>
                  setGlobalForm({ ...globalForm, telegramChannelUrl: e.target.value })
                }
                placeholder="https://t.me/yourchannel"
                className={INPUT_CLS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Telegram Group URL
              </label>
              <input
                type="url"
                value={globalForm.telegramGroupUrl}
                onChange={(e) =>
                  setGlobalForm({ ...globalForm, telegramGroupUrl: e.target.value })
                }
                placeholder="https://t.me/+yourgroupinvite"
                className={INPUT_CLS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                WhatsApp Community URL
              </label>
              <input
                type="url"
                value={globalForm.whatsappCommunityUrl}
                onChange={(e) =>
                  setGlobalForm({ ...globalForm, whatsappCommunityUrl: e.target.value })
                }
                placeholder="https://chat.whatsapp.com/..."
                className={INPUT_CLS}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Official WhatsApp Contact Number (with Country Code, e.g., 919876543210)
              </label>
              <input
                type="text"
                value={globalForm.whatsappNumber}
                onChange={(e) =>
                  setGlobalForm({
                    ...globalForm,
                    whatsappNumber: e.target.value.replace(/[^0-9]/g, '').slice(0, 15),
                  })
                }
                placeholder="919876543210"
                className={`${INPUT_CLS} font-mono max-w-sm`}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={globalForm.socialLinksActive}
              onChange={(e) =>
                setGlobalForm({ ...globalForm, socialLinksActive: e.target.checked })
              }
              className="accent-violet-600"
            />
            Activate &amp; display configured Global Social Links on the public website
          </label>

          <div className="pt-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Global Social Links
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left: Add / Edit Batch & Social Links Form */}
          <form onSubmit={handleSaveBatch} className="lg:col-span-5 app-card rounded-2xl p-5 space-y-3.5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-gray-900">
                {editingBatchId ? 'Edit Batch & Social Links' : 'Add Batch & Social Links'}
              </h3>
              {editingBatchId && (
                <button
                  type="button"
                  onClick={resetBatchForm}
                  className="text-xs font-semibold text-gray-500 hover:text-gray-900 cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </div>

            {/* Class / Category selector with unlimited custom input */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Class / Exam Category
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {CLASS_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setClassName(preset)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                      className === preset
                        ? 'bg-violet-600 border-violet-600 text-white'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-violet-300'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                type="text"
                maxLength={60}
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="Class 10, Class 11, Class 12, NEET, JEE, or custom"
                className={INPUT_CLS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Course Name (Optional)
              </label>
              <input
                type="text"
                list="zoc-course-options"
                maxLength={100}
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                placeholder="e.g., NEET Chemistry Target"
                className={INPUT_CLS}
              />
              <datalist id="zoc-course-options">
                {courses.map((c) => (
                  <option key={c.id} value={c.title} />
                ))}
              </datalist>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Batch Name *
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  placeholder="e.g., Morning Alpha Batch"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Batch Timing *
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={timing}
                  onChange={(e) => setTiming(e.target.value)}
                  placeholder="e.g., 8 AM – 10 AM"
                  className={INPUT_CLS}
                />
              </div>
            </div>

            {/* Batch Logo Upload */}
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-2.5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center overflow-hidden shrink-0 p-1">
                  {logoUrl || logoMediaId ? (
                    <ResolvedImage
                      url={logoUrl}
                      mediaId={logoMediaId}
                      alt="Batch logo"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-gray-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-gray-900">Batch Logo (Optional)</p>
                  <p className="text-[11px] text-gray-500">PNG (transparent), JPG, or WebP</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-violet-50 border border-gray-200 hover:border-violet-300 text-xs font-semibold text-violet-700 cursor-pointer">
                  {uploadingLogo ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {uploadingLogo ? 'Uploading...' : logoUrl || logoMediaId ? 'Change Logo' : 'Upload Logo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={uploadingLogo}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      e.target.value = '';
                      void handleUploadBatchLogoFile(f);
                    }}
                    className="hidden"
                  />
                </label>
                {(logoUrl || logoMediaId) && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogoUrl('');
                      setLogoMediaId('');
                    }}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* Batch Social Links */}
            <div className="space-y-2.5 pt-1">
              <p className="text-xs font-semibold text-gray-900">Batch Social Group Links</p>
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  WhatsApp Group URL
                </label>
                <input
                  type="url"
                  value={whatsappUrl}
                  onChange={(e) => setWhatsappUrl(e.target.value)}
                  placeholder="https://chat.whatsapp.com/..."
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Telegram Group URL
                </label>
                <input
                  type="url"
                  value={telegramUrl}
                  onChange={(e) => setTelegramUrl(e.target.value)}
                  placeholder="https://t.me/..."
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Instagram Link
                </label>
                <input
                  type="url"
                  value={instagramUrl}
                  onChange={(e) => setInstagramUrl(e.target.value)}
                  placeholder="https://instagram.com/..."
                  className={INPUT_CLS}
                />
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={socialLinksActive}
                  onChange={(e) => setSocialLinksActive(e.target.checked)}
                  className="accent-violet-600"
                />
                Activate Social Links for this Batch on Public Website
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={batchActive}
                  onChange={(e) => setBatchActive(e.target.checked)}
                  className="accent-violet-600"
                />
                Show Batch on Public Website
              </label>
            </div>

            <button
              type="submit"
              disabled={busy || uploadingLogo}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold cursor-pointer"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : editingBatchId ? (
                <Save className="w-4 h-4" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              {editingBatchId ? 'Update Batch & Links' : 'Add New Batch'}
            </button>
          </form>

          {/* Right: Batch List Grouped / Filterable by Class */}
          <div className="lg:col-span-7 space-y-3">
            {uniqueClasses.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilterClass('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                    filterClass === 'ALL'
                      ? 'bg-violet-600 border-violet-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-violet-300'
                  }`}
                >
                  All ({batches.length})
                </button>
                {uniqueClasses.map((cls) => (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => setFilterClass(cls)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                      filterClass === cls
                        ? 'bg-violet-600 border-violet-600 text-white'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-violet-300'
                    }`}
                  >
                    {cls}
                  </button>
                ))}
              </div>
            )}

            {filteredBatches.length === 0 ? (
              <div className="app-card rounded-2xl p-8 text-center text-xs sm:text-sm text-gray-500">
                No batches in this category yet. Add a batch using the form on the left.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredBatches.map((b) => {
                  const linksActive = b.socialLinksActive !== false;
                  const hasAnyLink = Boolean(b.whatsappUrl || b.telegramUrl || b.instagramUrl);
                  return (
                    <div key={b.id} className="app-card rounded-2xl p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-11 h-11 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center overflow-hidden shrink-0 p-1">
                            {b.logoUrl || b.logoMediaId ? (
                              <ResolvedImage
                                url={b.logoUrl}
                                mediaId={b.logoMediaId}
                                alt={b.name}
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <Link2 className="w-4 h-4 text-violet-600" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="font-semibold text-sm text-gray-900">{b.name}</p>
                              {b.className && (
                                <span className="px-2 py-0.5 rounded-md bg-violet-50 border border-violet-200 text-[10px] font-semibold text-violet-700">
                                  {b.className}
                                </span>
                              )}
                              {!b.active && (
                                <span className="px-2 py-0.5 rounded-md bg-gray-100 text-[10px] font-semibold text-gray-500">
                                  Hidden
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-600 mt-0.5">
                              {b.timing}
                              {b.courseName ? ` · ${b.courseName}` : ''}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              Classes: {formatScheduledDaysSummary(b.scheduledDays)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {hasAnyLink && (
                            <button
                              type="button"
                              disabled={busy}
                              title={linksActive ? 'Deactivate social links' : 'Activate social links'}
                              onClick={() => void handleToggleBatchSocialActive(b)}
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                linksActive
                                  ? 'text-emerald-600 hover:bg-emerald-50'
                                  : 'text-gray-400 hover:bg-gray-100'
                              }`}
                            >
                              <Power className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            title="Edit batch"
                            onClick={() => startEditBatch(b)}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-violet-700 hover:bg-violet-50 cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            title="Delete batch"
                            onClick={() => void handleDeleteBatch(b)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                        {!hasAnyLink ? (
                          <span className="text-[11px] text-gray-400">
                            No social links added yet — click Edit to add WhatsApp, Telegram, or Instagram links.
                          </span>
                        ) : (
                          <>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                                linksActive
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {linksActive ? 'Links Active' : 'Links Paused'}
                            </span>
                            {b.whatsappUrl && (
                              <a
                                href={b.whatsappUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-100"
                              >
                                <MessageCircle className="w-3 h-3" />
                                WhatsApp
                                <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                              </a>
                            )}
                            {b.telegramUrl && (
                              <a
                                href={b.telegramUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[11px] font-semibold hover:bg-sky-100"
                              >
                                <Send className="w-3 h-3" />
                                Telegram
                                <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                              </a>
                            )}
                            {b.instagramUrl && (
                              <a
                                href={b.instagramUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 text-[11px] font-semibold hover:bg-violet-100"
                              >
                                <Instagram className="w-3 h-3" />
                                Instagram
                                <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
