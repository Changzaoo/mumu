# 06 — Testes rigorosos (fase 7)

Framework da stack, sem instalar nada: **Vitest 3** (unidade/integração) e **Playwright 1.50**
(e2e). `supertest` já estava em `apps/api/devDependencies` e nunca tinha sido usado.

## Comandos e saída real

`pnpm test` (raiz, `pnpm -r test`):

```
packages/shared test:  Test Files  10 passed (10)   Tests  200 passed (200)
apps/api test:         Test Files  18 passed (18)   Tests  217 passed (217)
apps/web test:         Test Files  82 passed (82)   Tests  689 passed (689)
```

`E2E_PORT=5199 npx playwright test --reporter=list` (a porta 5173 é de outro projeto):

```
Running 6 tests using 2 workers
  ok 1 app.spec.ts        shell smoke → /search (5.6s)
  ok 2 reproducao.spec.ts tocar uma faixa: sai som, relógio anda, duração não é 0:00 (11.7s)
  ok 3 reproducao.spec.ts pausar e retomar não perde a posição (5.1s)
  ok 4 reproducao.spec.ts RF1 — rajada de troca de faixa não deixa o player parado (4.8s)
  ok 5 reproducao.spec.ts RF3 — a fila anda sozinha quando a faixa acaba (5.9s)
  ok 6 reproducao.spec.ts voltar para a faixa anterior funciona no meio da fila (3.2s)
  6 passed (23.1s)
```

`pnpm typecheck` → 4 pacotes `Done`. `pnpm build` → `✓ built in 14.47s`, `exited with code 0`.

**Saldo: +58 testes de API, +5 de e2e.** `apps/api` tinha 159 em 15 arquivos; agora 217 em 18.

## O que foi escrito

- `apps/api/src/app.integracao.test.ts` — 27: CORS, autenticação, papéis, entrada inválida,
  limites, injeção.
- `apps/api/src/modules/stream/stream.rotas.test.ts` — 21: token de stream pela rota, travessia
  de caminho, RF7 (404 visível).
- `apps/api/src/modules/tracks/tracks.escondida.test.ts` — 10: faixa não-pública por id e por
  download.
- `apps/web/e2e/reproducao.spec.ts` — 5 (e2e): reprodução real, WAV gerado e tocado no Chromium.

**A pilha do Express nunca tinha sido exercitada.** Toda a API era unidade pura: nada passava
por `createApp()`, então CORS, `authenticate`, `requireRole`, teto de corpo e envelope de erro
não tinham um único teste. Banco, Redis, Firebase e cofre entram dublados — sob teste está a
decisão da API, não o Postgres.

**O e2e não tocava música.** Os 689 testes do web provam as regras contra dublês de `<audio>`;
nenhum provava que um `HTMLAudioElement` de verdade sai do `readyState 0`. Agora um WAV é
gerado no navegador, gravado no cofre real (IndexedDB `aurial-offline`) e tocado: a asserção
lê `duration`, `currentTime` e a barra de posição da tela.

Casos de borda cobertos: banimento sem prazo / vencido / no futuro, JSON quebrado, corpo de
1,2 MB, `limit=10000`, busca vazia, id de faixa de 80 caracteres, token vencido, token de
OUTRA faixa, assinatura adulterada, faixa sem `hlsKey` (cofre podado), arquivo sumido do cofre.
Segurança: `'; DROP TABLE tracks; --` e `{"$ne":null}` na busca (Prisma parametriza — o texto
chega dentro de um `contains`), travessia `..%2F..%2F`, `..%5C..%5C`, byte nulo, `.sh`.

## Bugs corrigidos (código, não teste)

1. **Faixa escondida vazava com a chave de ouvir junto** — `apps/api/src/modules/tracks/`.
   Toda listagem da API filtra `isPublic: true`; só a busca por id não olhava o campo.
   `GET /tracks/:id` devolvia a faixa marcada como não-pública para **qualquer um, inclusive
   visitante sem conta** — e o DTO carrega `streamUrl` com token de stream **já assinado**.
   `GET /tracks/:id/download` exigia conta e entregava os bytes originais pelo mesmo caminho.
   Esconder uma faixa não escondia nada. Correção: `visivelPara()` em `tracks.service.ts` (dono
   continua vendo a própria), 404 e não 403 para não confirmar que a faixa existe. **Prova de
   regressão:** removendo as duas guardas, 4 dos 10 testes do arquivo ficam vermelhos.
2. **Origem de fora da lista virava 500** — `apps/api/src/app.ts`. O callback do CORS emitia
   um `Error` cru, que caía no ramo final do `errorHandler`: `500 INTERNAL` e uma linha de log
   **em nível de erro, com pilha**, por requisição. Qualquer varredura automática enchia o log
   e escondia erro de verdade. Agora é `ForbiddenError` → 403 com envelope, sem pilha.
3. Nenhum bug **de reprodução** apareceu: os 5 casos de e2e passaram na primeira execução em
   que os seletores estavam certos, sem tocar no código do player.

Duas correções foram no teste, porque o teste é que estava errado:
`master.m3u8?x=1` não é nome de segmento hostil (o `?` é o começo da query, não do caminho), e
a semeadura do e2e precisou sair de `/` para `/robots.txt` — com o app aberto ele às vezes
persistia a biblioteca vazia da memória por cima das entradas recém-gravadas.

## Cobertura

**Indisponível.** O script `test:coverage` existe nos três pacotes, mas a dependência não:
`Error: Cannot find package '@vitest/coverage-v8'`. Não instalei: cobertura é condicional no
pedido e dependência nova mexe no lockfile que o deploy usa com `--frozen-lockfile`.

## Sem cobertura, e por quê

1. **iOS e Android/FGS** — sem aparelho; risco 1 da fase 3, segue registrado, não prometido.
2. **Postgres e Redis reais** — não há banco de teste no projeto nem docker no portão; a
   integração dubla os dois. Consulta do Prisma é verificada pelo argumento, não pelo SQL.
3. **`GET /tracks/:id/waveform` e `/lyrics`** de faixa escondida seguem abertos: não entregam
   áudio, e ampliar a guarda para elas é decisão de produto, fora do pedido.
4. **HLS pela rede** — o e2e toca do cofre local (blob). O caminho `manifest → variante →
segmento` está coberto por HTTP na API, não ponta a ponta no navegador.
5. **`pnpm lint`** segue quebrado de base (7783); não é portão (memória `lint-quebrado-de-base`).
6. **10 vulnerabilidades de dependência** — intocadas de propósito, para não misturar bump com
   correção de player (risco 2 da fase 3).

STATUS: OK
