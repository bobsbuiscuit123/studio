import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.caspo.app',
  appName: 'CASPO',
  webDir: 'out', // not used, but clean
  server: {
    url: 'https://casporeal.vercel.app',
    cleartext: true,
  },
};

export default config;
