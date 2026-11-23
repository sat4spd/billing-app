/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the app is a pure client (PWA / Capacitor Android) talking
  // to Supabase directly. All business rules live in PostgreSQL functions + RLS.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
