import React, { useState } from 'react';
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { auth, googleProvider, OWNER_ADMIN_EMAIL } from '../lib/firebase';
import { InstituteSettings, PublicView } from '../types';

interface AdminLoginProps {
  settings: InstituteSettings;
  user: User | null;
  authReady: boolean;
  isAuthorizedAdmin: boolean;
  onNavigate: (view: PublicView) => void;
}

const INPUT_CLASS =
  'w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors';

export const AdminLogin: React.FC<AdminLoginProps> = ({
  settings,
  user,
  authReady,
  isAuthorizedAdmin,
  onNavigate,
}) => {
  const [mode, setMode] = useState<'google' | 'email' | 'forgot'>('google');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const handleGoogleSignIn = async () => {
    setError('');
    setInfoMsg('');
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid email or password.';
      if (msg.includes('operation-not-allowed') || msg.includes('configuration-not-found')) {
        setError(
          'Email/Password login is not enabled in Firebase Console yet. Use Google Sign-In or enable Email/Password in Firebase Authentication.'
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    if (!email.trim()) {
      setError('Enter your registered admin email.');
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfoMsg('Password reset link sent if an email/password admin account exists.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send password reset email.');
    } finally {
      setBusy(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
      </div>
    );
  }

  if (user && !isAuthorizedAdmin) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 pb-24">
        <div className="app-card rounded-2xl p-6 text-center">
          <div className="w-11 h-11 rounded-xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="font-display text-xl font-bold text-gray-900">Access Restricted</h1>
          <p className="mt-1.5 text-sm text-gray-600">
            <span className="font-mono text-gray-900">{user.email}</span> is not authorized as an institute admin.
          </p>
          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-3.5 text-left text-xs text-gray-600 space-y-1">
            <p>
              <strong className="text-gray-900">Owner Email:</strong>{' '}
              <span className="font-mono">{OWNER_ADMIN_EMAIL}</span>
            </p>
            <p>
              <strong className="text-gray-900">Your UID:</strong>{' '}
              <span className="font-mono break-all">{user.uid}</span>
            </p>
          </div>
          <div className="mt-5 flex items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => void signOut(auth)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="px-4 py-2.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold cursor-pointer"
            >
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-10 pb-24">
      <button
        type="button"
        onClick={() => onNavigate('home')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 mb-4 cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      <div className="app-card rounded-2xl p-6">
        <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 flex items-center justify-center mb-4">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <h1 className="font-display text-xl font-bold text-gray-900">Admin Login</h1>
        <p className="mt-1 text-xs text-gray-500">
          {settings.instituteName} · {settings.teacherName}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-1 p-1 rounded-xl bg-gray-100">
          {(
            [
              ['google', 'Google'],
              ['email', 'Email'],
              ['forgot', 'Reset'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMode(id);
                setError('');
                setInfoMsg('');
              }}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                mode === id ? 'bg-white text-violet-700 shadow-2xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 flex items-start gap-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {infoMsg && (
          <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-start gap-2 text-xs text-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{infoMsg}</span>
          </div>
        )}

        {mode === 'google' && (
          <div className="mt-5 space-y-3">
            <button
              type="button"
              disabled={busy}
              onClick={handleGoogleSignIn}
              className="w-full inline-flex items-center justify-center gap-2.5 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Continue with Google
            </button>
            <p className="text-[11px] text-gray-500 text-center">
              Authorized Owner: <span className="font-mono text-gray-700">{OWNER_ADMIN_EMAIL}</span>
            </p>
          </div>
        )}

        {mode === 'email' && (
          <form onSubmit={handleEmailSignIn} className="mt-5 space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Admin Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@thezoneofchemistry.in"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className={INPUT_CLASS}
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Sign In
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handlePasswordReset} className="mt-5 space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Admin Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Registered email"
                className={INPUT_CLASS}
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Send Reset Link
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
