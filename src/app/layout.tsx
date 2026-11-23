import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider } from '@/lib/app-context';
import { AuthGate } from '@/components/AuthGate';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'खादी ग्रामोद्योग — डिजिटल बिलिंग एवं स्टॉक प्रबंधन',
  description: 'Khadi Gramodyog Digital Billing, Category-wise Hindi Receipts & Inventory Management',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#d98b1c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hi">
      <body>
        <AppProvider>
          <AuthGate>
            <AppShell>{children}</AppShell>
          </AuthGate>
        </AppProvider>
      </body>
    </html>
  );
}
