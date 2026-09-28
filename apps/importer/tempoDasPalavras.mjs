/**
 * O RELÓGIO DAS LETRAS — quando cada verso e cada palavra são cantados, tirado
 * do próprio áudio do cofre.
 *
 * O player segue a letra ao milissegundo; o erro está no DADO. A letra
 * publicada muitas vezes foi cronometrada para outra gravação: "Bad and Boujee"
 * vinha 520 a 1.200 ms adiantada com deriva; "Mantém" (Matuê) começava ~11,6 s
 * antes da voz (a versão do YouTube tem introdução mais longa); "DE VOLTA" nem
 * tinha tempo. Dois trabalhos, uma fila:
 *
 *  - ALINHAR (o principal): o texto da letra publicada é conhecido; o modelo só
 *    diz QUANDO cada linha é cantada. Nunca inventa palavra, e sotaque/autotune
 *    atrapalham pouco, porque não é preciso reconhecer o que foi dito — só achar
 *    onde. Whisper `small` via stable-ts, ~45–80 s por música.
 *
 *  - TRANSCREVER (último recurso, quando não existe letra publicada): inglês
 *    vai ao Riva na nuvem (~5 s); o resto, ao faster-whisper `small` local. Cada
 *    palavra sai com a confiança do modelo, para o app descartar o que ele não
 *    ouviu direito em vez de mostrar letra inventada. O `base` que usávamos
 *    devolveu lixo para trap com autotune ("proprietary Passe Passe…").
 *
 * Uma tarefa por vez, prioridade baixa de CPU (quem está ouvindo não pode
 * sentir isto). Dentro da fila: ALINHAMENTO antes de TRANSCRIÇÃO (é o caminho
 * comum e o mais rápido de entregar — ver `proximaChave`), e dentro de cada
 * tipo a pedida mais recentemente primeiro. Pedido que ninguém renova por
 * `ABANDONO_MS` é descartado sem processar (`pedidoAbandonado`) — a pessoa já
 * pulou a faixa. Resultado em disco, nunca refeito.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');
const MODELO = process.env.WHISPER_MODELO || 'small';
const TETO_MS = Number(process.env.TEMPO_TETO_MS ?? 15 * 60_000);
/** Fila curta: o que interessa é a faixa tocando agora, não um acúmulo. */
const FILA_MAX = 20;
/** Versão do formato em disco — mudou o modelo/saída, muda a chave. */
const VERSAO = 'v2';
/**
 * NINGUÉM PERGUNTOU POR ISTO EM 3 MINUTOS = a pessoa pulou a faixa ou fechou
 * o app. O cliente reancora (`pedirPorChave`) a cada poll enquanto ainda
 * quer a resposta — ver `manterVivo` em calibragem.ts, que já para de
 * perguntar sozinho quando a faixa deixa de ser a atual/próxima; aqui é o
 * espelho do lado do servidor: uma CPU só, então processar um pedido morto é
 * roubar tempo de quem ainda está esperando.
 */
const ABANDONO_MS = 3 * 60_000;

/**
 * Qual chave já não vale mais a pena processar — pura, para testar sem
 * subir o servidor inteiro.
 */
export function pedidoAbandonado(pedidoEm, agora, abandonoMs = ABANDONO_MS) {
  return agora - pedidoEm > abandonoMs;
}

/**
 * Qual das entradas vivas processar a seguir.
 *
 * ALINHAMENTO FURA A TRANSCRIÇÃO: quem já tem letra publicada só espera o
 * RELÓGIO (a etapa mais comum, e a mais rápida de entregar — ~45–80s);
 * transcrever do zero (sem letra nenhuma) é o caminho raro. Sem esta
 * prioridade, baixar uma playlist inteira sem letra conhecida enfileirava
 * várias transcrições e a faixa que a pessoa está OUVINDO agora — que só
 * precisa de alinhamento — esperava atrás delas.
 *
 * Dentro de cada tipo, a MAIS RECENTE (quem pediu por último — `pedirPorChave`
 * promove ao reancorar): é a que alguém está de fato esperando agora.
 *
 * `entradas` é `[chave, { tarefa, pedidoEm }][]` na ordem de chegada do Map
 * (mais recente por último). Pura.
 */
export function proximaChave(entradas) {
  for (let i = entradas.length - 1; i >= 0; i -= 1) {
    if (entradas[i][1].tarefa.tipo === 'alinhar') return entradas[i][0];
  }
  return entradas.length > 0 ? entradas[entradas.length - 1][0] : null;
}

/**
 * @param {{
 *   dir: string,
 *   log: (...a: unknown[]) => void,
 *   rivaPalavras?: (arquivo: string) => Promise<Array<{text: string, startMs: number}> | null>,
 * }} opcoes
 */
export function criarTempoDasPalavras({ dir, log, rivaPalavras }) {
  /** chave → tarefa esperando vez. Map preserva ordem de chegada. */
  const fila = new Map();
  /** chave em processamento agora. */
  let atual = null;
  /** Onde o trabalho em curso grava a saída (o `.parcial` ao lado é o ao vivo). */
  let saidaAtual = null;
  /** Falhas recentes: não refaz em laço uma faixa que o motor não consegue. */
  const falhou = new Map();

  const arquivoDe = (chave) => path.join(dir, `${encodeURIComponent(chave)}.json`);

  async function lerPronto(chave) {
    try {
      return JSON.parse(await readFile(arquivoDe(chave), 'utf8'));
    } catch {
      return null;
    }
  }

  function python(args) {
    return new Promise((resolve, reject) => {
      const saida = path.join(os.tmpdir(), `tempo-${process.pid}-${Date.now()}.json`);
      saidaAtual = saida;
      const proc = spawn(
        PYTHON,
        [path.join(HERE, 'palavras.py'), args[0], args[1], saida, ...args.slice(2)],
        {
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        },
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
          if (codigo !== 0) throw new Error(`palavras.py saiu com ${codigo}: ${erro.slice(-300)}`);
          resolve(JSON.parse(await readFile(saida, 'utf8')));
        } catch (e) {
          reject(e);
        } finally {
          await rm(saida, { force: true }).catch(() => undefined);
          await rm(`${saida}.parcial`, { force: true }).catch(() => undefined);
          if (saidaAtual === saida) saidaAtual = null;
        }
      });
    });
  }

  async function transcrever({ arquivo, idioma }) {
    if (idioma === 'en' && rivaPalavras) {
      const words = await rivaPalavras(arquivo).catch(() => null);
      if (words && words.length > 0) return { words, motor: 'riva', language: 'en' };
    }
    const lingua = idioma === 'en' ? 'en' : idioma === 'auto' ? '' : 'pt';
    const r = await python(['transcrever', arquivo, lingua, MODELO]);
    return { words: r.words, motor: `whisper-${MODELO}`, language: r.language ?? idioma };
  }

  async function alinhar({ arquivo, idioma, linhas }) {
    const texto = path.join(os.tmpdir(), `letra-${process.pid}-${Date.now()}.txt`);
    await writeFile(texto, linhas.join('\n'), 'utf8');
    try {
      const r = await python(['alinhar', arquivo, idioma === 'en' ? 'en' : 'pt', MODELO, texto]);
      return { linhas: r.linhas, esperadas: r.esperadas, motor: `alinhamento-${MODELO}` };
    } finally {
      await rm(texto, { force: true }).catch(() => undefined);
    }
  }

  async function processar(chave, tarefa) {
    const inicio = Date.now();
    const r = tarefa.tipo === 'alinhar' ? await alinhar(tarefa) : await transcrever(tarefa);
    await mkdir(dir, { recursive: true });
    const destino = arquivoDe(chave);
    const parcial = `${destino}.parcial`;
    await writeFile(parcial, JSON.stringify({ ...r, em: new Date().toISOString() }));
    await rename(parcial, destino);
    const quanto = r.linhas ? `${r.linhas.length} linhas` : `${r.words?.length ?? 0} palavras`;
    log(
      `${tarefa.tipo}: ${tarefa.id} (${r.motor}, ${quanto}, ${Math.round((Date.now() - inicio) / 1000)}s)`,
    );
  }

  async function drenar() {
    if (atual) return;
    while (fila.size > 0) {
      // PODA ANTES DE ESCOLHER: pedido que ninguém renovou há muito tempo não
      // concorre por CPU — nem por prioridade, nem por ordem de chegada.
      const agora = Date.now();
      for (const [chave, entrada] of fila) {
        if (pedidoAbandonado(entrada.pedidoEm, agora)) fila.delete(chave);
      }
      const chave = proximaChave([...fila.entries()]);
      if (chave === null) break; // só sobrava abandonado
      const { tarefa } = fila.get(chave);
      fila.delete(chave);
      atual = chave;
      try {
        await processar(chave, tarefa);
      } catch (e) {
        falhou.set(chave, Date.now());
        log(`${tarefa.tipo} falhou:`, tarefa.id, e instanceof Error ? e.message : e);
      } finally {
        atual = null;
      }
    }
  }

  /**
   * Devolve o pronto, ou enfileira e diz em que pé está.
   * @returns {Promise<{ pronto: object } | { status: 'processando' | 'na-fila' | 'falhou', posicao?: number }>}
   */
  async function pedirPorChave(chave, tarefa) {
    const pronto = await lerPronto(chave);
    if (pronto) return { pronto };
    const quando = falhou.get(chave);
    if (quando && Date.now() - quando < 6 * 3600_000) return { status: 'falhou' };
    if (atual === chave) {
      // AO VIVO: o que a transcrição já ouviu até aqui (ver palavras.py).
      const parcial = saidaAtual
        ? await readFile(`${saidaAtual}.parcial`, 'utf8')
            .then((t) => JSON.parse(t))
            .catch(() => null)
        : null;
      return { status: 'processando', ...(parcial ? { parcial } : {}) };
    }
    // Pedir de novo PROMOVE: vai para o fim do Map (mais recente) e renova
    // `pedidoEm`, o que também a salva de ser podada como abandonada.
    fila.delete(chave);
    fila.set(chave, { tarefa, pedidoEm: Date.now() });
    while (fila.size > FILA_MAX) fila.delete(fila.keys().next().value);
    void drenar();
    return { status: atual === chave ? 'processando' : 'na-fila', posicao: fila.size };
  }

  /** Transcrição (sem letra publicada): palavras com tempo e confiança. */
  function pedir(id, arquivo, idioma) {
    const chave = `${id}.${idioma === 'en' ? 'en' : 'xx'}.${VERSAO}`;
    return pedirPorChave(chave, { tipo: 'transcrever', id, arquivo, idioma });
  }

  /** Alinhamento de uma letra conhecida: tempo de cada linha e palavra. */
  function pedirAlinhamento(id, arquivo, idioma, linhas) {
    const hash = createHash('sha1').update(linhas.join('\n')).digest('hex').slice(0, 12);
    const chave = `${id}.al-${hash}.${VERSAO}`;
    return pedirPorChave(chave, { tipo: 'alinhar', id, arquivo, idioma, linhas });
  }

  return { pedir, pedirAlinhamento };
}
