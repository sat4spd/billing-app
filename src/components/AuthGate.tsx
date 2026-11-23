'use client';

import React, { useState } from 'react';
import { Lock, LogIn, ShieldAlert, UserPlus } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useApp } from '@/lib/app-context';
import { errorMessage } from '@/lib/errors';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, session, profile, settings, lang, setLang, L, signOut } = useApp();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-khadi-50">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-khadi-500 border-t-transparent" />
          <p className="mt-3 font-semibold text-stone-700">{L('लोड हो रहा है...', 'Loading...')}</p>
        </div>
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-khadi-50 p-4">
        <div className="w-full max-w-lg rounded-2xl border border-amber-300 bg-white p-6 shadow-lg">
          <div className="flex items-center gap-3 text-amber-700">
            <ShieldAlert className="h-7 w-7 shrink-0" />
            <h1 className="text-xl font-bold">Supabase Configuration Required</h1>
          </div>
          <p className="mt-3 text-sm text-stone-600">
            Add <code className="rounded bg-stone-100 px-1.5 py-0.5">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-stone-100 px-1.5 py-0.5">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{' '}
            <code className="rounded bg-stone-100 px-1.5 py-0.5">.env.local</code>, then run the SQL migrations in{' '}
            <code className="rounded bg-stone-100 px-1.5 py-0.5">supabase/migrations/</code>.
          </p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw error;
        setMsg({
          type: 'ok',
          text: L(
            'खाता बन गया। यदि आप पहले उपयोगकर्ता हैं तो स्वतः प्रशासक बन जाएंगे; अन्यथा प्रशासक की स्वीकृति की प्रतीक्षा करें।',
            'Account created. First user becomes Admin automatically; otherwise await Admin activation.',
          ),
        });
      }
    } catch (err) {
      setMsg({ type: 'err', text: errorMessage(err, lang) });
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-khadi-50 via-amber-50 to-orange-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-khadi-200 bg-white p-6 shadow-xl">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-semibold text-khadi-700">
                {settings?.certification_line || 'खादी ग्रामोद्योग आयोग द्वारा प्रमाणित'}
              </div>
              <h1 className="mt-0.5 text-xl font-bold text-stone-900">
                {settings?.shop_name || 'छोटानागपुर खादी ग्रामोद्योग संस्थान'}
              </h1>
              <p className="text-xs text-stone-500">
                {L('डिजिटल बिलिंग एवं स्टॉक प्रबंधन प्रणाली', 'Digital Billing & Inventory System')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
              className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-50"
            >
              {lang === 'hi' ? 'English' : 'हिन्दी'}
            </button>
          </div>

          <div className="mt-5 flex rounded-xl bg-stone-100 p-1 text-sm font-semibold">
            <button
              type="button"
              onClick={() => { setMode('login'); setMsg(null); }}
              className={`flex-1 rounded-lg py-2 transition ${mode === 'login' ? 'bg-white text-khadi-700 shadow-sm' : 'text-stone-600'}`}
            >
              {L('लॉगिन (Login)', 'Login')}
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setMsg(null); }}
              className={`flex-1 rounded-lg py-2 transition ${mode === 'signup' ? 'bg-white text-khadi-700 shadow-sm' : 'text-stone-600'}`}
            >
              {L('नया पंजीकरण', 'Sign Up')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-semibold text-stone-700">
                  {L('पूरा नाम', 'Full Name')}
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-base focus:border-khadi-500 focus:outline-none"
                  placeholder={L('उदा. रमेश कुमार', 'e.g. Ramesh Kumar')}
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-stone-700">
                {L('ईमेल', 'Email')}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-base focus:border-khadi-500 focus:outline-none"
                placeholder="staff@khadi.in"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-stone-700">
                {L('पासवर्ड', 'Password')}
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-base focus:border-khadi-500 focus:outline-none"
                placeholder="••••••"
              />
            </div>

            {msg && (
              <div
                className={`rounded-xl px-3.5 py-2.5 text-sm font-medium ${
                  msg.type === 'err' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                }`}
              >
                {msg.text}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-khadi-600 py-3 text-base font-bold text-white shadow hover:bg-khadi-700 disabled:opacity-60"
            >
              {mode === 'login' ? <LogIn className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
              {busy
                ? L('कृपया प्रतीक्षा करें...', 'Please wait...')
                : mode === 'login'
                ? L('लॉगिन करें', 'Sign In')
                : L('खाता बनाएं', 'Create Account')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (profile && !profile.is_active) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-khadi-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-lg">
          <Lock className="mx-auto h-10 w-10 text-amber-600" />
          <h2 className="mt-3 text-lg font-bold text-stone-900">
            {L('खाता सक्रिय होने की प्रतीक्षा में है', 'Account Awaiting Activation')}
          </h2>
          <p className="mt-2 text-sm text-stone-600">
            {L(
              'आपका खाता प्रशासक द्वारा सक्रिय किए जाने के बाद ही बिलिंग शुरू होगी।',
              'An administrator must activate your account in Settings → Employees before you can access the shop.',
            )}
          </p>
          <button
            type="button"
            onClick={signOut}
            className="mt-5 rounded-xl bg-stone-800 px-5 py-2.5 text-sm font-semibold text-white"
          >
            {L('लॉगआउट करें', 'Sign Out')}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
