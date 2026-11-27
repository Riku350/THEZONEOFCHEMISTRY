import React, { useEffect, useState } from 'react';
import { Atom } from 'lucide-react';
import { resolveMediaSource } from '../lib/media';

interface ResolvedImageProps {
  url?: string;
  mediaId?: string;
  isPrivate?: boolean;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}

export const ResolvedImage: React.FC<ResolvedImageProps> = ({
  url,
  mediaId,
  isPrivate = false,
  alt,
  className = 'w-full h-full object-cover',
  fallbackLabel,
}) => {
  const [src, setSrc] = useState<string>(url || '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (url && url.trim().length > 0) {
      setSrc(url);
      return;
    }
    if (mediaId) {
      void resolveMediaSource(url, mediaId, isPrivate).then((resolved) => {
        if (active) {
          setSrc(resolved);
          if (!resolved) setFailed(true);
        }
      });
    } else {
      setSrc('');
      setFailed(true);
    }
    return () => {
      active = false;
    };
  }, [url, mediaId, isPrivate]);

  if (failed || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gray-50 text-gray-400 p-4 text-center ${className}`}
      >
        <Atom className="w-6 h-6 text-violet-400 mb-1.5" />
        {fallbackLabel && <span className="text-xs font-medium text-gray-500">{fallbackLabel}</span>}
      </div>
    );
  }

  if (src.startsWith('data:application/pdf') || src.toLowerCase().endsWith('.pdf')) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gray-50 text-gray-700 p-4 text-center ${className}`}
      >
        <span className="text-xs font-semibold mb-2">PDF Document</span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-xs font-semibold text-white transition-colors"
        >
          Open PDF
        </a>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
