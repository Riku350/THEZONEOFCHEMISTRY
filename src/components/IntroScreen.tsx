import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { resolveMediaSource } from '../lib/media';
import { InstituteSettings } from '../types';

interface IntroScreenProps {
  settings: InstituteSettings;
  onComplete: () => void;
}

export const IntroScreen: React.FC<IntroScreenProps> = ({ settings, onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [logoSrc, setLogoSrc] = useState('');

  const brandUrl = settings.appLogoUrl || settings.mainLogoUrl || '';
  const brandMediaId = settings.appLogoMediaId || settings.mainLogoMediaId || '';

  useEffect(() => {
    let active = true;
    if (!brandUrl && !brandMediaId) {
      setLogoSrc('');
      return;
    }
    void resolveMediaSource(brandUrl, brandMediaId, false).then((src) => {
      if (active) setLogoSrc(src || '');
    });
    return () => {
      active = false;
    };
  }, [brandUrl, brandMediaId]);

  useEffect(() => {
    const duration = 2200;
    const start = performance.now();
    let frameId = 0;
    let doneTimeout = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(pct);
      if (elapsed < duration) {
        frameId = requestAnimationFrame(tick);
      } else {
        setExiting(true);
        doneTimeout = window.setTimeout(() => {
          onComplete();
        }, 320);
      }
    };
    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      window.clearTimeout(doneTimeout);
    };
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6 select-none"
    >
      <div className="flex flex-col items-center text-center max-w-sm w-full">
        {/* Uploaded Institute/App Logo or Animated Chemistry Molecule Fallback */}
        <motion.div
          initial={{ scale: 0.88, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6"
        >
          {logoSrc ? (
            <div className="w-20 h-20 rounded-2xl bg-white border border-violet-100 shadow-sm p-2.5 flex items-center justify-center overflow-hidden">
              <img
                src={logoSrc}
                alt={settings.instituteName || 'THE ZONE OF CHEMISTRY'}
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <motion.svg
              viewBox="0 0 88 88"
              className="w-16 h-16"
              animate={{ rotate: 360 }}
              transition={{ duration: 16, ease: 'linear', repeat: Infinity }}
              aria-hidden="true"
            >
              {/* Outer Benzene Hexagon */}
              <polygon
                points="44,10 73,27 73,61 44,78 15,61 15,27"
                fill="#F5F3FF"
                stroke="#7C3AED"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              {/* Inner Resonance Ring */}
              <circle
                cx="44"
                cy="44"
                r="16"
                fill="none"
                stroke="#8B5CF6"
                strokeWidth="1.8"
                strokeDasharray="5 4"
              />
              {/* Molecular Nodes */}
              <circle cx="44" cy="10" r="4" fill="#6D28D9" />
              <circle cx="73" cy="61" r="4" fill="#7C3AED" />
              <circle cx="15" cy="61" r="4" fill="#8B5CF6" />
              <circle cx="44" cy="44" r="3.5" fill="#6D28D9" />
            </motion.svg>
          )}
        </motion.div>

        {/* Subtle Fade-In Title & Teacher */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900"
        >
          {settings.instituteName || 'THE ZONE OF CHEMISTRY'}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="mt-1.5 text-sm font-semibold text-violet-700"
        >
          {settings.teacherName || 'SONU SIR #BABA'}
        </motion.p>

        {/* Small Minimal Loading Indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.45 }}
          className="mt-7 w-40"
        >
          <div className="h-1 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-violet-600 transition-[width] duration-75"
              style={{ width: `${progress}%` }}
            />
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};
