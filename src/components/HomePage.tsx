import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bell,
  BookOpen,
  Calendar,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  X,
} from 'lucide-react';
import { ASSETS } from '../config/defaults';
import { formatScheduledDaysSummary } from '../lib/attendanceUtils';
import {
  BannerItem,
  BatchItem,
  CourseItem,
  FeeRule,
  GalleryItem,
  InstituteSettings,
  NoticeItem,
  PublicView,
} from '../types';
import { ResolvedImage } from './ResolvedImage';
import { PromoBannerSlider } from './PromoBannerSlider';
import { TrackMyAdmission } from './TrackMyAdmission';

interface HomePageProps {
  settings: InstituteSettings;
  courses: CourseItem[];
  batches: BatchItem[];
  feeRules: FeeRule[];
  banners: BannerItem[];
  gallery: GalleryItem[];
  notices: NoticeItem[];
  onNavigate: (view: PublicView, preselectCourse?: string) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  settings,
  courses,
  batches,
  feeRules,
  banners,
  gallery,
  notices,
  onNavigate,
}) => {
  const [bannerIndex, setBannerIndex] = useState(0);
  const [galleryCategory, setGalleryCategory] = useState('All');
  const [lightboxItem, setLightboxItem] = useState<GalleryItem | null>(null);

  const activeBanners = useMemo(() => banners.filter((b) => b.active), [banners]);
  const safeBannerIdx = activeBanners.length > 0 ? bannerIndex % activeBanners.length : 0;
  const currentBanner = activeBanners[safeBannerIdx];

  const galleryCategories = useMemo(() => {
    const cats = new Set<string>(['All']);
    gallery.forEach((g) => {
      if (g.category) cats.add(g.category);
    });
    return Array.from(cats);
  }, [gallery]);

  const filteredGallery = useMemo(() => {
    if (galleryCategory === 'All') return gallery;
    return gallery.filter((g) => g.category === galleryCategory);
  }, [gallery, galleryCategory]);

  const whatsappHref = `https://wa.me/${(settings.whatsappNumber || '919876543210').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
    `Hello ${settings.instituteName}, I would like to inquire about admissions.`
  )}`;

  return (
    <div className="bg-white text-gray-900 pb-20 md:pb-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 space-y-10 sm:space-y-12">
        {/* 1. INSTITUTE HEADER & PRIMARY ACTIONS */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-xs font-semibold text-violet-700">
              {settings.teacherName} · Session {settings.academicSession}
            </p>
            <h1 className="mt-1.5 font-display text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
              {settings.instituteName}
            </h1>
            <p className="mt-2 text-sm sm:text-base text-gray-600 leading-relaxed">
              {settings.tagline} Concept-focused Chemistry coaching for NEET, JEE, and Class 10, 11 & 12.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('apply')}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-xs"
            >
              Apply for Admission
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <CalendarCheck className="w-4 h-4 text-violet-600" />
              My Attendance
            </button>
            <button
              type="button"
              onClick={() => onNavigate('track')}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <Search className="w-4 h-4 text-violet-600" />
              Track Status
            </button>
          </div>
        </section>

        {/* 2. ONE CLEAN ADMISSION ANNOUNCEMENT CARD (Synced with Admin Settings & Banners) */}
        {(settings.admissionsOpen || currentBanner) && (
          <section className="app-card rounded-2xl p-5 sm:p-6 bg-violet-50/40 border-violet-200/80">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="space-y-1.5 max-w-2xl">
                <p className="text-xs font-semibold text-violet-700">
                  {currentBanner?.announcement ||
                    `Admissions Open · Session ${settings.academicSession}`}
                </p>
                <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">
                  {currentBanner?.title || settings.admissionHeadline}
                </h2>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {currentBanner?.description ||
                    `Standard admission fee is ₹${settings.defaultFee.toLocaleString('en-IN')}. Submit your form online without creating an account.`}
                </p>
                <p className="text-xs text-gray-500 pt-1">
                  Standard Fee:{' '}
                  <span className="font-mono font-semibold text-gray-900 tabular-nums">
                    ₹{settings.defaultFee.toLocaleString('en-IN')}
                  </span>{' '}
                  · Online Form · Digital Student ID
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigate('apply')}
                  className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  Apply Now
                </button>
                {activeBanners.length > 1 && (
                  <div className="flex items-center gap-1 ml-1">
                    <button
                      type="button"
                      aria-label="Previous announcement"
                      onClick={() =>
                        setBannerIndex((p) => (p - 1 + activeBanners.length) % activeBanners.length)
                      }
                      className="p-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:text-gray-900 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next announcement"
                      onClick={() => setBannerIndex((p) => (p + 1) % activeBanners.length)}
                      className="p-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:text-gray-900 cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 2B. TRACK MY ADMISSION (Zero-Login Student Self-Service) */}
        <TrackMyAdmission settings={settings} compact />

        {/* 2C. MY ATTENDANCE / TRACK ATTENDANCE (Zero-Login Student Attendance Portal) */}
        <section id="my-attendance" className="app-card rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5 max-w-2xl">
              <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-100 text-violet-600 flex items-center justify-center shrink-0">
                <CalendarCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">
                  MY ATTENDANCE / TRACK ATTENDANCE
                </p>
                <h2 className="font-display text-base sm:text-lg font-bold text-gray-900 mt-0.5">
                  Check Your Monthly Calendar &amp; Yearly Attendance Report
                </h2>
                <p className="text-xs sm:text-sm text-gray-600 mt-1 leading-relaxed">
                  Enter your Registered Mobile Number or Student ID Number — no OTP or login required — to view daily IST entry/exit times, color-coded attendance calendar, and download PDF reports.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Track Attendance
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>

        {/* 3. COURSES IN SMALL ROUNDED CARDS */}
        <section id="courses" className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">Courses</h2>
              <p className="text-xs sm:text-sm text-gray-500">
                Select a program to apply directly with automatic fee calculation.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.map((course) => (
              <div
                key={course.id}
                className="app-card rounded-2xl p-4 sm:p-5 flex flex-col justify-between hover:border-violet-300 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-gray-500 mb-2">
                    <span className="inline-flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-violet-600" />
                      {course.category || 'Chemistry'}
                    </span>
                    <span className="font-mono">{course.duration || '10 Months'}</span>
                  </div>
                  <h3 className="font-display text-base font-bold text-gray-900">{course.title}</h3>
                  {course.targetClass && (
                    <p className="text-xs text-violet-700 mt-0.5">{course.targetClass}</p>
                  )}
                  <p className="mt-2 text-xs sm:text-sm text-gray-600 line-clamp-2 leading-relaxed">
                    {course.description}
                  </p>
                </div>

                <div className="mt-4 pt-3.5 border-t border-gray-100 flex items-center justify-between gap-3">
                  <span className="font-mono text-base font-bold text-gray-900 tabular-nums">
                    ₹{course.feeAmount.toLocaleString('en-IN')}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate('apply', course.title)}
                    className="px-3.5 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Enroll
                  </button>
                </div>
              </div>
            ))}
          </div>

          {feeRules.length > 0 && (
            <div className="app-card rounded-2xl p-4 sm:p-5">
              <p className="text-xs font-semibold text-gray-900 mb-3">Special Batch & Class Fees</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500">
                      <th className="pb-2 font-medium">Category</th>
                      <th className="pb-2 font-medium">Class</th>
                      <th className="pb-2 font-medium">Course</th>
                      <th className="pb-2 font-medium">Batch</th>
                      <th className="pb-2 font-medium text-right">Fee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-700">
                    {feeRules.map((rule) => (
                      <tr key={rule.id}>
                        <td className="py-2.5 font-medium text-gray-900">{rule.label}</td>
                        <td className="py-2.5">{rule.studentClass || 'All'}</td>
                        <td className="py-2.5">{rule.course || 'All'}</td>
                        <td className="py-2.5">{rule.batch || 'All'}</td>
                        <td className="py-2.5 text-right font-mono font-semibold text-violet-700 tabular-nums">
                          ₹{rule.amount.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* 3B. RESPONSIVE PROMOTIONAL BANNER SLIDER (IMMEDIATELY ABOVE BATCH TIMINGS) */}
        <PromoBannerSlider
          banners={banners}
          settings={settings}
          onNavigate={onNavigate}
        />

        {/* 4. BATCH TIMINGS & NOTICES (2-COLUMN CLEAN GRID) */}
        <section id="batches" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Batch Timings */}
          <div className="lg:col-span-7 space-y-3">
            <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">
              Batch Timings
            </h2>
            <div className="app-card rounded-2xl divide-y divide-gray-100 overflow-hidden">
              {batches.map((b) => (
                <div
                  key={b.id}
                  className="px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-gray-50/70 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{b.timing}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {b.name} · {formatScheduledDaysSummary(b.scheduledDays)}
                        {b.capacity ? ` · ${b.capacity} seats` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('apply')}
                    className="text-xs font-semibold text-violet-700 hover:text-violet-900 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Notices */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">Notices</h2>
              <Bell className="w-4 h-4 text-violet-600" />
            </div>
            <div className="space-y-3">
              {notices.map((notice) => (
                <article key={notice.id} className="app-card rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-2 text-xs text-gray-500 mb-1.5">
                    <span className="font-medium text-violet-700">
                      {notice.category}
                      {notice.pinned ? ' · Pinned' : ''}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                      <Calendar className="w-3 h-3" />
                      {notice.createdAt?.toDate
                        ? notice.createdAt.toDate().toLocaleDateString('en-IN')
                        : 'Active'}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900">{notice.title}</h3>
                  <p className="mt-1 text-xs text-gray-600 leading-relaxed">{notice.content}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 5. ABOUT TEACHER (Reuses Admin-Uploaded Teacher Portrait & Cutout Composition) */}
        <section id="about" className="app-card rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div
              className={`w-24 h-28 sm:w-28 sm:h-32 rounded-2xl overflow-hidden border shrink-0 flex items-end justify-center ${
                settings.teacherPhotoIsCutout && (settings.teacherPhotoUrl || settings.teacherPhotoMediaId)
                  ? 'border-violet-300 bg-gradient-to-b from-violet-600 via-violet-700 to-violet-900'
                  : 'border-gray-200 bg-violet-50/60'
              }`}
            >
              <ResolvedImage
                url={settings.teacherPhotoUrl || (!settings.teacherPhotoMediaId ? ASSETS.sonuSirPortrait : '')}
                mediaId={settings.teacherPhotoMediaId}
                alt={settings.teacherName}
                className={
                  settings.teacherPhotoIsCutout && (settings.teacherPhotoUrl || settings.teacherPhotoMediaId)
                    ? 'w-full h-full object-contain object-bottom drop-shadow-md'
                    : 'w-full h-full object-cover object-top'
                }
                fallbackLabel={settings.teacherName || 'Teacher'}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-violet-700">About Teacher</p>
                {settings.teacherDesignation && (
                  <span className="px-2 py-0.5 rounded-md bg-violet-50 border border-violet-100 text-[11px] font-semibold text-violet-700">
                    {settings.teacherDesignation}
                  </span>
                )}
              </div>
              <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900 mt-0.5">
                {settings.teacherName}
              </h2>
              {(settings.teacherSpecialization || settings.teacherExperience) && (
                <p className="text-xs font-medium text-violet-700 mt-0.5">
                  {[settings.teacherSpecialization, settings.teacherExperience]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">
                {settings.teacherBio?.trim() ||
                  `Founder and Chief Chemistry Mentor at ${settings.instituteName}. Dedicated to building clear Organic mechanism logic, Physical numerical speed, and NCERT mastery for Board, NEET, and JEE students through structured notes and weekly tests.`}
              </p>
            </div>
          </div>
        </section>

        {/* 6. SMALL PHOTO GALLERY */}
        <section id="gallery" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">
              Photo Gallery
            </h2>
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-gray-100 w-fit">
              {galleryCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setGalleryCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    galleryCategory === cat
                      ? 'bg-white text-violet-700 font-semibold shadow-2xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {filteredGallery.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setLightboxItem(item)}
                className="group text-left app-card rounded-2xl overflow-hidden hover:border-violet-300 transition-colors cursor-pointer"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-gray-50">
                  <ResolvedImage
                    url={item.imageUrl}
                    mediaId={item.mediaId}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                    fallbackLabel={item.title}
                  />
                </div>
                <div className="p-3">
                  <p className="text-[11px] font-medium text-violet-700">{item.category}</p>
                  <p className="text-xs font-semibold text-gray-900 truncate mt-0.5">
                    {item.title}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* 7. CONTACT & WHATSAPP */}
        <section id="contact" className="app-card rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-3">
              <h2 className="font-display text-lg font-bold text-gray-900">Contact Us</h2>
              <div className="space-y-2 text-sm text-gray-600">
                <p className="flex items-center gap-2.5">
                  <Phone className="w-4 h-4 text-violet-600 shrink-0" />
                  <span className="font-mono text-gray-900 tabular-nums">{settings.phone}</span>
                </p>
                <p className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-violet-600 shrink-0" />
                  <span className="break-all">{settings.email}</span>
                </p>
                <p className="flex items-start gap-2.5">
                  <MapPin className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
                  <span>{settings.address}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors whitespace-nowrap"
              >
                <MessageCircle className="w-4 h-4" />
                Chat on WhatsApp
              </a>
              <button
                type="button"
                onClick={() => onNavigate('apply')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                Apply Now
              </button>
            </div>
          </div>
        </section>

        {/* Quiet Minimal Footer */}
        <footer className="pt-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
          <p>
            © {new Date().getFullYear()} {settings.instituteName} · {settings.teacherName}
          </p>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => onNavigate('apply')}
              className="hover:text-violet-700 cursor-pointer"
            >
              Admissions
            </button>
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="hover:text-violet-700 cursor-pointer"
            >
              My Attendance
            </button>
            <button
              type="button"
              onClick={() => onNavigate('track')}
              className="hover:text-violet-700 cursor-pointer"
            >
              Track Status
            </button>
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="hover:text-violet-700 cursor-pointer"
            >
              Admin Login
            </button>
          </div>
        </footer>
      </div>

      {/* Clean White Gallery Lightbox */}
      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLightboxItem(null)}
        >
          <div
            className="max-w-3xl w-full bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div>
                <p className="text-xs font-medium text-violet-700">{lightboxItem.category}</p>
                <p className="text-sm font-semibold text-gray-900">{lightboxItem.title}</p>
              </div>
              <button
                type="button"
                aria-label="Close photo preview"
                onClick={() => setLightboxItem(null)}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[72vh] overflow-hidden bg-gray-50 flex items-center justify-center">
              <ResolvedImage
                url={lightboxItem.imageUrl}
                mediaId={lightboxItem.mediaId}
                alt={lightboxItem.title}
                className="max-h-[72vh] w-auto object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
