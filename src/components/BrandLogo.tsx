import React, { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { resolveMediaSource } from '../lib/media';
import { InstituteSettings } from '../types';

interface BrandLogoProps {
  settings: InstituteSettings;
  variant?: 'main' | 'app';
  sizeClass?: string;
  iconSizeClass?: string;
  roundedClass?: string;
  className?: string;
  alt?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  settings,
  variant = 'main',
  sizeClass = 'w-9 h-9',
  iconSizeClass = 'w-4 h-4',
  roundedClass = 'rounded-xl',
  className = '',
  alt,
}) => {
  const [resolvedSrc, setResolvedSrc] = useState<string>('');
  const [imgFailed, setImgFailed] = useState(false);

  const primaryUrl =
    variant === 'app'
      ? settings.appLogoUrl || settings.mainLogoUrl || ''
      : settings.mainLogoUrl || settings.appLogoUrl || '';
  const primaryMediaId =
    variant === 'app'
      ? settings.appLogoMediaId || settings.mainLogoMediaId || ''
      : settings.mainLogoMediaId || settings.appLogoMediaId || '';

  useEffect(() => {
    let active = true;
    setImgFailed(false);
    if (!primaryUrl && !primaryMediaId) {
      setResolvedSrc('');
      return;
    }
    void resolveMediaSource(primaryUrl, primaryMediaId, false).then((src) => {
      if (active) setResolvedSrc(src || '');
    });
    return () => {
      active = false;
    };
  }, [primaryUrl, primaryMediaId]);

  if (resolvedSrc && !imgFailed) {
    return (
      <div
        className={`${sizeClass} ${roundedClass} bg-white border border-gray-200/90 flex items-center justify-center overflow-hidden shrink-0 p-1 ${className}`}
      >
        <img
          src={resolvedSrc}
          alt={alt || settings.instituteName || 'Institute Logo'}
          onError={() => setImgFailed(true)}
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} ${roundedClass} bg-violet-600 text-white flex items-center justify-center shrink-0 ${className}`}
    >
      <FlaskConical className={iconSizeClass} />
    </div>
  );
};
