import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.caspo.app',
  appName: 'CASPO',
  webDir: 'out', // not used, but clean
  backgroundColor: '#f6faf4',
  server: {
    url: 'https://casporeal.vercel.app',
    cleartext: true,
  },
  ios: {
    contentInset: 'automatic',
    scrollEnabled: true,
    zoomEnabled: false,
    backgroundColor: '#f6faf4',
  },
};

export default config;
