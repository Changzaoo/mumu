/**
 * TEMPO DAS PALAVRAS DE CADA FAIXA DO COFRE — o relógio que as letras usam.
 *
 * Medido em 2026-09-26 contra o áudio real: a letra publicada de "Bad and
 * Boujee" estava 520 a 1.200 ms adiantada (e a diferença CRESCIA ao longo da
 * música — é a letra que "acaba antes da música"), e "DE VOLTA" só tinha letra
 * sem tempo. O player segue a letra ao milissegundo; o erro está no DADO. A
 * saída é tirar o relógio do próprio áudio: o instante em que cada palavra é
 * cantada. O app reancora a letra publicada nesses instantes.
 *
 * Dois motores:
 *   - inglês → Riva parakeet-tdt na nuvem (~5 s, tempo por palavra);
 *   - o resto → faster-whisper `base` NESTA máquina (~50 s por música de 4 min
 *     num i5-4590). Nenhum serviço na nuvem que usamos dá tempo por palavra em
 *     português. O `small` acerta mais texto (66% contra 43% das palavras da
 *     letra), mas leva 4x mais; para ANCORAR uma letra cujo texto já sabemos,
 *     43% bate de sobra o limiar do alinhador (35%).
 *
 * Uma faixa por vez, com prioridade baixa de CPU: quem está ouvindo música não
 * pode sentir isto. O resultado fica em disco e nunca é refeito.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');
const MODELO = process.env.WHISPER_MODELO || 'base';
const TETO_MS = Number(process.env.TEMPO_TETO_MS ?? 15 * 60_000);
/** Fila curta: o que interessa é a faixa tocando agora, não um acúmulo. */
const FILA_MAX = 20;

/**
 * @param {{
 *   dir: string,
 *   log: (...a: unknown[]) => void,
 *   rivaPalavras?: (arquivo: string) => Promise<Array<{text: string, startMs: number}> | null>,
 * }} opcoes
 */
export function criarTempoDasPalavras({ dir, log, rivaPalavras }) {
  /** id → { arquivo, idioma } esperando vez. Map preserva ordem de chegada. */
  const fila = new Map();
  /** id em processamento agora. */
  let atual = null;
  /** Falhas recentes: não refaz em laço uma faixa que o motor não consegue. */
  const falhou = new Map();

  const caminho = (id, idioma) =>
    path.join(dir, `${encodeURIComponent(id)}.${idioma === 'en' ? 'en' : 'xx'}.json`);

  async function lerPronto(id, idioma) {
    try {
      return JSON.parse(await readFile(caminho(id, idioma), 'utf8'));
    } catch {
      return null;
    }
  }

  function whisper(arquivo, idioma) {
    return new Promise((resolve, reject) => {
      const saida = path.join(os.tmpdir(), `tempo-${process.pid}-${Date.now()}.json`);
      const proc = spawn(
        PYTHON,
        [path.join(HERE, 'palavras.py'), arquivo, saida, idioma === 'auto' ? '' : idioma, MODELO],
        { windowsHide: true },
      );
      // Abaixo do normal: o /stream e o /blob não podem esperar pela CPU daqui.
      try {
        os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        /* sem permissão: segue na prioridade normal */
      }
      let erro = '';
      proc.stderr.on('data', (c) => {
        erro = (erro + c).slice(-2000);
      });
      const teto = setTimeout(() => proc.kill(), TETO_MS);
      proc.on('error', reject);
      proc.on('close', async (codigo) => {
        clearTimeout(teto);
        try {
          if (codigo !== 0) throw new Error(`whisper saiu com ${codigo}: ${erro.slice(-300)}`);
          const r = JSON.parse(await readFile(saida, 'utf8'));
          resolve(r);
        } catch (e) {
          reject(e);
        } finally {
          await rm(saida, { force: true }).catch(() => undefined);
        }
      });
    });
  }

  async function processar(id, { arquivo, idioma }) {
    const inicio = Date.now();
    let words = null;
    let motor = 'whisper';
    if (idioma === 'en' && rivaPalavras) {
      words = await rivaPalavras(arquivo).catch(() => null);
      if (words && words.length > 0) motor = 'riva';
      else words = null;
    }
    let lingua = idioma;
    if (!words) {
      const r = await whisper(arquivo, idioma === 'en' ? 'en' : idioma === 'auto' ? 'auto' : 'pt');
      words = r.words;
      lingua = r.language ?? idioma;
    }
    await mkdir(dir, { recursive: true });
    const destino = caminho(id, idioma);
    const parcial = `${destino}.parcial`;
    await writeFile(
      parcial,
      JSON.stringify({ words, motor, language: lingua, em: new Date().toISOString() }),
    );
    await rename(parcial, destino);
    log(
      `tempo das palavras: ${id} (${motor}, ${words.length} palavras, ${Math.round((Date.now() - inicio) / 1000)}s)`,
    );
  }

  async function drenar() {
    if (atual) return;
    while (fila.size > 0) {
      // A MAIS RECENTE primeiro: é a que alguém está ouvindo agora.
      const [id, pedido] = [...fila.entries()].at(-1);
      fila.delete(id);
      atual = id;
      try {
        await processar(id, pedido);
      } catch (e) {
        falhou.set(`${id}|${pedido.idioma}`, Date.now());
        log('tempo das palavras falhou:', id, e instanceof Error ? e.message : e);
      } finally {
        atual = null;
      }
    }
  }

  /**
   * Devolve o tempo pronto, ou enfileira e diz em que pé está.
   * @returns {Promise<{ pronto: object } | { status: 'processando' | 'na-fila' | 'falhou', posicao?: number }>}
   */
  async function pedir(id, arquivo, idioma) {
    const pronto = await lerPronto(id, idioma);
    if (pronto) return { pronto };
    const chaveFalha = `${id}|${idioma}`;
    const quando = falhou.get(chaveFalha);
    if (quando && Date.now() - quando < 6 * 3600_000) return { status: 'falhou' };
    if (atual === id) return { status: 'processando' };
    // Pedir de novo PROMOVE: vai para o fim do Map, que é quem sai primeiro.
    fila.delete(id);
    fila.set(id, { arquivo, idioma });
    while (fila.size > FILA_MAX) fila.delete(fila.keys().next().value);
    void drenar();
    return { status: atual === id ? 'processando' : 'na-fila', posicao: fila.size };
  }

  return { pedir };
}
