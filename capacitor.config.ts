import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.khadigramodyog.billing',
  appName: 'खादी ग्रामोद्योग बिलिंग',
  webDir: 'out',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
