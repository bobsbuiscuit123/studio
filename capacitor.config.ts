import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.caspo.app',
  appName: 'CASPO',
  webDir: 'out', // not used, but clean
  backgroundColor: '#e3f5e6',
  server: {
    url: 'https://casporeal.vercel.app',
    cleartext: true,
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: true,
    zoomEnabled: false,
    backgroundColor: '#e3f5e6',
  },
};

export default config;
