/**
 * CALIBRAÇÃO — o motor medido contra os rótulos reais, antes de decidir nada.
 *
 *   node jev/calibrar.mjs [dir]
 *
 * Leave-one-out sobre a memória do gênero: cada exemplo é respondido pelos
 * OUTROS (ele próprio sai dos vizinhos) e comparado ao rótulo curado. Sai:
 *
 *   - acurácia geral e por gênero;
 *   - acurácia por faixa de confiança (é o que diz qual corte aceitar sem o
 *     LLM: se acima de 0,5 o motor acerta 95%, 0,5 é o corte);
 *   - a semelhança do vizinho mais próximo quando ele tem o MESMO gênero e
 *     quando tem OUTRO — para fixar SEMELHANCA_MINIMA com dado, não com chute.
 *
 * Varre também algumas temperaturas e k, e imprime a melhor combinação.
 */
import { criarMemoria } from './memoria.mjs';
import { embed } from './embeddings.mjs';
import { cosseno, votosDaMemoria, misturar, softmax, confiancaDe } from './motor.mjs';
import { PERGUNTA_GENERO } from './semear.mjs';

const GENEROS = [
  'Pop',
  'Hip-Hop/Rap',
  'Trap',
  'Funk',
  'Sertanejo',
  'MPB',
  'Pagode',
  'Samba',
  'Axé',
  'Forró',
  'Gospel',
  'Rock',
  'R&B/Soul',
  'Eletrônica',
  'Dance',
  'Reggae',
  'Reggaeton',
  'Country',
  'Jazz',
  'Blues',
  'Clássica',
  'Metal',
  'Indie',
  'Lo-Fi',
  'Latina',
  'K-Pop',
];

function vizinhosDe(ex, todos, k) {
  const melhores = [];
  for (const outro of todos) {
    if (outro === ex) continue;
    const s = cosseno(ex.vetor, outro.vetor);
    if (melhores.length < k) {
      melhores.push({ rotulo: outro.rotulo, semelhanca: s });
      if (melhores.length === k) melhores.sort((a, b) => a.semelhanca - b.semelhanca);
    } else if (s > melhores[0].semelhanca) {
      melhores[0] = { rotulo: outro.rotulo, semelhanca: s };
      melhores.sort((a, b) => a.semelhanca - b.semelhanca);
    }
  }
  return melhores.sort((a, b) => b.semelhanca - a.semelhanca);
}

function faixa(c) {
  return c >= 0.8
    ? '≥0.8'
    : c >= 0.6
      ? '0.6–0.8'
      : c >= 0.4
        ? '0.4–0.6'
        : c >= 0.2
          ? '0.2–0.4'
          : '<0.2';
}

async function main() {
  const dir = process.argv[2] || process.env.JEV_DIR || 'D:/Aurial/jev';
  const memoria = criarMemoria({ dir, embed, log: console.log });
  const todos = (await memoria.exemplos(PERGUNTA_GENERO)).filter((e) => GENEROS.includes(e.rotulo));
  console.log(`exemplos: ${todos.length}`);
  // Amostra para a varredura (leave-one-out é O(n²)): 2.500 exemplos bastam.
  const amostra = todos.filter((_, i) => i % Math.max(1, Math.floor(todos.length / 2500)) === 0);
  console.log(`amostra: ${amostra.length}`);

  // Zero-shot dos rótulos (sem descrição: só o nome), para a mistura.
  const vRotulos = await embed(GENEROS.map((g) => `gênero musical: ${g}`));

  const K = 25;
  const t0 = Date.now();
  const viz = amostra.map((ex) => vizinhosDe(ex, todos, K));
  console.log(
    `kNN de ${amostra.length} × ${todos.length} em ${Math.round((Date.now() - t0) / 1000)}s`,
  );

  // Semelhança do vizinho mais próximo: mesmo gênero × outro gênero.
  const mesmo = [];
  const outro = [];
  amostra.forEach((ex, i) => {
    const v = viz[i][0];
    if (!v) return;
    (v.rotulo === ex.rotulo ? mesmo : outro).push(v.semelhanca);
  });
  const q = (a, p) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(p * (s.length - 1))]?.toFixed(3);
  };
  console.log(
    `vizinho 1 — mesmo gênero p10/p50/p90: ${q(mesmo, 0.1)}/${q(mesmo, 0.5)}/${q(mesmo, 0.9)} (${mesmo.length})`,
  );
  console.log(
    `vizinho 1 — outro gênero p10/p50/p90: ${q(outro, 0.1)}/${q(outro, 0.5)}/${q(outro, 0.9)} (${outro.length})`,
  );

  let melhor = null;
  for (const k of [5, 10, 15, 25]) {
    for (const tau of [0.01, 0.02, 0.03, 0.05]) {
      for (const minimo of [0.8, 0.85, 0.88, 0.9]) {
        let acertos = 0;
        amostra.forEach((ex, i) => {
          const votos = votosDaMemoria(viz[i].slice(0, k), GENEROS, { tau, minimo });
          const sims = vRotulos.map((v) => cosseno(ex.vetor, v));
          const zero = Object.fromEntries(GENEROS.map((g) => [g, 0]));
          softmax(sims, 0.05).forEach((p, j) => {
            zero[GENEROS[j]] = p;
          });
          const prob = misturar(zero, votos);
          const escolha = GENEROS.reduce((m, g) => (prob[g] > prob[m] ? g : m), GENEROS[0]);
          if (escolha === ex.rotulo) acertos += 1;
        });
        const ac = acertos / amostra.length;
        if (!melhor || ac > melhor.ac) melhor = { k, tau, minimo, ac };
      }
    }
  }
  console.log(
    `melhor: k=${melhor.k} tau=${melhor.tau} minimo=${melhor.minimo} acurácia=${(melhor.ac * 100).toFixed(1)}%`,
  );

  // Com a melhor combinação: acurácia por confiança e por gênero.
  const porFaixa = {};
  const porGenero = {};
  amostra.forEach((ex, i) => {
    const votos = votosDaMemoria(viz[i].slice(0, melhor.k), GENEROS, {
      tau: melhor.tau,
      minimo: melhor.minimo,
    });
    const sims = vRotulos.map((v) => cosseno(ex.vetor, v));
    const zero = Object.fromEntries(GENEROS.map((g) => [g, 0]));
    softmax(sims, 0.05).forEach((p, j) => {
      zero[GENEROS[j]] = p;
    });
    const prob = misturar(zero, votos);
    const escolha = GENEROS.reduce((m, g) => (prob[g] > prob[m] ? g : m), GENEROS[0]);
    const conf = confiancaDe(prob);
    const f = faixa(conf);
    porFaixa[f] ??= { n: 0, ok: 0 };
    porFaixa[f].n += 1;
    if (escolha === ex.rotulo) porFaixa[f].ok += 1;
    porGenero[ex.rotulo] ??= { n: 0, ok: 0 };
    porGenero[ex.rotulo].n += 1;
    if (escolha === ex.rotulo) porGenero[ex.rotulo].ok += 1;
  });
  console.log('acurácia por confiança:');
  for (const f of ['≥0.8', '0.6–0.8', '0.4–0.6', '0.2–0.4', '<0.2']) {
    const x = porFaixa[f];
    if (x)
      console.log(
        `  ${f.padEnd(8)} n=${String(x.n).padStart(5)}  acerta ${((100 * x.ok) / x.n).toFixed(1)}%`,
      );
  }
  console.log('acurácia por gênero:');
  for (const [g, x] of Object.entries(porGenero).sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `  ${g.padEnd(12)} n=${String(x.n).padStart(5)}  acerta ${((100 * x.ok) / x.n).toFixed(1)}%`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
