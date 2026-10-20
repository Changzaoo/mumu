/**
 * A MEMÓRIA DO MOTOR — exemplos rotulados que votam (ver motor.mjs).
 *
 * Por pergunta (ex.: "genero"), guarda pares { estado, rotulo } com o vetor do
 * estado já calculado. Em disco: um JSONL por pergunta em `dir` (uma linha por
 * exemplo, só texto) e um arquivo binário de vetores ao lado — o JSONL é a
 * fonte da verdade, o binário é cache (apagou, recalcula do JSONL).
 *
 * Nasce dos ~10 mil gêneros já curados do acervo (ver semear.mjs) e cresce com
 * cada rótulo que a curadoria confirma depois (`aprender`). Um exemplo por
 * estado: regravar o mesmo texto com outro rótulo SUBSTITUI (a curadoria
 * corrigiu), não acumula.
 *
 * kNN linear em memória: 10 mil vetores de 384 posições são 15 MB e uma
 * varredura leva ~5 ms. Índice aproximado só vale a partir de centenas de
 * milhares — não é o caso.
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cosseno } from './motor.mjs';

const chaveDe = (texto) =>
  createHash('sha1').update(texto.normalize('NFC').trim().toLowerCase()).digest('hex').slice(0, 16);

/**
 * @param {{ dir: string, embed: (textos: string[]) => Promise<number[][]>, log?: Function }} o
 */
export function criarMemoria({ dir, embed, log = () => {} }) {
  /** pergunta → { porChave: Map<chave, {estado, rotulo, vetor: Float32Array|null}>, carregada } */
  const perguntas = new Map();
  const nomeSeguro = (p) =>
    String(p)
      .replace(/[^a-z0-9_-]/gi, '_')
      .slice(0, 60);
  const jsonlDe = (p) => path.join(dir, `${nomeSeguro(p)}.jsonl`);
  const vetoresDe = (p) => path.join(dir, `${nomeSeguro(p)}.vetores.bin`);

  async function carregar(pergunta) {
    const existente = perguntas.get(pergunta);
    if (existente) return existente;
    const porChave = new Map();
    try {
      for (const linha of (await readFile(jsonlDe(pergunta), 'utf8')).split('\n')) {
        if (!linha.trim()) continue;
        try {
          const ex = JSON.parse(linha);
          if (typeof ex.estado === 'string' && typeof ex.rotulo === 'string') {
            porChave.set(chaveDe(ex.estado), { estado: ex.estado, rotulo: ex.rotulo, vetor: null });
          }
        } catch {
          /* linha quebrada: ignora */
        }
      }
    } catch {
      /* ainda não existe: memória vazia */
    }
    // Cache de vetores: [n][dims] Float32 precedido de um cabeçalho JSON com a
    // ordem das chaves. Chave que não bate (JSONL mudou) recalcula.
    try {
      const bruto = await readFile(vetoresDe(pergunta));
      const tamCab = bruto.readUInt32LE(0);
      const cab = JSON.parse(bruto.subarray(4, 4 + tamCab).toString('utf8'));
      const dims = cab.dims;
      const dados = bruto.subarray(4 + tamCab);
      cab.chaves.forEach((chave, i) => {
        const ex = porChave.get(chave);
        if (!ex) return;
        const inicio = i * dims * 4;
        ex.vetor = new Float32Array(
          dados.buffer.slice(dados.byteOffset + inicio, dados.byteOffset + inicio + dims * 4),
        );
      });
    } catch {
      /* sem cache */
    }
    const estado = { porChave, dims: 0 };
    perguntas.set(pergunta, estado);
    await vetorizarFaltantes(pergunta, estado);
    return estado;
  }

  async function vetorizarFaltantes(pergunta, estado) {
    const faltam = [...estado.porChave.values()].filter((ex) => !ex.vetor);
    if (faltam.length === 0) return;
    log(`memoria ${pergunta}: vetorizando ${faltam.length} exemplos`);
    const LOTE = 64;
    for (let i = 0; i < faltam.length; i += LOTE) {
      const fatia = faltam.slice(i, i + LOTE);
      const vs = await embed(fatia.map((ex) => ex.estado));
      fatia.forEach((ex, k) => {
        ex.vetor = Float32Array.from(vs[k]);
      });
    }
    await gravarVetores(pergunta, estado);
  }

  async function gravarVetores(pergunta, estado) {
    const exemplos = [...estado.porChave.entries()].filter(([, ex]) => ex.vetor);
    if (exemplos.length === 0) return;
    const dims = exemplos[0][1].vetor.length;
    estado.dims = dims;
    const cab = Buffer.from(JSON.stringify({ dims, chaves: exemplos.map(([c]) => c) }), 'utf8');
    const dados = Buffer.alloc(exemplos.length * dims * 4);
    exemplos.forEach(([, ex], i) => {
      Buffer.from(ex.vetor.buffer, ex.vetor.byteOffset, dims * 4).copy(dados, i * dims * 4);
    });
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32LE(cab.length, 0);
    await mkdir(dir, { recursive: true });
    const tmp = `${vetoresDe(pergunta)}.tmp`;
    await writeFile(tmp, Buffer.concat([tamanho, cab, dados]));
    await rename(tmp, vetoresDe(pergunta));
  }

  /** Os k exemplos mais parecidos com o vetor, como [{ rotulo, semelhanca, estado }]. */
  async function vizinhos(pergunta, vetor, k) {
    const { porChave } = await carregar(pergunta);
    const melhores = [];
    for (const ex of porChave.values()) {
      if (!ex.vetor) continue;
      const s = cosseno(vetor, ex.vetor);
      if (melhores.length < k) {
        melhores.push({ rotulo: ex.rotulo, semelhanca: s, estado: ex.estado });
        if (melhores.length === k) melhores.sort((a, b) => a.semelhanca - b.semelhanca);
      } else if (s > melhores[0].semelhanca) {
        melhores[0] = { rotulo: ex.rotulo, semelhanca: s, estado: ex.estado };
        melhores.sort((a, b) => a.semelhanca - b.semelhanca);
      }
    }
    return melhores.sort((a, b) => b.semelhanca - a.semelhanca);
  }

  /** Grava um exemplo (substitui o do mesmo estado). Devolve se é novo. */
  async function aprender(pergunta, estado, rotulo, vetor = null) {
    const mem = await carregar(pergunta);
    const chave = chaveDe(estado);
    const antes = mem.porChave.get(chave);
    if (antes && antes.rotulo === rotulo) return false;
    const v = vetor ? Float32Array.from(vetor) : Float32Array.from((await embed([estado]))[0]);
    mem.porChave.set(chave, { estado, rotulo, vetor: v });
    await mkdir(dir, { recursive: true });
    await appendFile(
      jsonlDe(pergunta),
      `${JSON.stringify({ estado, rotulo, em: new Date().toISOString() })}\n`,
    );
    // O cache binário é regravado de tempos em tempos, não a cada exemplo.
    pendentes.add(pergunta);
    agendarGravacao();
    return true;
  }

  const pendentes = new Set();
  let gravacao = null;
  function agendarGravacao() {
    if (gravacao) return;
    gravacao = setTimeout(async () => {
      gravacao = null;
      for (const p of [...pendentes]) {
        pendentes.delete(p);
        const mem = perguntas.get(p);
        if (mem)
          await gravarVetores(p, mem).catch((e) => log('memoria: cache não gravou', e?.message));
      }
    }, 30_000);
    gravacao.unref?.();
  }

  /** Aprende muitos de uma vez (semeadura): vetoriza em lote e grava um JSONL novo. */
  async function semear(pergunta, exemplos) {
    const mem = await carregar(pergunta);
    let novos = 0;
    const linhas = [];
    for (const { estado, rotulo } of exemplos) {
      const chave = chaveDe(estado);
      const antes = mem.porChave.get(chave);
      if (antes && antes.rotulo === rotulo) continue;
      mem.porChave.set(chave, { estado, rotulo, vetor: null });
      linhas.push(JSON.stringify({ estado, rotulo, em: new Date().toISOString() }));
      novos += 1;
    }
    if (novos === 0) return 0;
    await mkdir(dir, { recursive: true });
    await appendFile(jsonlDe(pergunta), `${linhas.join('\n')}\n`);
    await vetorizarFaltantes(pergunta, mem);
    return novos;
  }

  async function tamanho(pergunta) {
    return (await carregar(pergunta)).porChave.size;
  }

  /** Para a calibração: todos os exemplos com vetor. */
  async function exemplos(pergunta) {
    return [...(await carregar(pergunta)).porChave.values()].filter((ex) => ex.vetor);
  }

  return { vizinhos, aprender, semear, tamanho, exemplos };
}
