# खादी ग्रामोद्योग — डिजिटल बिलिंग एवं स्टॉक प्रबंधन प्रणाली
*(Khadi Gramodyog Digital Billing, Inventory & Shop Management System)*

## Quick Start

1. **Supabase Setup**:
   - Create a Supabase project.
   - Run the SQL migrations in `supabase/migrations/` in order (`0001_schema.sql` → `0004_storage.sql`) in the Supabase SQL Editor (or via `supabase db push`).
   - Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

2. **Run Locally**:
   ```bash
   npm install
   npm run dev
   ```
   The **first user** to sign up automatically becomes the **Administrator (`admin`)**. Subsequent sign-ups require Admin activation in **Settings → User & Role Management**.

3. **Run Tests**:
   ```bash
   npm run test:db   # Runs 10 PostgreSQL scenarios in-memory via PGlite
   npm test          # Runs Vitest unit tests
   ```

4. **Build Static Web / Android (Capacitor)**:
   ```bash
   npm run build
   # Optional Android APK wrapper:
   npm install @capacitor/core @capacitor/cli @capacitor/android
   npx cap add android
   npm run android:sync
   ```
