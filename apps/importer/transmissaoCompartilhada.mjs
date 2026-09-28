/**
 * TRANSMISSÃO COMPARTILHADA — um transcode, N ouvintes.
 *
 * O `/stream` abria um yt-dlp + ffmpeg POR OUVINTE. Numa máquina de 2 núcleos,
 * três pessoas ouvindo a mesma faixa eram três downloads da origem e três
 * encodes brigando por CPU — e o áudio de todo mundo engasgava junto. É o
 * mesmo problema que uma CDN resolve com "request collapsing": o primeiro
 * pedido de uma chave vira a ÚNICA ida à origem, e quem chega depois se
 * pendura nele.
 *
 * Aqui a chave é `url|kbps`. Quem chega com a transmissão em curso recebe o
 * que já saiu (replay do buffer) e segue ao vivo com os outros. Terminada com
 * sucesso, a faixa fica um tempo na memória (LRU com teto em bytes): a faixa
 * quente do momento sai da RAM, sem processo nenhum, com Content-Length.
 *
 * O produtor só é cancelado quando o ÚLTIMO ouvinte sai (com uma folga curta,
 * para quem pula e volta não matar o encode à toa).
 */

const HEADERS_AO_VIVO = {
  'Content-Type': 'audio/mpeg',
  'Cache-Control': 'no-store',
  'Accept-Ranges': 'none',
};

export class Transmissao {
  constructor({ tetoBytes, gracaMs, aoSoltar }) {
    this.tetoBytes = tetoBytes;
    this.gracaMs = gracaMs;
    this.aoSoltar = aoSoltar;
    this.pedacos = [];
    this.bytes = 0;
    /** false quando passou do teto: quem chegar depois não tem como alcançar. */
    this.replayavel = true;
    /** 'produzindo' | 'ok' | 'falhou' */
    this.estado = 'produzindo';
    this.cancelada = false;
    this.ouvintes = new Set();
    this.esperando = new Set();
    this.cancelamentos = [];
    this.timerGraca = null;
  }

  /** O produtor registra aqui como matar seus processos. */
  aoCancelar(fn) {
    if (this.cancelada) fn();
    else this.cancelamentos.push(fn);
  }

  escrever(chunk) {
    if (this.estado !== 'produzindo' || this.cancelada) return;
    if (this.replayavel) {
      this.pedacos.push(chunk);
      if (this.bytes + chunk.length > this.tetoBytes) {
        this.replayavel = false;
        this.pedacos = [];
        this.aoSoltar?.(this); // sai do mapa: ninguém novo entra numa que não alcança
      }
    }
    this.bytes += chunk.length;
    for (const res of this.ouvintes) res.write(chunk);
    if (this.esperando.size) for (const acordar of [...this.esperando]) acordar();
  }

  terminar(ok) {
    if (this.estado !== 'produzindo') return;
    this.estado = ok && this.bytes > 0 ? 'ok' : 'falhou';
    this.limparGraca();
    for (const res of this.ouvintes) if (!res.writableEnded) res.end();
    this.ouvintes.clear();
    for (const acordar of [...this.esperando]) acordar();
  }

  cancelar() {
    if (this.cancelada) return;
    this.cancelada = true;
    for (const fn of this.cancelamentos.splice(0)) {
      try {
        fn();
      } catch {
        /* processo já morto */
      }
    }
  }

  limparGraca() {
    if (this.timerGraca) clearTimeout(this.timerGraca);
    this.timerGraca = null;
  }

  talvezCancelar() {
    if (this.estado !== 'produzindo' || this.ouvintes.size || this.esperando.size) return;
    this.limparGraca();
    this.timerGraca = setTimeout(() => {
      this.timerGraca = null;
      if (this.estado === 'produzindo' && !this.ouvintes.size && !this.esperando.size) {
        this.cancelar();
        this.terminar(false);
        this.aoSoltar?.(this);
      }
    }, this.gracaMs);
    this.timerGraca.unref?.();
  }

  /**
   * Entrega a transmissão a um ouvinte. Os cabeçalhos só saem com o primeiro
   * byte de áudio na mão (mesma regra de antes): se a origem morrer sem
   * produzir nada, o ouvinte recebe 502 em vez de um 200 mudo.
   * Resolve quando a resposta termina.
   */
  servir(req, res) {
    return new Promise((resolve) => {
      let foi = false;
      const sair = () => {
        if (foi) return;
        foi = true;
        this.esperando.delete(tentar);
        this.ouvintes.delete(res);
        this.talvezCancelar();
        resolve();
      };
      const tentar = () => {
        if (foi) return;
        if (res.destroyed || req.destroyed) return sair();
        if (this.bytes === 0 && this.estado === 'produzindo') return; // segue esperando
        this.esperando.delete(tentar);
        if (this.bytes === 0 || (this.estado !== 'produzindo' && !this.replayavel)) {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
          }
          res.end();
          return sair();
        }
        const completo = this.estado === 'ok' && this.replayavel;
        res.writeHead(
          200,
          completo ? { ...HEADERS_AO_VIVO, 'Content-Length': String(this.bytes) } : HEADERS_AO_VIVO,
        );
        if (req.method === 'HEAD') {
          res.end();
          return sair();
        }
        for (const p of this.pedacos) res.write(p);
        if (this.estado === 'produzindo') {
          this.ouvintes.add(res);
          this.limparGraca();
        } else {
          res.end();
        }
      };
      req.on('close', sair);
      res.on('close', sair);
      res.on('finish', sair);
      this.esperando.add(tentar);
      this.limparGraca();
      tentar();
    });
  }
}

/**
 * A central: mapa de transmissões em curso + LRU das terminadas.
 *
 * @param {object} o
 * @param {number} [o.tetoPorFaixaBytes] acima disso a faixa não é guardada para replay
 * @param {number} [o.tetoCacheBytes]    memória total das faixas terminadas
 * @param {number} [o.ttlMs]             quanto uma faixa terminada vale no cache
 * @param {number} [o.gracaMs]           espera antes de matar um encode sem ouvintes
 */
export function criarCentralDeTransmissoes({
  tetoPorFaixaBytes = 48 * 1024 * 1024,
  tetoCacheBytes = 256 * 1024 * 1024,
  ttlMs = 30 * 60 * 1000,
  gracaMs = 5000,
  agora = () => Date.now(),
} = {}) {
  /** @type {Map<string, Transmissao>} */
  const emCurso = new Map();
  /** @type {Map<string, { t: Transmissao, em: number }>} ordem de inserção = LRU */
  const prontas = new Map();
  let bytesProntos = 0;
  const stats = { coalescidos: 0, doCache: 0, iniciados: 0 };

  const tirarPronta = (chave) => {
    const e = prontas.get(chave);
    if (!e) return;
    prontas.delete(chave);
    bytesProntos -= e.t.bytes;
  };

  const guardarPronta = (chave, t) => {
    if (t.estado !== 'ok' || !t.replayavel || t.bytes > tetoCacheBytes) return;
    tirarPronta(chave);
    prontas.set(chave, { t, em: agora() });
    bytesProntos += t.bytes;
    for (const [k] of prontas) {
      if (bytesProntos <= tetoCacheBytes) break;
      tirarPronta(k);
    }
  };

  return {
    /**
     * Devolve a transmissão da chave — a pronta do cache, a em curso, ou uma
     * nova, que chama `produzir(t)` (sem await: o produtor roda sozinho e
     * termina com `t.terminar(ok)`).
     */
    obter(chave, produzir) {
      const pronta = prontas.get(chave);
      if (pronta) {
        if (agora() - pronta.em <= ttlMs) {
          prontas.delete(chave); // reinsere no fim: LRU
          prontas.set(chave, pronta);
          stats.doCache++;
          return pronta.t;
        }
        tirarPronta(chave);
      }
      const viva = emCurso.get(chave);
      if (viva && viva.estado === 'produzindo' && !viva.cancelada) {
        stats.coalescidos++;
        return viva;
      }
      const t = new Transmissao({
        tetoBytes: tetoPorFaixaBytes,
        gracaMs,
        aoSoltar: (x) => {
          if (emCurso.get(chave) === x) emCurso.delete(chave);
        },
      });
      emCurso.set(chave, t);
      stats.iniciados++;
      Promise.resolve()
        .then(() => produzir(t))
        .catch(() => undefined)
        .finally(() => {
          t.terminar(false); // no-op se o produtor já terminou
          if (emCurso.get(chave) === t) emCurso.delete(chave);
          guardarPronta(chave, t);
        });
      return t;
    },

    esquecer(chave) {
      tirarPronta(chave);
    },

    estatisticas() {
      return {
        ...stats,
        emCurso: emCurso.size,
        ouvintesAoVivo: [...emCurso.values()].reduce((n, t) => n + t.ouvintes.size, 0),
        prontas: prontas.size,
        bytesProntos,
      };
    },
  };
}
