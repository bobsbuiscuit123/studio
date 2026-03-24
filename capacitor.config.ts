import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.caspo.app',
  appName: 'CASPO',
  webDir: 'out', // not used, but clean
  backgroundColor: '#f6faf6',
  server: {
    url: 'https://casporeal.vercel.app',
    cleartext: true,
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: true,
    zoomEnabled: false,
    backgroundColor: '#f6faf6',
  },
};

export default config;
