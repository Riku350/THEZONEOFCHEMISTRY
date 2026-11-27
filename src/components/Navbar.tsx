import React from 'react';
import { Atom, CalendarCheck, ClipboardList, Home, Search, Shield } from 'lucide-react';
import { PublicView } from '../types';

interface NavbarProps {
  currentView: PublicView;
  instituteName: string;
  onNavigate: (view: PublicView, sectionId?: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, instituteName, onNavigate }) => {
  return (
    <>
      {/* Small Clean Top Navigation Bar */}
      <header className="no-print sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-6">
          {/* Zone 1: Brand Title (Single Line) */}
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="inline-flex items-center gap-2 font-display text-sm sm:text-base font-bold tracking-tight text-gray-900 hover:text-violet-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Atom className="w-4 h-4 text-violet-600 shrink-0" />
            <span>{instituteName}</span>
          </button>

          {/* Zone 2: Concise Desktop Nav Links */}
          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600"
          >
            <button
              type="button"
              onClick={() => onNavigate('home', 'courses')}
              className="hover:text-gray-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Courses
            </button>
            <button
              type="button"
              onClick={() => onNavigate('home', 'batches')}
              className="hover:text-gray-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Batches
            </button>
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                currentView === 'attendance' ? 'text-violet-700 font-semibold' : 'hover:text-gray-900'
              }`}
            >
              Attendance
            </button>
            <button
              type="button"
              onClick={() => onNavigate('track')}
              className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                currentView === 'track' ? 'text-violet-700 font-semibold' : 'hover:text-gray-900'
              }`}
            >
              Track
            </button>
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                currentView === 'admin' ? 'text-violet-700 font-semibold' : 'hover:text-gray-900'
              }`}
            >
              Admin
            </button>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('apply')}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Apply
            </button>
          </div>
        </div>
      </header>

      {/* Mobile App Bottom Tab Navigation (Mobile Only) */}
      <nav
        aria-label="Mobile Navigation"
        className="no-print md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 pb-safe"
      >
        <div className="grid grid-cols-5 h-14 items-center">
          {(
            [
              { id: 'home', label: 'Home', icon: Home },
              { id: 'apply', label: 'Apply', icon: ClipboardList },
              { id: 'attendance', label: 'Attend', icon: CalendarCheck },
              { id: 'track', label: 'Track', icon: Search },
              { id: 'admin', label: 'Admin', icon: Shield },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`flex flex-col items-center justify-center h-full transition-colors cursor-pointer ${
                  active ? 'text-violet-700' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className={`text-[10px] mt-1 ${active ? 'font-semibold' : 'font-medium'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
