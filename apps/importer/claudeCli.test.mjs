import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  ClaudeCliError,
  classificarFalha,
  criarClaudeCli,
  extrairJson,
  montarArgs,
  resolverExecutavelClaude,
} from './claudeCli.mjs';

/**
 * Processo do CLI simulado: nunca chama o Claude de verdade.
 * `roteiro(chamada)` decide a saída; `chamada.entrada` é o que foi pro stdin.
 */
function criarSpawnFalso(roteiro) {
  const chamadas = [];
  let simultaneos = 0;
  let maxSimultaneos = 0;
  const spawn = (exe, args, opts) => {
    const filho = new EventEmitter();
    filho.stdin = new PassThrough();
    filho.stdout = new PassThrough();
    filho.stderr = new PassThrough();
    filho.killed = false;
    filho.kill = () => {
      filho.killed = true;
      simultaneos -= 1;
    };
    const chamada = { exe, args, opts, entrada: '', filho };
    chamadas.push(chamada);
    simultaneos += 1;
    maxSimultaneos = Math.max(maxSimultaneos, simultaneos);
    let entrada = '';
    filho.stdin.on('data', (d) => (entrada += d));
    filho.stdin.on('end', () => {
      chamada.entrada = entrada;
      Promise.resolve(roteiro(chamada)).then((r) => {
        if (filho.killed || !r) return; // timeout: nunca fecha
        simultaneos -= 1;
        if (r.stdout) filho.stdout.write(r.stdout);
        if (r.stderr) filho.stderr.write(r.stderr);
        filho.emit('close', r.codigo ?? 0);
      });
    });
    return filho;
  };
  return { spawn, chamadas, maxSimultaneos: () => maxSimultaneos };
}

const ok = (texto, extra = {}) => ({
  stdout: JSON.stringify({ type: 'result', is_error: false, result: texto, duration_ms: 1200, total_cost_usd: 0.001, ...extra }),
});

function cliente(roteiro, env = {}, extra = {}) {
  const falso = criarSpawnFalso(roteiro);
  const claude = criarClaudeCli({
    env: { CLAUDE_CLI_PATH: 'claude', ...env },
    spawn: falso.spawn,
    resolver: () => 'C:\\claude\\claude.exe',
    ...extra,
  });
  return { claude, falso };
}

test('sucesso: prompt por stdin, sem shell, sem ferramentas, um JSON de saída', async () => {
  const { claude, falso } = cliente(() => ok('Trap'));
  const r = await claude.perguntar({ prompt: 'Faixa: X', sistema: 'Você classifica', modelo: 'haiku' });
  assert.equal(r.texto, 'Trap');
  assert.equal(r.modelo, 'haiku');
  assert.equal(r.custoUsd, 0.001);
  const [c] = falso.chamadas;
  assert.equal(c.exe, 'C:\\claude\\claude.exe');
  assert.equal(c.entrada, 'Faixa: X'); // o prompt NÃO vai na linha de comando
  assert.ok(!c.args.includes('Faixa: X'));
  assert.notEqual(c.opts.shell, true);
  assert.deepEqual(c.args.slice(c.args.indexOf('--model'), c.args.indexOf('--model') + 2), ['--model', 'haiku']);
  assert.deepEqual(c.args.slice(-2), ['--tools', '']);
  assert.ok(c.args.includes('--output-format') && c.args.includes('json'));
  assert.ok(c.args.includes('--system-prompt'));
});

test('segredos do importador não vão para o ambiente do CLI', async () => {
  const { claude, falso } = cliente(() => ok('x'), {
    NVIDIA_API_KEY: 'segredo',
    IMPORT_SERVICE_TOKEN: 'outro',
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'x',
  });
  await claude.perguntar({ prompt: 'p', modelo: 'haiku' });
  const e = falso.chamadas[0].opts.env;
  assert.equal(e.NVIDIA_API_KEY, undefined);
  assert.equal(e.IMPORT_SERVICE_TOKEN, undefined);
  assert.equal(e.CLAUDECODE, undefined);
  assert.equal(e.CLAUDE_CODE_ENTRYPOINT, undefined);
});

test('json: true valida e devolve o objeto (cerca de markdown tolerada)', async () => {
  const { claude } = cliente(() => ok('```json\n{"artist":"Matuê","title":"333"}\n```'));
  const r = await claude.perguntar({ prompt: 'p', modelo: 'haiku', json: true });
  assert.deepEqual(r.json, { artist: 'Matuê', title: '333' });
});

test('json: true com texto que não é JSON → saida_invalida', async () => {
  const { claude } = cliente(() => ok('desculpe, não sei'));
  await assert.rejects(
    claude.perguntar({ prompt: 'p', modelo: 'haiku', json: true }),
    (e) => e instanceof ClaudeCliError && e.codigo === 'saida_invalida',
  );
});

test('saída do CLI que não é o JSON esperado → saida_invalida', async () => {
  const { claude } = cliente(() => ({ stdout: 'olá, isto não é json' }));
  await assert.rejects(claude.perguntar({ prompt: 'p', modelo: 'haiku' }), (e) => e.codigo === 'saida_invalida');
});

test('resultado vazio → saida_invalida', async () => {
  const { claude } = cliente(() => ok('   '));
  await assert.rejects(claude.perguntar({ prompt: 'p', modelo: 'haiku' }), (e) => e.codigo === 'saida_invalida');
});

test('timeout: mata o processo e devolve timeout', async () => {
  const { claude, falso } = cliente(() => new Promise(() => {})); // nunca responde
  await assert.rejects(
    claude.perguntar({ prompt: 'p', modelo: 'haiku', timeoutMs: 30 }),
    (e) => e.codigo === 'timeout',
  );
  assert.equal(falso.chamadas[0].filho.killed, true);
});

test('não logado: classifica e põe o CLI em pausa (não sobe mais processo)', async () => {
  let agora = 1_000;
  const { claude, falso } = cliente(
    () => ({ codigo: 1, stdout: JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' }) }),
    {},
    { agora: () => agora },
  );
  await assert.rejects(claude.perguntar({ prompt: 'p', modelo: 'haiku' }), (e) => e.codigo === 'nao_logado');
  await assert.rejects(claude.perguntar({ prompt: 'p', modelo: 'haiku' }), (e) => e.codigo === 'nao_logado');
  assert.equal(falso.chamadas.length, 1, 'a segunda chamada nem subiu processo');
  agora += 6 * 60_000; // pausa de 5 min vencida
  await assert.rejects(claude.perguntar({ prompt: 'p', modelo: 'haiku' }), (e) => e.codigo === 'nao_logado');
  assert.equal(falso.chamadas.length, 2);
});

test('limite de uso atingido: código limite e pausa longa', async () => {
  let agora = 1_000;
  const { claude, falso } = cliente(
    () => ({ codigo: 1, stdout: JSON.stringify({ type: 'result', is_error: true, result: 'Claude AI usage limit reached|1760000000' }) }),
    {},
    { agora: () => agora },
  );
  await assert.rejects(claude.perguntar({ prompt: 'p', modelo: 'haiku' }), (e) => e.codigo === 'limite');
  agora += 10 * 60_000; // ainda dentro dos 15 min
  await assert.rejects(claude.perguntar({ prompt: 'p', modelo: 'haiku' }), (e) => e.codigo === 'limite');
  assert.equal(falso.chamadas.length, 1);
  claude.limparPausa();
  assert.equal(claude.estado().pausaAte > 0, false);
});

test('executável ausente: sem resolver → ausente; ENOENT do spawn → ausente', async () => {
  const sem = criarClaudeCli({ env: {}, spawn: () => assert.fail('não deveria subir'), resolver: () => null });
  await assert.rejects(sem.perguntar({ prompt: 'p', modelo: 'haiku' }), (e) => e.codigo === 'ausente');
  assert.equal(sem.disponivel(), false);

  const enoent = criarClaudeCli({
    env: {},
    resolver: () => '/x/claude',
    spawn: () => {
      const f = new EventEmitter();
      f.stdin = new PassThrough();
      f.stdout = new PassThrough();
      f.stderr = new PassThrough();
      f.kill = () => {};
      setImmediate(() => f.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
      return f;
    },
  });
  await assert.rejects(enoent.perguntar({ prompt: 'p', modelo: 'haiku' }), (e) => e.codigo === 'ausente');
});

test('fila de concorrência: nunca mais que CLAUDE_CLI_CONCURRENCY processos juntos', async () => {
  const { claude, falso } = cliente(
    () => new Promise((r) => setTimeout(() => r(ok('ok')), 20)),
    { CLAUDE_CLI_CONCURRENCY: '2' },
  );
  const todas = await Promise.all(
    Array.from({ length: 7 }, (_, i) => claude.perguntar({ prompt: `p${i}`, modelo: 'haiku' })),
  );
  assert.equal(todas.length, 7);
  assert.equal(falso.chamadas.length, 7);
  assert.equal(falso.maxSimultaneos(), 2);
  assert.equal(claude.estado().ativos, 0);
  assert.equal(claude.estado().naFila, 0);
});

test('concorrência padrão é 2 e o teto é 4', async () => {
  for (const [valor, esperado] of [[undefined, 2], ['9', 4], ['1', 1]]) {
    const { claude, falso } = cliente(
      () => new Promise((r) => setTimeout(() => r(ok('ok')), 10)),
      valor === undefined ? {} : { CLAUDE_CLI_CONCURRENCY: valor },
    );
    await Promise.all(Array.from({ length: 8 }, () => claude.perguntar({ prompt: 'p', modelo: 'haiku' })));
    assert.equal(falso.maxSimultaneos(), esperado, `concorrência ${valor}`);
  }
});

test('modelo inválido e prompt vazio são recusados antes de subir processo', async () => {
  const { claude, falso } = cliente(() => ok('x'));
  await assert.rejects(claude.perguntar({ prompt: 'p', modelo: 'haiku; rm -rf' }), (e) => e.codigo === 'falhou');
  await assert.rejects(claude.perguntar({ prompt: '  ', modelo: 'haiku' }), (e) => e.codigo === 'falhou');
  assert.equal(falso.chamadas.length, 0);
});

test('system prompt gigante e .cmd vão pelo stdin, sem aspas na linha de comando', async () => {
  const grande = 'a'.repeat(7000);
  const { claude, falso } = cliente(() => ok('x'));
  await claude.perguntar({ prompt: 'P', sistema: grande, modelo: 'sonnet' });
  assert.ok(!falso.chamadas[0].args.includes('--system-prompt'));
  assert.ok(falso.chamadas[0].entrada.startsWith(grande));

  const cmd = criarSpawnFalso(() => ok('x'));
  const c = criarClaudeCli({ env: { ComSpec: 'cmd.exe' }, spawn: cmd.spawn, resolver: () => 'C:\\npm\\claude.cmd' });
  await c.perguntar({ prompt: 'P', sistema: 'S "com aspas"', modelo: 'haiku' });
  assert.equal(cmd.chamadas[0].exe, 'cmd.exe');
  assert.ok(cmd.chamadas[0].opts.windowsVerbatimArguments);
  assert.ok(!cmd.chamadas[0].args.join(' ').includes('com aspas'));
  assert.ok(cmd.chamadas[0].entrada.includes('S "com aspas"'));
});

test('classificarFalha reconhece login, limite e indisponibilidade', () => {
  assert.equal(classificarFalha('Invalid API key · Please run /login'), 'nao_logado');
  assert.equal(classificarFalha('API Error: 429 rate_limit_error'), 'limite');
  assert.equal(classificarFalha("You've hit your limit · resets 3pm"), 'limite');
  assert.equal(classificarFalha('API Error: 529 overloaded_error'), 'indisponivel');
  assert.equal(classificarFalha('algo estranho'), 'falhou');
});

test('extrairJson acha o JSON no meio de texto', () => {
  assert.deepEqual(extrairJson('Claro! {"a":[1,2]} pronto'), { a: [1, 2] });
  assert.deepEqual(extrairJson('["A","B"]'), ['A', 'B']);
  assert.throws(() => extrairJson('nada'), ClaudeCliError);
});

test('montarArgs: --tools "" por último, sem session', () => {
  const a = montarArgs({ modelo: 'haiku', sistema: '' });
  assert.deepEqual(a.slice(-2), ['--tools', '']);
  assert.ok(a.includes('--no-session-persistence'));
  assert.ok(!a.includes('--system-prompt'));
});

test('resolverExecutavelClaude: CLAUDE_CLI_PATH > PATH > .local/bin > app Desktop (versão mais nova)', () => {
  const existe = (set) => (p) => set.has(p.replaceAll('\\', '/'));
  assert.equal(
    resolverExecutavelClaude({ CLAUDE_CLI_PATH: 'D:/x/claude.exe' }, { existe: existe(new Set(['D:/x/claude.exe'])), plataforma: 'win32' }),
    'D:/x/claude.exe',
  );
  assert.equal(resolverExecutavelClaude({ CLAUDE_CLI_PATH: 'D:/nao.exe' }, { existe: existe(new Set()), plataforma: 'win32' }), null);

  const desktop = resolverExecutavelClaude(
    { APPDATA: 'C:/A' },
    {
      plataforma: 'win32',
      existe: existe(new Set(['C:/A/Claude/claude-code/2.1.286/h1/claude.exe', 'C:/A/Claude/claude-code/2.1.284/h0/claude.exe'])),
      listar: (d) =>
        d.replaceAll('\\', '/').endsWith('claude-code') ? ['2.1.284', '2.1.286'] : d.endsWith('2.1.286') ? ['h1'] : ['h0'],
    },
  );
  assert.equal(desktop.replaceAll('\\', '/'), 'C:/A/Claude/claude-code/2.1.286/h1/claude.exe');
});
