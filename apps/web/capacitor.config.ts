import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'online.radinho.app',
  appName: 'radinho.online',
  webDir: 'dist',
  server: {
    cleartext: true,
  },
  android: {
    backgroundColor: '#000000',
  },
};

export default config;
