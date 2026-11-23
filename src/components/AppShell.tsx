'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  BookOpen,
  Boxes,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Settings,
  Tags,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { ROLE_LABELS, useApp, type Permission } from '@/lib/app-context';
import { getOfflineQueue, removeOfflineBill } from '@/lib/offline-queue';
import { rpc } from '@/lib/supabase';

interface NavItem {
  href: string;
  hi: string;
  en: string;
  icon: React.ComponentType<{ className?: string }>;
  perm?: Permission;
  highlight?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/billing/', hi: 'नया बिल', en: 'New Bill', icon: PlusCircle, perm: 'billing', highlight: true },
  { href: '/', hi: 'डैशबोर्ड', en: 'Dashboard', icon: LayoutDashboard },
  { href: '/products/', hi: 'उत्पाद', en: 'Products', icon: Package, perm: 'products.view' },
  { href: '/inventory/', hi: 'स्टॉक', en: 'Inventory', icon: Boxes, perm: 'inventory.view' },
  { href: '/categories/', hi: 'श्रेणियाँ', en: 'Categories', icon: Tags, perm: 'categories' },
  { href: '/registers/', hi: 'बिक्री रजिस्टर', en: 'Sales Register', icon: BookOpen, perm: 'registers' },
  { href: '/transactions/', hi: 'बिल इतिहास', en: 'Bill History', icon: History },
  { href: '/returns/', hi: 'वापसी / रद्द', en: 'Returns', icon: RotateCcw },
  { href: '/reports/', hi: 'रिपोर्ट्स', en: 'Reports', icon: BarChart3, perm: 'reports' },
  { href: '/settings/', hi: 'सेटिंग्स', en: 'Settings', icon: Settings, perm: 'settings' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { settings, profile, role, can, lang, setLang, L, online, signOut } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setQueuedCount(getOfflineQueue().length);
    const id = setInterval(() => setQueuedCount(getOfflineQueue().length), 4000);
    return () => clearInterval(id);
  }, []);

  const syncOfflineQueue = async () => {
    const queue = getOfflineQueue();
    if (!queue.length || !online) return;
    setSyncing(true);
    try {
      for (const bill of queue) {
        const { summary: _s, created_at: _c, ...payload } = bill;
        await rpc('create_bill', { p: payload });
        removeOfflineBill(bill.idempotency_key);
      }
      setQueuedCount(getOfflineQueue().length);
    } finally {
      setSyncing(false);
    }
  };

  const visibleItems = NAV_ITEMS.filter((it) => !it.perm || can(it.perm));

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/' || pathname === '';
    return pathname.startsWith(href.replace(/\/$/, ''));
  };

  return (
    <div className="flex min-h-screen flex-col bg-khadi-50 md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden w-64 shrink-0 flex-col border-r border-khadi-200 bg-white md:flex">
        <div className="border-b border-khadi-200 bg-gradient-to-br from-khadi-100 to-amber-50 p-4">
          <div className="text-[11px] font-semibold text-khadi-800">
            {settings?.certification_line || 'खादी ग्रामोद्योग'}
          </div>
          <div className="mt-0.5 text-base font-bold leading-snug text-stone-900">
            {settings?.shop_name || 'खादी ग्रामोद्योग संस्थान'}
          </div>
          {profile && (
            <div className="mt-2 flex items-center justify-between text-xs text-stone-600">
              <span className="truncate font-semibold">{profile.full_name || profile.email}</span>
              {role && (
                <span className="rounded bg-khadi-200/70 px-1.5 py-0.5 text-[10px] font-bold text-khadi-900">
                  {ROLE_LABELS[role][lang]}
                </span>
              )}
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            if (item.highlight) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`mb-2 flex items-center gap-3 rounded-xl px-3.5 py-3 text-base font-bold shadow-sm transition ${
                    active
                      ? 'bg-leaf-700 text-white ring-2 ring-leaf-600/30'
                      : 'bg-leaf-600 text-white hover:bg-leaf-700'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{L(item.hi, item.en)}</span>
                </Link>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
                  active
                    ? 'bg-khadi-100 text-khadi-900'
                    : 'text-stone-700 hover:bg-stone-100'
                }`}
              >
                <Icon className={`h-4.5 w-4.5 ${active ? 'text-khadi-700' : 'text-stone-500'}`} />
                <span>{L(item.hi, item.en)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-khadi-200 p-3 space-y-2">
          {queuedCount > 0 && (
            <button
              type="button"
              onClick={syncOfflineQueue}
              disabled={!online || syncing}
              className="flex w-full items-center justify-between rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900"
            >
              <span>{L(`लंबित ऑफलाइन बिल: ${queuedCount}`, `Queued offline bills: ${queuedCount}`)}</span>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {online ? (
                <span className="flex items-center gap-1 text-leaf-700">
                  <Wifi className="h-3.5 w-3.5" /> {L('ऑनलाइन', 'Online')}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-red-600">
                  <WifiOff className="h-3.5 w-3.5" /> {L('ऑफलाइन', 'Offline')}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
              className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-bold text-stone-700 hover:bg-stone-100"
            >
              {lang === 'hi' ? 'EN' : 'हिन्दी'}
            </button>
            <button
              type="button"
              onClick={signOut}
              title={L('लॉगआउट', 'Sign Out')}
              className="rounded-lg p-1.5 text-stone-500 hover:bg-red-50 hover:text-red-600"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Top Bar */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-khadi-200 bg-white px-3 py-2.5 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-lg p-1.5 text-stone-700 hover:bg-stone-100"
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="truncate px-2 text-sm font-bold text-stone-900">
          {settings?.shop_name || 'खादी ग्रामोद्योग'}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
            className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold"
          >
            {lang === 'hi' ? 'EN' : 'हिन्दी'}
          </button>
          {can('billing') && (
            <Link
              href="/billing/"
              className="rounded-lg bg-leaf-600 px-2.5 py-1.5 text-xs font-bold text-white"
            >
              {L('+ बिल', '+ Bill')}
            </Link>
          )}
        </div>
      </header>

      {/* Mobile Slide-over Drawer */}
      {drawerOpen && (
        <div className="no-print fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="relative z-10 flex w-72 max-w-[82vw] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b bg-khadi-100 p-4">
              <div>
                <div className="text-sm font-bold text-stone-900">{profile?.full_name || 'Staff'}</div>
                <div className="text-xs text-stone-600">{role ? ROLE_LABELS[role][lang] : ''}</div>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="p-1">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold ${
                      isActive(item.href)
                        ? 'bg-khadi-100 text-khadi-900'
                        : 'text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5" />
                    <span>{L(item.hi, item.en)}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="border-t p-3">
              <button
                type="button"
                onClick={signOut}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-100 py-2.5 text-sm font-semibold text-red-700"
              >
                <LogOut className="h-4 w-4" />
                {L('लॉगआउट', 'Sign Out')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-x-hidden p-3 sm:p-5 lg:p-6">{children}</main>
    </div>
  );
}
