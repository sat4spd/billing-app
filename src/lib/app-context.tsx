'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';
import type { AppUser, Category, RoleCode, ShopSettings } from './types';
import { toHindiDigits } from './format';

type Lang = 'hi' | 'en';

interface AppContextValue {
  ready: boolean;
  session: Session | null;
  profile: AppUser | null;
  settings: ShopSettings | null;
  categories: Category[];
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Bilingual label helper: L('नया बिल', 'New Bill') */
  L: (hi: string, en: string) => string;
  /** Format digits for UI according to the UI numerals setting. */
  N: (s: string | number) => string;
  role: RoleCode | null;
  isAdmin: boolean;
  can: (perm: Permission) => boolean;
  online: boolean;
  refreshSettings: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

export type Permission =
  | 'billing' | 'products.view' | 'products.add' | 'products.edit' | 'categories' | 'inventory' | 'inventory.view'
  | 'registers' | 'reports' | 'settings' | 'users' | 'returns.approve' | 'returns.request' | 'export' | 'purchase_price'
  | 'edit_price' | 'discount' | 'audit';

const ROLE_PERMS: Record<RoleCode, Permission[] | '*'> = {
  admin: '*',
  employee: ['billing', 'products.view', 'products.add', 'inventory.view', 'returns.request'],
  accountant: ['products.view', 'inventory.view', 'registers', 'reports', 'export', 'purchase_price', 'returns.request'],
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lang, setLangState] = useState<Lang>('hi');
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? (localStorage.getItem('khadi-lang') as Lang | null) : null;
    if (saved) setLangState(saved);
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const setLang = useCallback((l: Lang) => { setLangState(l); localStorage.setItem('khadi-lang', l); }, []);

  const refreshSettings = useCallback(async () => {
    const { data } = await supabase.from('shop_settings').select('*').eq('id', 1).maybeSingle();
    if (data) {
      setSettings(data as ShopSettings);
      localStorage.setItem('khadi-settings-cache', JSON.stringify(data));
      if (!localStorage.getItem('khadi-lang')) setLangState((data as ShopSettings).default_language);
    }
  }, []);

  const refreshCategories = useCallback(async () => {
    const { data } = await supabase.from('categories').select('*').order('sort_order').order('name_hi');
    if (data) { setCategories(data as Category[]); localStorage.setItem('khadi-categories-cache', JSON.stringify(data)); }
  }, []);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) { setProfile(null); return; }
    const { data } = await supabase.from('users').select('*').eq('id', uid).maybeSingle();
    setProfile((data as AppUser) ?? null);
  }, []);

  const refreshProfile = useCallback(async () => { await loadProfile(session?.user.id); }, [loadProfile, session]);

  useEffect(() => {
    if (!isSupabaseConfigured) { setReady(true); return; }
    // Offline-first: show cached settings/categories immediately.
    try {
      const s = localStorage.getItem('khadi-settings-cache'); if (s) setSettings(JSON.parse(s));
      const c = localStorage.getItem('khadi-categories-cache'); if (c) setCategories(JSON.parse(c));
    } catch { /* ignore */ }

    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await Promise.all([refreshSettings(), data.session ? loadProfile(data.session.user.id) : Promise.resolve()]);
      if (data.session) await refreshCategories();
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      if (s) { loadProfile(s.user.id); refreshCategories(); } else { setProfile(null); }
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [refreshSettings, refreshCategories, loadProfile]);

  const role = (profile?.is_active ? profile.role_code : null) as RoleCode | null;

  const can = useCallback((perm: Permission) => {
    if (!role) return false;
    const p = ROLE_PERMS[role];
    if (p === '*') return true;
    if (perm === 'edit_price') return Boolean(settings?.employee_can_edit_price || profile?.can_edit_price) && role === 'employee';
    if (perm === 'discount') return Boolean(settings?.employee_can_give_discount || profile?.can_give_discount) && role === 'employee';
    return p.includes(perm);
  }, [role, settings, profile]);

  const L = useCallback((hi: string, en: string) => (lang === 'hi' ? hi : en), [lang]);
  const N = useCallback((s: string | number) => (settings?.ui_numerals === 'hindi' ? toHindiDigits(s) : String(s)), [settings]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null); setSession(null);
  }, []);

  const value = useMemo<AppContextValue>(() => ({
    ready, session, profile, settings, categories, lang, setLang, L, N, role, isAdmin: role === 'admin', can, online,
    refreshSettings, refreshCategories, refreshProfile, signOut,
  }), [ready, session, profile, settings, categories, lang, setLang, L, N, role, can, online, refreshSettings, refreshCategories, refreshProfile, signOut]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export const ROLE_LABELS: Record<RoleCode, { hi: string; en: string }> = {
  admin: { hi: 'प्रशासक', en: 'Administrator' },
  employee: { hi: 'बिलिंग कर्मचारी', en: 'Billing Employee' },
  accountant: { hi: 'लेखाकार / प्रबंधक', en: 'Accountant / Manager' },
};

export const PAYMENT_LABELS: Record<string, { hi: string; en: string }> = {
  cash: { hi: 'नकद', en: 'Cash' },
  upi: { hi: 'यूपीआई', en: 'UPI' },
  card: { hi: 'कार्ड', en: 'Card' },
  bank: { hi: 'बैंक ट्रांसफर', en: 'Bank Transfer' },
  other: { hi: 'अन्य', en: 'Other' },
  split: { hi: 'मिश्रित', en: 'Split' },
  credit: { hi: 'उधार', en: 'Credit' },
  credit_note: { hi: 'क्रेडिट नोट', en: 'Credit Note' },
};

export const STATUS_LABELS: Record<string, { hi: string; en: string }> = {
  completed: { hi: 'पूर्ण', en: 'Completed' },
  partially_returned: { hi: 'आंशिक वापसी', en: 'Partially Returned' },
  returned: { hi: 'वापस', en: 'Returned' },
  cancelled: { hi: 'रद्द', en: 'Cancelled' },
  paid: { hi: 'भुगतान पूर्ण', en: 'Paid' },
  partial: { hi: 'आंशिक भुगतान', en: 'Partial' },
  unpaid: { hi: 'बकाया', en: 'Unpaid' },
  refunded: { hi: 'वापस किया', en: 'Refunded' },
  pending: { hi: 'लंबित', en: 'Pending' },
  approved: { hi: 'स्वीकृत', en: 'Approved' },
  rejected: { hi: 'अस्वीकृत', en: 'Rejected' },
};

export const UNITS: { code: string; hi: string; en: string }[] = [
  { code: 'piece', hi: 'नग', en: 'Piece' },
  { code: 'metre', hi: 'मीटर', en: 'Metre' },
  { code: 'kg', hi: 'किलो', en: 'Kg' },
  { code: 'gram', hi: 'ग्राम', en: 'Gram' },
  { code: 'litre', hi: 'लीटर', en: 'Litre' },
  { code: 'packet', hi: 'पैकेट', en: 'Packet' },
  { code: 'pair', hi: 'जोड़ी', en: 'Pair' },
  { code: 'set', hi: 'सेट', en: 'Set' },
  { code: 'dozen', hi: 'दर्जन', en: 'Dozen' },
];

export function unitLabel(code: string, lang: Lang): string {
  const u = UNITS.find((x) => x.code === code);
  return u ? (lang === 'hi' ? u.hi : u.en) : code;
}
