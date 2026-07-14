/**
 * AGENTE DE CATEGORIAS — fica DE PLANTÃO organizando a biblioteca por gênero.
 * Toda faixa sem gênero entra na fila dele; a classificação usa a IA do
 * importer (aiClassifyGenre, taxonomia FIXA do app — nunca inventa categoria
 * fora da lista) e é aplicada com patch mínimo (setTrackGenre). O resultado
 * alimenta a página Descobrir, as prateleiras por gênero da Home e os mixes.
 *
 * Regras de plantão:
 *  - roda em segundo plano, UMA faixa por vez com pausa (nada trava);
 *  - até 20 classificações por sessão (gentil com a IA), 3 tentativas por
 *    faixa no total (persistido) — faixa impossível não vira loop;
 *  - re-acorda sozinho quando a biblioteca muda (importou músicas novas →
 *    elas ganham categoria em minutos);
 *  - offline ou deslogado: dorme e tenta na próxima oportunidade.
 */
import { aiClassifyGenre } from '@/lib/ai/ai';
import * as localLibrary from '@/lib/local/localLibrary';

const ATTEMPTS_KEY = 'aurial:genreAgentAttempts';
const MAX_ATTEMPTS = 3;
const SESSION_BUDGET = 20;
const PACE_MS = 1_800;
const BOOT_DELAY_MS = 25_000;
const WAKE_DEBOUNCE_MS = 10_000;

let initialized = false;
let running = false;
let classifiedThisSession = 0;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readAttempts(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ATTEMPTS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeAttempts(attempts: Record<string, number>): void {
  try {
    window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
  } catch {
    /* quota */
  }
}

/** Faixas ainda sem categoria (elegíveis ou não para nova tentativa). */
export function pendingCount(): number {
  return localLibrary.list().filter((e) => !e.track.genre?.trim()).length;
}

export function isRunning(): boolean {
  return running;
}

async function run(): Promise<void> {
  if (running || typeof navigator === 'undefined' || !navigator.onLine) return;
  running = true;
  emit();
  try {
    const attempts = readAttempts();
    for (const entry of localLibrary.list()) {
      if (classifiedThisSession >= SESSION_BUDGET) break;
      const t = entry.track;
      if (t.genre?.trim()) continue;
      if ((attempts[t.id] ?? 0) >= MAX_ATTEMPTS) continue;
      const artist = t.artists[0]?.name;
      const genre = await aiClassifyGenre(
        t.title,
        artist && artist !== 'Desconhecido' ? artist : undefined,
      ).catch(() => null);
      classifiedThisSession += 1;
      if (genre) {
        localLibrary.setTrackGenre(t.id, genre);
        delete attempts[t.id];
      } else {
        attempts[t.id] = (attempts[t.id] ?? 0) + 1;
      }
      writeAttempts(attempts);
      emit();
      await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    }
  } finally {
    running = false;
    emit();
  }
}

/** Acorda o agente (debounced) — chamado quando a biblioteca muda. */
function wake(): void {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => void run(), WAKE_DEBOUNCE_MS);
}

/** Liga o plantão uma única vez (App). */
export function initGenreAgent(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  setTimeout(() => void run(), BOOT_DELAY_MS);
  localLibrary.subscribe(wake);
  window.addEventListener('online', () => void run());
}
