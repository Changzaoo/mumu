/**
 * SEMEIA A MEMÓRIA DO GÊNERO com os rótulos já curados do acervo.
 *
 *   node jev/semear.mjs <rotulos.jsonl> [dir]
 *
 * Cada linha do JSONL: {"t": título, "a": artistas, "g": gênero}. O estado
 * gravado é a mesma frase que o app manda ao decidir ("Título — Artista"),
 * para o vizinho casar com o pedido real. Linhas repetidas (acervo e conta
 * têm as mesmas faixas) colapsam no mesmo estado.
 */
import { readFile } from 'node:fs/promises';
import { criarMemoria } from './memoria.mjs';
import { embed } from './embeddings.mjs';

export const PERGUNTA_GENERO = 'genero';

/** A frase-estado de uma faixa — a MESMA no semear e no decidir. */
export function estadoDaFaixa(titulo, artista) {
  const t = String(titulo ?? '').trim();
  const a = String(artista ?? '').trim();
  return a ? `${t} — ${a}` : t;
}

async function main() {
  const [arquivo, dir = process.env.JEV_DIR || 'D:/Aurial/jev'] = process.argv.slice(2);
  if (!arquivo) throw new Error('uso: node jev/semear.mjs <rotulos.jsonl> [dir]');
  const linhas = (await readFile(arquivo, 'utf8')).split('\n').filter(Boolean);
  const exemplos = [];
  for (const l of linhas) {
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue;
    }
    if (!r.t || !r.g) continue;
    exemplos.push({ estado: estadoDaFaixa(r.t, r.a), rotulo: String(r.g) });
  }
  const memoria = criarMemoria({ dir, embed, log: console.log });
  const inicio = Date.now();
  const novos = await memoria.semear(PERGUNTA_GENERO, exemplos);
  console.log(
    `semeados ${novos} novos (de ${exemplos.length} linhas), memória com ${await memoria.tamanho(PERGUNTA_GENERO)} exemplos, ${Math.round((Date.now() - inicio) / 1000)}s`,
  );
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
