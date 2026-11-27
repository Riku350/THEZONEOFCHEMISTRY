import React from 'react';
import { MessageCircle } from 'lucide-react';

interface FloatingWhatsAppProps {
  whatsappNumber: string;
  instituteName: string;
}

export const FloatingWhatsApp: React.FC<FloatingWhatsAppProps> = ({
  whatsappNumber,
  instituteName,
}) => {
  const digits = (whatsappNumber || '919876543210').replace(/[^0-9]/g, '');
  const text = encodeURIComponent(
    `Hello ${instituteName}, I would like to inquire about Chemistry coaching admissions and batch timings.`
  );
  const href = `https://wa.me/${digits}?text=${text}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Contact on WhatsApp"
      className="no-print fixed bottom-18 md:bottom-5 right-4 z-30 inline-flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold shadow-md transition-transform duration-150 hover:scale-[1.03]"
    >
      <MessageCircle className="w-4 h-4 shrink-0" />
      <span className="hidden sm:inline whitespace-nowrap">WhatsApp</span>
    </a>
  );
};
