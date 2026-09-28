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
  plugins: {
    // As barras do sistema são respeitadas no nativo (MainActivity afasta o
    // WebView delas). Deixar o Capacitor também injetar --safe-area-inset-*
    // reservaria o espaço duas vezes.
    SystemBars: {
      insetsHandling: 'disable',
    },
  },
};

export default config;
