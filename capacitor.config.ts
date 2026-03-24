import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.caspo.app',
  appName: 'CASPO',
  webDir: 'out', // not used, but clean
  backgroundColor: '#ffffff',
  server: {
    url: 'https://casporeal.vercel.app',
    cleartext: true,
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: true,
    zoomEnabled: false,
    backgroundColor: '#ffffff',
  },
};

export default config;
