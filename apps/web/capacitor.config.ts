import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'online.radinho.app',
  appName: 'radinho.online',
  webDir: 'dist',
  /**
   * O APP ABRE O PRÓPRIO SITE.
   *
   * Empacotar o `dist` fazia o APK nascer do build de quem compilou: sem as
   * `VITE_FIREBASE_*` (que moram no painel da Vercel) o login caía em "modo
   * demonstração", e cada melhoria do site exigia um APK novo. Carregando
   * radinho.online, o app é o site — mesma versão, mesma configuração,
   * atualizado a cada deploy. O service worker do PWA segue guardando o app
   * para abrir sem internet depois da primeira vez.
   *
   * `CAP_SERVER_URL` troca o endereço (ex.: prévia da Vercel, dev na rede).
   */
  server: {
    url: process.env.CAP_SERVER_URL || 'https://radinho.online',
    androidScheme: 'https',
    cleartext: false,
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
