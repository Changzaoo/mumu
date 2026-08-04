import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@/styles/globals.css';
import App from '@/App';
import { initPwaUpdater } from '@/pwa';
import { instalarDiagnostico } from '@/lib/local/playbackDiagnosis';
import { instalarBootPerf, marcarBoot } from '@/lib/telemetry/bootPerf';
import { instalarSyncDiagnostico } from '@/lib/sync/syncStatus';

// Primeira linha executável do app: daqui para trás é download + parse do
// bundle, e é isso que esta marca mede. `radinhoPerf()` imprime a linha do
// tempo inteira — sem ela, "está lento no boot" não aponta para lugar nenhum.
marcarBoot('bundle');
instalarBootPerf();

// Register the service worker + auto-updater as early as possible.
initPwaUpdater();

// `aurialDiagnostico()` no console diz, elo a elo, por que uma faixa não toca.
// "Indisponível" é o mesmo sintoma para quatro falhas diferentes; sem isto, a
// correção vira palpite — e já virou três vezes.
instalarDiagnostico();

// `radinhoSync()` no console diz por que ESTE aparelho está desatualizado:
// quem está logado, se o snapshot chegou, quantos documentos a nuvem tem e qual
// erro foi engolido no caminho. Mesmo motivo do de cima — "não atualiza" é um
// sintoma com seis causas, e todas elas eram silenciosas.
instalarSyncDiagnostico();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
