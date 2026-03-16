import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.caspo.app',
  appName: 'CASPO',
  webDir: 'public',
  server: {
    url: 'https://caspo.vercel.app',
    cleartext: true,
  },
};

export default config;
