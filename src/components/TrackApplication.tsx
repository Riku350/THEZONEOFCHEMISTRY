import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { InstituteSettings, PublicView } from '../types';
import { TrackMyAdmission } from './TrackMyAdmission';

interface TrackApplicationProps {
  settings: InstituteSettings;
  onNavigate: (view: PublicView) => void;
}

export const TrackApplication: React.FC<TrackApplicationProps> = ({ settings, onNavigate }) => {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24">
      <button
        type="button"
        onClick={() => onNavigate('home')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 mb-4 cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      <TrackMyAdmission settings={settings} />
    </div>
  );
};
