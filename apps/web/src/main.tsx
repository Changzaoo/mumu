import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@/styles/globals.css';
import App from '@/App';
import { initPwaUpdater } from '@/pwa';
import { instalarDiagnostico } from '@/lib/local/playbackDiagnosis';

// Register the service worker + auto-updater as early as possible.
initPwaUpdater();

// `aurialDiagnostico()` no console diz, elo a elo, por que uma faixa não toca.
// "Indisponível" é o mesmo sintoma para quatro falhas diferentes; sem isto, a
// correção vira palpite — e já virou três vezes.
instalarDiagnostico();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
