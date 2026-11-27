import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Pin,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  addAuthorizedAdmin,
  addGalleryPhoto,
  deleteBanner,
  deleteBatch,
  deleteCourse,
  deleteGalleryPhoto,
  deleteNotice,
  removeAuthorizedAdmin,
  saveBanner,
  saveBatch,
  saveCourse,
  saveInstituteSettings,
  saveNotice,
} from '../lib/firestoreService';
import {
  AdminUserRecord,
  BannerItem,
  BatchItem,
  CourseItem,
  GalleryItem,
  InstituteSettings,
  NoticeCategory,
  NoticeItem,
} from '../types';
import { ResolvedImage } from './ResolvedImage';

const inputCls =
  'w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors';

// -----------------------------------------------------------------------------
// 1. BANNER MANAGEMENT
// -----------------------------------------------------------------------------
export const AdminBannersPanel: React.FC<{ banners: BannerItem[] }> = ({ banners }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [order, setOrder] = useState('1');
  const [active, setActive] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [existingUrl, setExistingUrl] = useState('');
  const [existingMediaId, setExistingMediaId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setAnnouncement('');
    setOrder(String(banners.length + 1));
    setActive(true);
    setFile(null);
    setEditingId(null);
    setExistingUrl('');
    setExistingMediaId('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      await saveBanner(
        {
          id: editingId || undefined,
          title,
          description,
          announcement,
          imageUrl: existingUrl,
          mediaId: existingMediaId,
          order: Number(order) || 1,
          active,
        },
        file
      );
      resetForm();
      setMsg('Banner saved and published.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">Banners</h2>
        <p className="text-xs sm:text-sm text-gray-500">
          Manage homepage announcement cards and banners.
        </p>
      </div>

      {msg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs sm:text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <form onSubmit={handleSubmit} className="lg:col-span-5 app-card rounded-2xl p-5 space-y-3.5">
          <h3 className="font-display text-base font-bold text-gray-900">
            {editingId ? 'Edit Banner' : 'Add Banner'}
          </h3>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
            <input
              type="text"
              required
              maxLength={140}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., NEET 2027 Chemistry Batch"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Announcement Line</label>
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
              placeholder="Short banner details..."
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Order</label>
              <input
                type="number"
                min={1}
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
                Active
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Image (Optional)</label>
            <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-violet-50 border border-dashed border-gray-300 hover:border-violet-400 text-xs font-semibold text-violet-700 cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              {file ? file.name : 'Choose Banner Image'}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId ? 'Update' : 'Publish'}
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
          {banners.length === 0 ? (
            <div className="app-card rounded-2xl p-8 text-center text-xs sm:text-sm text-gray-500">
              No custom banners uploaded yet.
            </div>
          ) : (
            banners.map((b) => (
              <div
                key={b.id}
                className="app-card rounded-2xl p-3.5 flex flex-col sm:flex-row gap-3.5 items-start"
              >
                <div className="w-full sm:w-36 aspect-[16/10] rounded-xl overflow-hidden bg-gray-100 border border-gray-200 shrink-0">
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
                    <span className="font-mono">#{b.order}</span>
                    <span className={b.active ? 'text-emerald-600 font-semibold' : 'text-gray-400'}>
                      {b.active ? 'Active' : 'Hidden'}
                    </span>
                  </div>
                  <h4 className="font-display font-bold text-gray-900 text-sm mt-0.5">{b.title}</h4>
                  {b.announcement && (
                    <p className="text-xs text-violet-700 font-medium mt-0.5">{b.announcement}</p>
                  )}
                  {b.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{b.description}</p>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(b.id);
                        setTitle(b.title);
                        setDescription(b.description || '');
                        setAnnouncement(b.announcement || '');
                        setOrder(String(b.order));
                        setActive(b.active);
                        setExistingUrl(b.imageUrl || '');
                        setExistingMediaId(b.mediaId || '');
                        setFile(null);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void saveBanner({
                          id: b.id,
                          title: b.title,
                          description: b.description,
                          announcement: b.announcement,
                          imageUrl: b.imageUrl,
                          mediaId: b.mediaId,
                          order: b.order,
                          active: !b.active,
                        })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer"
                    >
                      {b.active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {b.active ? 'Hide' : 'Show'}
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

  const [bName, setBName] = useState('');
  const [bTiming, setBTiming] = useState('');
  const [bCapacity, setBCapacity] = useState('60');
  const [bFeeOverride, setBFeeOverride] = useState('');

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

  const handleAddBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bName.trim() || !bTiming.trim()) return;
    setBusy(true);
    try {
      await saveBatch({
        name: bName,
        timing: bTiming,
        capacity: Number(bCapacity) || 60,
        feeOverride: bFeeOverride ? Number(bFeeOverride) : null,
        active: true,
        order: batches.length + 1,
      });
      setBName('');
      setBTiming('');
      setBFeeOverride('');
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
          <form onSubmit={handleAddBatch} className="lg:col-span-5 app-card rounded-2xl p-5 space-y-3">
            <h3 className="font-display text-base font-bold text-gray-900">Add Batch Slot</h3>
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
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold cursor-pointer"
            >
              Add Batch Timing
            </button>
          </form>

          <div className="lg:col-span-7 space-y-2.5">
            {batches.map((b) => (
              <div key={b.id} className="app-card rounded-2xl p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{b.timing}</p>
                  <p className="text-xs text-gray-500">
                    {b.name} · Capacity {b.capacity || 60}
                    {b.feeOverride ? ` · Batch Fee ₹${b.feeOverride.toLocaleString('en-IN')}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteBatch(b.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// 4. INSTITUTE SETTINGS & ADMIN ACCOUNTS
// -----------------------------------------------------------------------------
export const AdminSettingsPanel: React.FC<{
  settings: InstituteSettings;
  admins: AdminUserRecord[];
}> = ({ settings, admins }) => {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const [newUid, setNewUid] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSavedMsg('');
    try {
      const { id: _id, updatedAt: _u, ...rest } = form;
      await saveInstituteSettings(rest);
      setSavedMsg('Institute settings saved.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUid.trim() || !newEmail.trim()) return;
    setBusy(true);
    try {
      await addAuthorizedAdmin(newUid, newEmail, newName || 'Institute Admin');
      setNewUid('');
      setNewEmail('');
      setNewName('');
      setSavedMsg('Authorized administrator added.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">Settings</h2>
        <p className="text-xs sm:text-sm text-gray-500">
          Configure institute details, default fee, contact info, and admin access.
        </p>
      </div>

      {savedMsg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs sm:text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{savedMsg}</span>
        </div>
      )}

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

          <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.admissionsOpen}
              onChange={(e) => setForm({ ...form, admissionsOpen: e.target.checked })}
              className="accent-violet-600"
            />
            Show &ldquo;Admissions Open&rdquo; Card on Homepage
          </label>

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
    </div>
  );
};
