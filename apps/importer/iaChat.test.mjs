import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ClaudeCliError } from './claudeCli.mjs';
import {
  ASSINATURAS_DE_TAREFA,
  MODELO_POR_TAREFA,
  criarIaChat,
  inferirTarefa,
  messagesParaPrompt,
  modeloDaTarefa,
} from './iaChat.mjs';

const msgs = (sistema, usuario = 'Faixa: Mantém — Matuê') => [
  { role: 'system', content: sistema },
  { role: 'user', content: usuario },
];

function claudeFalso(resposta) {
  const chamadas = [];
  return {
    chamadas,
    disponivel: () => true,
    perguntar: async (a) => {
      chamadas.push(a);
      const r = typeof resposta === 'function' ? resposta(a) : resposta;
      if (r instanceof Error) throw r;
      return { texto: r, duracaoMs: 5, custoUsd: 0, modelo: a.modelo };
    },
  };
}

test('mapa tarefa→modelo: simples em volume = haiku, julgamento = sonnet, nada = opus', () => {
  assert.equal(MODELO_POR_TAREFA.genre, 'haiku');
  assert.equal(MODELO_POR_TAREFA.genreLote, 'haiku');
  assert.equal(MODELO_POR_TAREFA.cleanTitle, 'haiku');
  for (const t of ['identity', 'verify', 'verifyGenre', 'splitArtists', 'artistGenre', 'describe']) {
    assert.equal(MODELO_POR_TAREFA[t], 'sonnet', t);
  }
  assert.ok(!Object.values(MODELO_POR_TAREFA).includes('opus'));
  assert.equal(modeloDaTarefa('inexistente', {}), 'sonnet');
  assert.equal(modeloDaTarefa(null, {}), 'sonnet');
});

test('env sobrepõe o mapa: CLAUDE_MODELO_<TAREFA> e CLAUDE_MODELO_PADRAO', () => {
  assert.equal(modeloDaTarefa('verify', { CLAUDE_MODELO_VERIFY: 'haiku' }), 'haiku');
  assert.equal(modeloDaTarefa('artistGenre', { CLAUDE_MODELO_ARTISTGENRE: 'opus' }), 'opus');
  assert.equal(modeloDaTarefa('naoExiste', { CLAUDE_MODELO_PADRAO: 'haiku' }), 'haiku');
});

test('as frases usadas para reconhecer a tarefa ainda existem nos prompts de origem', () => {
  const raiz = new URL('../../', import.meta.url);
  const fontes = [
    'packages/shared/src/ai/curation.ts',
    'packages/shared/src/ai/agents.ts',
    'apps/web/src/lib/ai/ai.ts',
  ]
    .map((f) => readFileSync(new URL(f, raiz), 'utf8').replace(/'\s*\+\s*\n\s*'/g, ''))
    .join('\n');
  for (const [frase, tarefa] of ASSINATURAS_DE_TAREFA) {
    assert.ok(fontes.includes(frase), `assinatura de ${tarefa} sumiu dos prompts: "${frase}"`);
    assert.ok(MODELO_POR_TAREFA[tarefa], `${tarefa} sem modelo no mapa`);
  }
});

test('inferirTarefa lê o system prompt; sem pista → null', () => {
  assert.equal(inferirTarefa(msgs('Você classifica uma música em UM gênero musical desta lista')), 'genre');
  assert.equal(inferirTarefa(msgs('Você confere se a atribuição de uma música está correta')), 'verify');
  assert.equal(inferirTarefa(msgs('Qualquer outra coisa')), null);
  assert.equal(inferirTarefa([{ role: 'user', content: 'oi' }]), null);
});

test('messagesParaPrompt: system separado; vários turnos viram um prompt', () => {
  assert.deepEqual(messagesParaPrompt(msgs('S', 'U')), { sistema: 'S', prompt: 'U' });
  const r = messagesParaPrompt([
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
  ]);
  assert.equal(r.sistema, '');
  assert.match(r.prompt, /Usuário:\na\n\nAssistente:\nb\n\nUsuário:\nc/);
});

test('claude atende: modelo da tarefa inferida, nvidia nem é chamada', async () => {
  const claude = claudeFalso('Trap');
  let nvidiaChamada = 0;
  const ia = criarIaChat({ claude, nvidia: async () => (nvidiaChamada += 1, 'x'), env: {} });
  const r = await ia.conversar({ messages: msgs('Você classifica uma música em UM gênero musical'), model: 'nvidia/nemotron-3-ultra-550b-a55b' });
  assert.equal(r.content, 'Trap');
  assert.equal(r.provedor, 'claude');
  assert.equal(r.modelo, 'haiku');
  assert.equal(claude.chamadas[0].modelo, 'haiku');
  assert.equal(claude.chamadas[0].sistema.startsWith('Você classifica'), true);
  assert.equal(nvidiaChamada, 0);
});

test('body.task tem prioridade; o navegador pode pedir haiku/sonnet mas não opus', async () => {
  const claude = claudeFalso('ok');
  const ia = criarIaChat({ claude, env: {} });
  await ia.conversar({ messages: msgs('qualquer'), tarefa: 'identity' });
  assert.equal(claude.chamadas.at(-1).modelo, 'sonnet');
  await ia.conversar({ messages: msgs('outro'), tarefa: 'identity', model: 'haiku' });
  assert.equal(claude.chamadas.at(-1).modelo, 'haiku');
  await ia.conversar({ messages: msgs('mais um'), tarefa: 'genre', model: 'opus' });
  assert.equal(claude.chamadas.at(-1).modelo, 'haiku', 'opus pedido pelo corpo é ignorado');
});

for (const codigo of ['limite', 'nao_logado', 'ausente', 'timeout', 'saida_invalida', 'indisponivel']) {
  test(`falha do claude (${codigo}) → cai para a NVIDIA e registra quem atendeu`, async () => {
    const logs = [];
    const claude = claudeFalso(new ClaudeCliError(codigo, 'x'));
    let recebido;
    const ia = criarIaChat({
      claude,
      nvidia: async (a) => ((recebido = a), 'Funk'),
      env: {},
      log: (m) => logs.push(m),
    });
    const r = await ia.conversar({
      messages: msgs('Você classifica uma música em UM gênero musical'),
      model: 'nvidia/nemotron-3-super-120b-a12b',
      maxTokens: 2048,
    });
    assert.equal(r.provedor, 'nvidia');
    assert.equal(r.content, 'Funk');
    assert.equal(recebido.model, 'nvidia/nemotron-3-super-120b-a12b');
    assert.ok(logs.some((l) => l.includes(`claude falhou (${codigo})`) && l.includes('NVIDIA')));
    assert.ok(logs.some((l) => l.includes('→ nvidia/') && l.includes('(queda)')));
  });
}

test('claude falha e NÃO há chave da NVIDIA → o erro sobe (endpoint responde 502)', async () => {
  const ia = criarIaChat({ claude: claudeFalso(new ClaudeCliError('limite', 'x')), nvidia: null, env: {} });
  await assert.rejects(ia.conversar({ messages: msgs('s') }), (e) => e.codigo === 'limite');
});

test('IA_FALLBACK_NVIDIA=0 desliga a queda', async () => {
  const ia = criarIaChat({
    claude: claudeFalso(new ClaudeCliError('limite', 'x')),
    nvidia: async () => 'nunca',
    env: { IA_FALLBACK_NVIDIA: '0' },
  });
  await assert.rejects(ia.conversar({ messages: msgs('s') }), (e) => e.codigo === 'limite');
});

test('IA_PROVEDOR=nvidia: o claude nem é consultado', async () => {
  const claude = claudeFalso('claude');
  const ia = criarIaChat({ claude, nvidia: async () => 'nvidia', env: { IA_PROVEDOR: 'nvidia' } });
  const r = await ia.conversar({ messages: msgs('s') });
  assert.equal(r.provedor, 'nvidia');
  assert.equal(claude.chamadas.length, 0);
});

test('cache: a mesma pergunta não gasta cota do claude duas vezes; erro não é guardado', async () => {
  let n = 0;
  const claude = claudeFalso(() => (n += 1, n === 1 ? new ClaudeCliError('timeout', 'x') : 'Rock'));
  const ia = criarIaChat({ claude, env: {} });
  const m = msgs('Você classifica uma música em UM gênero musical', 'A — B');
  await assert.rejects(ia.conversar({ messages: m }));
  assert.equal((await ia.conversar({ messages: m })).content, 'Rock');
  assert.equal((await ia.conversar({ messages: m })).content, 'Rock');
  assert.equal(claude.chamadas.length, 2, '1 erro + 1 sucesso; a 3ª veio do cache');
  assert.equal(ia.tamanhoDoCache(), 1);
});

test('configurado(): sem CLI e sem chave → falso; só um dos dois → verdadeiro', () => {
  const sem = { disponivel: () => false, perguntar: async () => {} };
  assert.equal(criarIaChat({ claude: sem, nvidia: null, env: {} }).configurado(), false);
  assert.equal(criarIaChat({ claude: sem, nvidia: async () => 'x', env: {} }).configurado(), true);
  assert.equal(criarIaChat({ claude: claudeFalso('x'), nvidia: null, env: {} }).configurado(), true);
});
