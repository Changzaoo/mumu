/**
 * Gera `dist/sitemap.xml` no fim do build.
 *
 * Sem ele o Google só conhece o que acha seguindo links — e numa SPA quase
 * todo link nasce depois do JavaScript. Pior: `/sitemap.xml` caía na reescrita
 * da SPA e devolvia o `index.html`, que o Search Console acusa como sitemap
 * inválido.
 *
 * Entram as páginas públicas fixas e, do acervo do app (`/catalogo`, o mesmo
 * que qualquer visitante recebe sem login), os gêneros e os artistas com pelo
 * menos DUAS faixas. Artista de uma faixa só é página rala — o buscador pune
 * site que manda muitas páginas finas, e elas puxariam as boas para baixo.
 *
 * Se a API não responder, o build NÃO quebra e NÃO encolhe o sitemap: fica a
 * cópia guardada em `public/sitemap.xml` (que o Vite já copiou para o `dist`).
 * É o caso de TODO build na Vercel — o Cloudflare na frente da API desafia os
 * servidores dela, o mesmo 403 que derrubou o rewrite `/api`. Medido no
 * primeiro deploy: o sitemap publicado saiu com 7 URLs em vez de 854.
 *
 * Por isso a cópia guardada é o que vale em produção. Atualizar:
 *   pnpm --filter @radinho/web sitemap
 * (roda daqui, de uma máquina que alcança a API) e commitar o arquivo.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ORIGEM = 'https://radinho.online';
const API = (process.env.VITE_API_URL || 'https://aurial-api.nexusholding.xyz/api/v1').replace(
  /\/+$/,
  '',
);
const MIN_FAIXAS_POR_ARTISTA = 2;

const FIXAS = [
  { caminho: '/', prioridade: '1.0', freq: 'daily' },
  { caminho: '/discover', prioridade: '0.9', freq: 'daily' },
  { caminho: '/search', prioridade: '0.8', freq: 'weekly' },
  { caminho: '/radios', prioridade: '0.8', freq: 'weekly' },
  { caminho: '/artistas', prioridade: '0.8', freq: 'daily' },
  { caminho: '/podcasts', prioridade: '0.7', freq: 'weekly' },
  { caminho: '/gravadoras', prioridade: '0.5', freq: 'weekly' },
];

async function lerCatalogo() {
  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), 30_000);
  try {
    const res = await fetch(`${API}/catalogo`, {
      signal: controle.signal,
      headers: { Origin: ORIGEM },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const corpo = await res.json();
    const lista = Array.isArray(corpo) ? corpo : corpo?.data;
    if (!Array.isArray(lista)) throw new Error('resposta sem lista');
    return lista;
  } finally {
    clearTimeout(prazo);
  }
}

/** Nomes agrupados sem diferenciar maiúsculas; fica a grafia mais frequente. */
function contar(nomes) {
  const grupos = new Map();
  for (const bruto of nomes) {
    const nome = typeof bruto === 'string' ? bruto.trim() : '';
    if (!nome || nome === 'Desconhecido') continue;
    const chave = nome.toLocaleLowerCase('pt-BR');
    const g = grupos.get(chave) ?? { total: 0, grafias: new Map() };
    g.total += 1;
    g.grafias.set(nome, (g.grafias.get(nome) ?? 0) + 1);
    grupos.set(chave, g);
  }
  return [...grupos.values()].map((g) => ({
    nome: [...g.grafias].sort((a, b) => b[1] - a[1])[0][0],
    total: g.total,
  }));
}

function url({ caminho, prioridade, freq }, hoje) {
  return (
    `  <url><loc>${ORIGEM}${caminho}</loc><lastmod>${hoje}</lastmod>` +
    `<changefreq>${freq}</changefreq><priority>${prioridade}</priority></url>`
  );
}

const ATUALIZAR_COPIA = process.argv.includes('--copia');
const destino = resolve(
  import.meta.dirname,
  ATUALIZAR_COPIA ? '../public/sitemap.xml' : '../dist/sitemap.xml',
);

const hoje = new Date().toISOString().slice(0, 10);
const entradas = [...FIXAS];
let completo = false;

try {
  const catalogo = await lerCatalogo();
  const faixas = catalogo.map((e) => e?.track).filter(Boolean);

  const generos = contar(faixas.map((t) => t.genre)).sort((a, b) => b.total - a.total);
  for (const g of generos) {
    entradas.push({
      caminho: `/genero/${encodeURIComponent(g.nome)}`,
      prioridade: '0.8',
      freq: 'daily',
    });
  }

  const artistas = contar(faixas.flatMap((t) => (t.artists ?? []).map((a) => a?.name)))
    .filter((a) => a.total >= MIN_FAIXAS_POR_ARTISTA)
    .sort((a, b) => b.total - a.total);
  for (const a of artistas) {
    entradas.push({
      caminho: `/artista/${encodeURIComponent(a.nome)}`,
      prioridade: a.total >= 10 ? '0.7' : '0.6',
      freq: 'weekly',
    });
  }
  console.log(
    `sitemap: ${FIXAS.length} fixas + ${generos.length} gêneros + ${artistas.length} artistas`,
  );
  completo = true;
} catch (erro) {
  if (!ATUALIZAR_COPIA && existsSync(destino)) {
    console.warn(`sitemap: catálogo indisponível (${erro.message}) — mantida a cópia guardada`);
    process.exit(0);
  }
  if (ATUALIZAR_COPIA) {
    console.error(`sitemap: catálogo indisponível (${erro.message}) — cópia NÃO atualizada`);
    process.exit(1);
  }
  console.warn(`sitemap: catálogo indisponível (${erro.message}) — só páginas fixas`);
}

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  entradas.map((e) => url(e, hoje)).join('\n') +
  '\n</urlset>\n';

writeFileSync(destino, xml);
if (ATUALIZAR_COPIA && completo) console.log(`sitemap: cópia atualizada em ${destino}`);
