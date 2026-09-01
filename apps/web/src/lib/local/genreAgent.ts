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
import { gravarCache, registrarDescartavel } from '@/lib/local/cofreLocal';
import {
  aceitarSugestao,
  generoDoArtista,
  herdarDoArtista,
  revisarGeneros,
  type FaixaMinima,
} from '@radinho/shared';

const ATTEMPTS_KEY = 'aurial:genreAgentAttempts';
const REVISAO_KEY = 'aurial:genreRevisao';
/** Suba isto para reexaminar TODA a biblioteca com as regras de gênero novas. */
const REVISAO_VERSAO = 1;
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
  gravarCache(ATTEMPTS_KEY, JSON.stringify(attempts), 200_000); // ver lib/local/cofreLocal.ts
}

registrarDescartavel(ATTEMPTS_KEY, 10, () => undefined);

/** Faixas ainda sem categoria (elegíveis ou não para nova tentativa). */
export function pendingCount(): number {
  return localLibrary.list().filter((e) => !e.track.genre?.trim()).length;
}

export function isRunning(): boolean {
  return running;
}

/** A biblioteca na forma mínima que as decisões de gênero precisam. */
function faixasMinimas(): FaixaMinima[] {
  return localLibrary.list().map((e) => ({
    id: e.track.id,
    genre: e.track.genre ?? null,
    artistas: e.track.artists.map((a) => a.name),
  }));
}

/**
 * REVISÃO ÚNICA DO QUE JÁ ESTÁ GRAVADO.
 *
 * As regras novas só valem para o que vier daqui em diante — e a biblioteca já
 * está cheia de categoria errada posta pelo sistema antigo. Como o agente só
 * enxerga faixa SEM gênero, nada disso seria reexaminado um dia sequer: a
 * prateleira "Brasileira" ficaria lá para sempre, e o trap continuaria no meio
 * do sertanejo.
 *
 * Sai caro uma vez e nunca mais: fica gravada a versão da revisão. O ritmo é
 * proposital — cada mudança vira uma escrita na nuvem e no acervo, e uma rajada
 * de trezentas já derrubou a cota do projeto inteiro uma vez.
 */
async function revisarGravados(): Promise<void> {
  try {
    if (window.localStorage.getItem(REVISAO_KEY) === String(REVISAO_VERSAO)) return;
  } catch {
    return;
  }
  const mudancas = revisarGeneros(faixasMinimas());
  for (const mudanca of mudancas) {
    localLibrary.setTrackGenre(mudanca.id, mudanca.para);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  try {
    window.localStorage.setItem(REVISAO_KEY, String(REVISAO_VERSAO));
  } catch {
    /* cota: tenta de novo no próximo boot — a revisão é idempotente */
  }
  emit();
}

async function run(): Promise<void> {
  if (running || typeof navigator === 'undefined' || !navigator.onLine) return;
  running = true;
  emit();
  try {
    await revisarGravados();
    const attempts = readAttempts();
    for (const entry of localLibrary.list()) {
      if (classifiedThisSession >= SESSION_BUDGET) break;
      const t = entry.track;
      if (t.genre?.trim()) continue;
      if ((attempts[t.id] ?? 0) >= MAX_ATTEMPTS) continue;
      // SEM ARTISTA NÃO SE CLASSIFICA.
      //
      // Antes, faixa com artista "Desconhecido" era mandada ao modelo com o
      // TÍTULO SOZINHO. Isso não é classificar, é adivinhar pelo clima da
      // palavra — "WARZONE" vira Trap ou Metal conforme o humor do modelo — e o
      // palpite entra no app como fato: prateleira de gênero, mix, recomendação.
      // Faixa sem categoria é um buraco que a curadoria preenche depois; faixa
      // na categoria errada é uma mentira que ninguém revisa.
      const artist = t.artists[0]?.name;
      if (!artist || artist === 'Desconhecido') continue;

      // O ARTISTA VOTA ANTES DO MODELO.
      //
      // Se as outras faixas dele já dizem, de forma firme, qual é o gênero, a
      // faixa nova nasce com ele — de graça, e sem o sorteio independente que
      // punha uma faixa de trap sozinha na prateleira de sertanejo. Ver
      // generoCoerencia.ts.
      const voto = generoDoArtista(faixasMinimas(), artist, t.id);
      const herdado = herdarDoArtista(voto);
      if (herdado) {
        localLibrary.setTrackGenre(t.id, herdado);
        delete attempts[t.id];
        writeAttempts(attempts);
        emit();
        continue; // não gastou consulta nenhuma
      }

      const resposta = await aiClassifyGenre(t.title, artist).catch(() => null);
      classifiedThisSession += 1;
      // A resposta ainda passa pelo crivo do artista: se contradiz uma maioria
      // FORTE, é recusada e a faixa fica sem categoria (buraco visível vale mais
      // que categoria errada).
      const genre = aceitarSugestao(resposta, voto);
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
