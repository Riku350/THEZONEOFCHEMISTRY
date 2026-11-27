import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import { sanitizeBannerCtaTarget } from '../lib/firestoreService';
import { BannerItem, InstituteSettings, PublicView } from '../types';
import { ResolvedImage } from './ResolvedImage';

interface PromoBannerSliderProps {
  banners: BannerItem[];
  settings: InstituteSettings;
  onNavigate: (view: PublicView) => void;
}

export const PromoBannerSlider: React.FC<PromoBannerSliderProps> = ({
  banners,
  settings,
  onNavigate,
}) => {
  const activeBanners = useMemo(
    () =>
      banners
        .filter((b) => b.active)
        .sort((a, b) => (a.order || 0) - (b.order || 0)),
    [banners]
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const slideCount = activeBanners.length;
  const safeIndex = slideCount > 0 ? currentIndex % slideCount : 0;

  const autoSlide = settings.bannerAutoSlide !== false;
  const intervalMs =
    Math.max(2, Math.min(30, Number(settings.bannerSliderIntervalSec) || 5)) * 1000;

  useEffect(() => {
    if (slideCount <= 1 || !autoSlide || isPaused) return;
    const timer = window.setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % slideCount);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [slideCount, autoSlide, isPaused, intervalMs]);

  if (slideCount === 0) return null;

  const goPrev = () => {
    setCurrentIndex((prev) => (prev - 1 + slideCount) % slideCount);
  };

  const goNext = () => {
    setCurrentIndex((prev) => (prev + 1) % slideCount);
  };

  const whatsappHref = `https://wa.me/${(settings.whatsappNumber || '919876543210').replace(
    /[^0-9]/g,
    ''
  )}?text=${encodeURIComponent(
    `Hello ${settings.instituteName}, I saw your promotional banner and would like to know more.`
  )}`;

  const handleInternalCta = (target: string) => {
    if (target === 'apply' || target === 'attendance' || target === 'track') {
      onNavigate(target);
      return;
    }
    if (target.startsWith('#')) {
      const el = document.querySelector(target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const renderCta = (banner: BannerItem) => {
    const label = (banner.ctaLabel || '').trim();
    const target = sanitizeBannerCtaTarget(banner.ctaTarget);
    if (!label && !target) return null;

    const effectiveLabel = label || 'Apply Now';
    const effectiveTarget = target || 'apply';

    if (effectiveTarget === 'whatsapp') {
      return (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shadow-xs"
        >
          <MessageCircle className="w-4 h-4" />
          {effectiveLabel}
        </a>
      );
    }

    if (effectiveTarget.startsWith('https://')) {
      return (
        <a
          href={effectiveTarget}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shadow-xs"
        >
          {effectiveLabel}
          <ExternalLink className="w-4 h-4" />
        </a>
      );
    }

    return (
      <button
        type="button"
        onClick={() => handleInternalCta(effectiveTarget)}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-xs"
      >
        {effectiveLabel}
        <ArrowRight className="w-4 h-4" />
      </button>
    );
  };

  return (
    <section
      aria-label="Institute Promotional Highlights"
      className="space-y-3"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    >
      <div className="relative overflow-hidden rounded-2xl bg-white border border-violet-200/80 shadow-sm">
        {/* Sliding Track */}
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${safeIndex * 100}%)` }}
        >
          {activeBanners.map((banner) => {
            const hasImage = Boolean(banner.imageUrl || banner.mediaId);
            return (
              <div
                key={banner.id}
                className="w-full shrink-0 grid grid-cols-1 md:grid-cols-12 items-stretch"
              >
                {/* Visual Image Area (Top on Mobile, Right on Desktop) */}
                {hasImage && (
                  <div className="md:col-span-6 md:order-2 relative min-h-[200px] sm:min-h-[250px] md:min-h-[300px] bg-violet-50 overflow-hidden">
                    <ResolvedImage
                      url={banner.imageUrl}
                      mediaId={banner.mediaId}
                      alt={banner.title}
                      className="w-full h-full object-cover"
                      fallbackLabel={banner.title}
                    />
                    <div
                      className="hidden md:block absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-white via-white/40 to-transparent pointer-events-none"
                      aria-hidden="true"
                    />
                  </div>
                )}

                {/* Clean White & Purple Content Area */}
                <div
                  className={`${
                    hasImage ? 'md:col-span-6 md:order-1' : 'md:col-span-12'
                  } p-5 sm:p-7 md:p-8 flex flex-col justify-between gap-5 bg-white`}
                >
                  <div className="space-y-2.5">
                    {banner.announcement && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-50 border border-violet-100 text-[11px] font-semibold text-violet-700">
                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                        <span>{banner.announcement}</span>
                      </div>
                    )}

                    <h2 className="font-display text-xl sm:text-2xl md:text-[26px] font-bold tracking-tight text-gray-900 leading-snug">
                      {banner.title}
                    </h2>

                    {banner.subtitle && (
                      <p className="text-xs sm:text-sm font-semibold text-violet-700">
                        {banner.subtitle}
                      </p>
                    )}

                    {banner.description && (
                      <p className="text-xs sm:text-sm text-gray-600 leading-relaxed line-clamp-3">
                        {banner.description}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    {renderCta(banner)}

                    {slideCount > 1 && (
                      <span className="text-[11px] font-mono text-gray-400 tabular-nums">
                        {String(safeIndex + 1).padStart(2, '0')} /{' '}
                        {String(slideCount).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Manual Previous / Next Controls */}
        {slideCount > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous promotional banner"
              onClick={goPrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 hover:bg-white border border-gray-200 text-gray-700 hover:text-violet-700 shadow-sm flex items-center justify-center transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Next promotional banner"
              onClick={goNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 hover:bg-white border border-gray-200 text-gray-700 hover:text-violet-700 shadow-sm flex items-center justify-center transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Manual Slide Indicators */}
      {slideCount > 1 && (
        <div
          className="flex items-center justify-center gap-2"
          role="tablist"
          aria-label="Promotional banner slides"
        >
          {activeBanners.map((b, idx) => {
            const active = idx === safeIndex;
            return (
              <button
                key={b.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`Show banner ${idx + 1}: ${b.title}`}
                onClick={() => setCurrentIndex(idx)}
                className={`h-2 rounded-full transition-all cursor-pointer ${
                  active
                    ? 'w-7 bg-violet-600'
                    : 'w-2 bg-gray-300 hover:bg-violet-300'
                }`}
              />
            );
          })}
        </div>
      )}
    </section>
  );
};
