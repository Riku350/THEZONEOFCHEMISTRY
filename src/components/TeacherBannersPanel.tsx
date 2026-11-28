import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  ImageIcon,
  Loader2,
  Plus,
  Send,
  Trash2,
  Upload,
  User,
  MessageCircle,
} from 'lucide-react';
import { CLASS_OPTIONS } from '../config/defaults';
import {
  deleteTeacherBanner,
  saveTeacherBanner,
} from '../lib/firestoreService';
import { BatchItem, TeacherBannerItem } from '../types';
import { ResolvedImage } from './ResolvedImage';

interface TeacherBannersPanelProps {
  teacherEmail: string;
  teacherName: string;
  batches: BatchItem[];
  teacherBanners: TeacherBannerItem[];
}

const inputCls =
  'w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors';

export const TeacherBannersPanel: React.FC<TeacherBannersPanelProps> = ({
  teacherEmail,
  teacherName,
  batches,
  teacherBanners,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [className, setClassName] = useState('Class 12');
  const [selectedBatchId, setSelectedBatchId] = useState(batches[0]?.id || '');
  const [whatsappUrl, setWhatsappUrl] = useState('');
  const [telegramUrl, setTelegramUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const myBanners = useMemo(
    () => teacherBanners.filter((b) => b.teacherEmail.toLowerCase() === teacherEmail.toLowerCase()),
    [teacherBanners, teacherEmail]
  );

  const handleOpenCreate = () => {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setClassName('Class 12');
    setSelectedBatchId(batches[0]?.id || '');
    setWhatsappUrl('');
    setTelegramUrl('');
    setImageFile(null);
    setPreviewUrl('');
    setErrorMsg('');
    setShowForm(true);
  };

  const handleOpenEdit = (b: TeacherBannerItem) => {
    setEditingId(b.id);
    setTitle(b.title || '');
    setDescription(b.description || '');
    setClassName(b.className || 'Class 12');
    setSelectedBatchId(b.batchId || batches[0]?.id || '');
    setWhatsappUrl(b.whatsappUrl || '');
    setTelegramUrl(b.telegramUrl || '');
    setImageFile(null);
    setPreviewUrl(b.imageUrl || '');
    setErrorMsg('');
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      setErrorMsg('Please enter a banner title.');
      return;
    }

    const matchedBatch = batches.find((bt) => bt.id === selectedBatchId);
    const batchName = matchedBatch ? matchedBatch.name : 'Regular Batch';
    const batchTiming = matchedBatch ? matchedBatch.timing : '8 AM – 10 AM';

    setBusy(true);
    setErrorMsg('');
    try {
      await saveTeacherBanner(
        {
          id: editingId || undefined,
          teacherEmail,
          title,
          description,
          className,
          batchId: selectedBatchId,
          batchName,
          batchTiming,
          whatsappUrl,
          telegramUrl,
          active: true,
        },
        imageFile
      );
      setShowForm(false);
    } catch (err) {
      console.error('Teacher banner save error:', err);
      setErrorMsg('Banner upload failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this batch banner?')) return;
    try {
      await deleteTeacherBanner(id);
    } catch (err) {
      console.error('Delete banner error:', err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-gray-950">
            My Batch Banners ({teacherName})
          </h2>
          <p className="text-xs sm:text-sm text-gray-600 mt-0.5">
            Upload promotional banners for your assigned batches. Approved banners appear directly above their respective batch section on the homepage.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors shadow-xs whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Create Batch Banner
        </button>
      </div>

      {/* Banner Form Modal / Card */}
      {showForm && (
        <div className="app-card rounded-2xl p-5 sm:p-6 border-2 border-violet-200 bg-violet-50/20 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-200">
            <h3 className="font-display text-base font-bold text-gray-900">
              {editingId ? 'Edit Batch Banner' : 'Create New Batch Banner'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs text-gray-500 hover:text-gray-900 font-medium cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Banner Title *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Target NEET 2026 Batch Starting Soon"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Class / Category
                </label>
                <select
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  className={inputCls}
                >
                  {CLASS_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value="NEET">NEET Preparation</option>
                  <option value="JEE">JEE Preparation</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Assigned Batch Timing
                </label>
                <select
                  value={selectedBatchId}
                  onChange={(e) => setSelectedBatchId(e.target.value)}
                  className={inputCls}
                >
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.className ? `[${b.className}] ` : ''}{b.name} — {b.timing}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Banner Image (Recommended Ratio 16:9)
                </label>
                <label className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-white hover:bg-violet-50 border border-gray-200 text-xs font-semibold text-violet-700 cursor-pointer transition-colors">
                  <Upload className="w-4 h-4" />
                  {imageFile ? imageFile.name : 'Choose Banner Image'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setImageFile(f);
                      if (f) setPreviewUrl(URL.createObjectURL(f));
                    }}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  WhatsApp Group Join Link (Optional)
                </label>
                <input
                  type="url"
                  value={whatsappUrl}
                  onChange={(e) => setWhatsappUrl(e.target.value)}
                  placeholder="https://chat.whatsapp.com/..."
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Telegram Group Join Link (Optional)
                </label>
                <input
                  type="url"
                  value={telegramUrl}
                  onChange={(e) => setTelegramUrl(e.target.value)}
                  placeholder="https://t.me/..."
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Short Description / Highlights
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Mention key topics, test series, or special discounts..."
                className={inputCls}
              />
            </div>

            {previewUrl && (
              <div className="rounded-xl overflow-hidden border border-gray-200 h-36 bg-gray-900">
                <img src={previewUrl} alt="Banner Preview" className="w-full h-full object-cover" />
              </div>
            )}

            {errorMsg && (
              <p className="text-xs font-semibold text-red-600">{errorMsg}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? 'Update Banner' : 'Submit for Admin Approval'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List of My Banners */}
      <div className="space-y-3">
        {myBanners.length === 0 ? (
          <div className="app-card rounded-2xl p-8 text-center">
            <ImageIcon className="w-8 h-8 text-violet-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-900">No Batch Banners Created Yet</p>
            <p className="text-xs text-gray-500 mt-1">
              Create your first promotional batch banner to showcase it on the institute homepage.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myBanners.map((b) => (
              <div key={b.id} className="app-card rounded-2xl overflow-hidden flex flex-col justify-between">
                <div>
                  {b.imageUrl && (
                    <div className="h-36 bg-gray-100 overflow-hidden relative">
                      <ResolvedImage
                        url={b.imageUrl}
                        mediaId={b.mediaId}
                        alt={b.title}
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-xs bg-white/90 backdrop-blur-xs">
                        {b.status === 'approved' ? (
                          <span className="text-emerald-700">Approved</span>
                        ) : b.status === 'rejected' ? (
                          <span className="text-red-600">Rejected</span>
                        ) : (
                          <span className="text-amber-600">Pending Review</span>
                        )}
                      </span>
                    </div>
                  )}
                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-violet-50 border border-violet-100 text-[10px] font-semibold text-violet-700">
                        {b.className}
                      </span>
                      <span className="text-xs text-gray-500">{b.batchTiming || b.batchName}</span>
                    </div>
                    <h3 className="font-display text-sm font-bold text-gray-900">{b.title}</h3>
                    {b.description && (
                      <p className="text-xs text-gray-600 line-clamp-2">{b.description}</p>
                    )}
                  </div>
                </div>

                <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    {b.whatsappUrl && (
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        WhatsApp Linked
                      </span>
                    )}
                    {b.telegramUrl && (
                      <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
                        Telegram Linked
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(b)}
                      className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 font-semibold text-gray-700 cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(b.id)}
                      className="p-1 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer"
                      title="Delete Banner"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
