import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { AlertTriangle } from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminLogin } from './components/AdminLogin';
import { AdmissionForm } from './components/AdmissionForm';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FloatingWhatsApp } from './components/FloatingWhatsApp';
import { HomePage } from './components/HomePage';
import { IntroScreen } from './components/IntroScreen';
import { Navbar } from './components/Navbar';
import { StudentAttendanceTracker } from './components/StudentAttendanceTracker';
import { TrackApplication } from './components/TrackApplication';
import {
  DEFAULT_BANNERS,
  DEFAULT_BATCHES,
  DEFAULT_COURSES,
  DEFAULT_GALLERY,
  DEFAULT_NOTICES,
  DEFAULT_SETTINGS,
} from './config/defaults';
import { auth, isFirebaseConfigured } from './lib/firebase';
import {
  checkIsUserAdmin,
  fetchPublicInstituteData,
  PublicInstituteData,
} from './lib/firestoreService';
import { resolveMediaSource } from './lib/media';
import { PublicView } from './types';

export default function App() {
  // Always show cinematic intro screen on every initial open or page refresh
  const [showIntro, setShowIntro] = useState(true);
  const [view, setView] = useState<PublicView>('home');
  const [preselectedCourse, setPreselectedCourse] = useState<string | undefined>(undefined);

  // Public institute catalog state (live from Firestore with graceful defaults)
  const [publicData, setPublicData] = useState<PublicInstituteData>({
    settings: DEFAULT_SETTINGS,
    courses: DEFAULT_COURSES,
    batches: DEFAULT_BATCHES,
    feeRules: [],
    banners: DEFAULT_BANNERS,
    gallery: DEFAULT_GALLERY,
    notices: DEFAULT_NOTICES,
  });

  // Admin auth state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAuthorizedAdmin, setIsAuthorizedAdmin] = useState(false);

  const loadPublicData = useCallback(async () => {
    if (!isFirebaseConfigured) return;
    const data = await fetchPublicInstituteData();
    setPublicData(data);
  }, []);

  useEffect(() => {
    void loadPublicData();
  }, [loadPublicData]);

  // Dynamically sync document title & browser favicon with Website Branding settings
  useEffect(() => {
    const s = publicData.settings;
    if (s.instituteName) {
      document.title = s.teacherName ? `${s.instituteName} | ${s.teacherName}` : s.instituteName;
    }

    const favUrl = s.faviconUrl || s.appLogoUrl || s.mainLogoUrl || '';
    const favMediaId = s.faviconMediaId || s.appLogoMediaId || s.mainLogoMediaId || '';
    if (!favUrl && !favMediaId) return;

    let active = true;
    void resolveMediaSource(favUrl, favMediaId, false).then((resolved) => {
      if (!active || !resolved) return;
      const upsertLink = (rel: string) => {
        let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
        if (!link) {
          link = document.createElement('link');
          link.rel = rel;
          document.head.appendChild(link);
        }
        link.href = resolved;
      };
      upsertLink('icon');
      upsertLink('apple-touch-icon');
    });
    return () => {
      active = false;
    };
  }, [
    publicData.settings.instituteName,
    publicData.settings.teacherName,
    publicData.settings.faviconUrl,
    publicData.settings.faviconMediaId,
    publicData.settings.appLogoUrl,
    publicData.settings.appLogoMediaId,
    publicData.settings.mainLogoUrl,
    publicData.settings.mainLogoMediaId,
  ]);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAuthReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        const ok = await checkIsUserAdmin(nextUser.uid, nextUser.email, nextUser.emailVerified);
        setIsAuthorizedAdmin(ok);
      } else {
        setIsAuthorizedAdmin(false);
      }
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  const handleNavigate = useCallback((nextView: PublicView, arg?: string) => {
    setView(nextView);
    if (nextView === 'apply') {
      setPreselectedCourse(arg);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (nextView === 'home' && arg) {
      window.setTimeout(() => {
        const target = document.getElementById(arg);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      }, 60);
      return;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  if (!isFirebaseConfigured) {
    return (
      <div className="min-h-screen bg-white text-gray-900 flex items-center justify-center p-6">
        <div className="max-w-lg w-full app-card rounded-2xl p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
          <h1 className="font-display text-xl font-bold text-gray-900">
            Firebase Configuration Required
          </h1>
          <p className="mt-3 text-sm text-gray-600 leading-relaxed">
            Firebase credentials are missing from <code className="font-mono text-violet-700">firebase-applet-config.json</code>. Configure Firebase Authentication, Firestore, and Storage to enable live admissions, admin approvals, and QR verification.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {showIntro && (
        <IntroScreen settings={publicData.settings} onComplete={() => setShowIntro(false)} />
      )}

      {view === 'admin' && authReady && user && isAuthorizedAdmin ? (
        <AdminDashboard
          user={user}
          onNavigatePublic={(v) => handleNavigate(v)}
          onPublicDataChanged={() => void loadPublicData()}
        />
      ) : (
        <div className="min-h-screen bg-white text-gray-900 flex flex-col">
          <Navbar
            currentView={view}
            settings={publicData.settings}
            onNavigate={handleNavigate}
          />

          <main className="flex-1">
            {view === 'home' && (
              <HomePage
                settings={publicData.settings}
                courses={publicData.courses}
                batches={publicData.batches}
                feeRules={publicData.feeRules}
                banners={publicData.banners}
                gallery={publicData.gallery}
                notices={publicData.notices}
                onNavigate={handleNavigate}
              />
            )}

            {view === 'apply' && (
              <AdmissionForm
                settings={publicData.settings}
                courses={publicData.courses}
                batches={publicData.batches}
                feeRules={publicData.feeRules}
                preselectedCourse={preselectedCourse}
                onNavigate={handleNavigate}
              />
            )}

            {view === 'track' && (
              <TrackApplication
                settings={publicData.settings}
                onNavigate={handleNavigate}
              />
            )}

            {view === 'attendance' && (
              <StudentAttendanceTracker
                settings={publicData.settings}
                batches={publicData.batches}
                onNavigate={handleNavigate}
              />
            )}

            {view === 'admin' && (
              <AdminLogin
                settings={publicData.settings}
                user={user}
                authReady={authReady}
                isAuthorizedAdmin={isAuthorizedAdmin}
                onNavigate={handleNavigate}
              />
            )}
          </main>

          <FloatingWhatsApp
            whatsappNumber={publicData.settings.whatsappNumber}
            instituteName={publicData.settings.instituteName}
          />
        </div>
      )}
    </ErrorBoundary>
  );
}
