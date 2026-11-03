# Sempre online

O que continua tocando quando uma peça cai, e o que ainda falta para
o radinho ficar de pé sem depender do vnmax. Estado em 03/11/2026.

Ideia: web, áudio e letras não passam pelo vnmax. Só a API e o importador
passam. Quando o vnmax cai, a listagem do acervo sai do espelho na borda
e as faixas já na borda seguem tocando.

## 1. O que fica de pé sem o vnmax

| Peça                                  | Onde mora                                                                                                                     | Cai com o vnmax?                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Web                                   | Vercel (radinho.online)                                                                                                       | Não                                |
| Áudio                                 | Repositórios privados `aurial-musicas-NNN` no GitHub, servidos pelo Worker `infra/cdn/github-worker` (musicas.radinho.online) | Não                                |
| Listagem do acervo                    | Espelho no KV `ACERVO` do Worker (`/acervo`); a web cai nele quando a API falha                                               | Não (pode ficar um pouco atrasada) |
| Letras                                | LRCLIB, direto do navegador                                                                                                   | Não                                |
| Login                                 | Firebase                                                                                                                      | Não                                |
| API (catálogo vivo, contas, coleções) | vnmax, atrás de túnel (api.radinho.online)                                                                                    | **Sim**                            |
| Postgres e workers                    | vnmax                                                                                                                         | **Sim**                            |
| Importador (busca, `/stream`, import) | vnmax (importer.radinho.online), `TEMPO_LOCAL=0`, sem whisper                                                                 | **Sim**                            |
| Importador de reserva                 | Render (`radinho-importador`)                                                                                                 | Não, mas ainda não existe          |

## 2. O acervo que não tocava

### Causa

- Em 28/10 o importador passou para o vnmax, com cofre novo.
- A origem respondeu 404 para faixas que ainda estavam vivas na borda do GitHub.
- Os agentes `acervoFiel` e `duracoes` apagaram o `remoteUrl` de **5.684 das
  5.852 faixas** (97% do acervo). Essas faixas deixaram de tocar ou caíam no
  `/stream` ao vivo.

### Conserto

| Passo                                    | Onde                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Restaurar `remoteUrl` a partir do índice | `apps/api/src/scripts/restaurarCopiasDoIndice.ts`: 5.636 restauradas                    |
| Backup do estado antes da restauração    | tabela `catalog_backup_remoteurl_20261103`                                              |
| Índice usado como referência             | `/home/v/indice-musicas.json` no vnmax                                                  |
| Checar a borda antes da origem           | `apps/api/src/workers/copiaViva.ts`                                                     |
| Morta só quando borda e origem dão 404   | mesmo arquivo; borda vem de `AUDIO_BORDA_URL` (padrão `https://musicas.radinho.online`) |
| Importador manda para a borda            | `GET`/`HEAD /blob/:id` sem meta local → 302 para a borda, com o `k`                     |

### Como reverter

- A tabela `catalog_backup_remoteurl_20261103` guarda o `remoteUrl` anterior.
- Para voltar, use essa tabela como fonte. Não rode o script de restauração
  de novo sem olhar antes o que ele vai sobrescrever.

### Estado hoje

- **5.799 de 5.847** faixas tocáveis.

## 3. Espelho do acervo na borda

A listagem do `/api/v1/catalogo` fica guardada na borda. Assim o app acha o
acervo mesmo com a API fora.

### Peças

| Peça                    | Detalhe                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /acervo` (Worker)  | Lê o KV `ACERVO`. `Cache-Control` de 5 min; `ETag` e `304`. A `remoteUrl` é remontada pelo índice.                                             |
| `PUT /acervo` (Worker)  | Exige `Authorization: Bearer ESPELHO_TOKEN`.                                                                                                   |
| Segredo `ESPELHO_TOKEN` | No Worker: `npx wrangler secret put ESPELHO_TOKEN`. A mesma chave fica em `/home/v/radinho-api.env` no vnmax.                                  |
| Envio periódico         | `apps/api/src/workers/espelhoDoAcervo.worker.ts` manda a listagem a cada 20 min, quando o `ETag` muda. A primeira vez é 30 s após subir a API. |
| Web                     | `apps/web/src/lib/sync/catalogoApi.ts` cai para `https://musicas.radinho.online/acervo` quando a API falha (rede, 5xx ou 403).                 |
| Painel de sincronia     | Mostra a origem "espelho na borda".                                                                                                            |
| Constante               | `BORDA_DO_GITHUB` em `apps/web/src/lib/dominios.ts`.                                                                                           |

### Cron do Worker: parado

O cron está comentado em `[triggers]` do `wrangler.toml`. Motivo: a conta
Cloudflare ainda não tem subdomínio `workers.dev`.

Para religar:

1. Abrir a página Workers no painel da Cloudflare. Isso cria o subdomínio.
2. Descomentar `[triggers]` em `wrangler.toml`.
3. Rodar `npx wrangler deploy`.

## 4. Importador de reserva (Render)

Serve para o app ter para onde ir quando o importador principal cai.

### O que já está no repositório

| Arquivo                              | Conteúdo                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `render.yaml`                        | Serviço web Docker `radinho-importador`, plano grátis, região `oregon`, `healthCheckPath: /health` |
| `apps/importer/Dockerfile`           | `node:22-slim` + ffmpeg + yt-dlp + python3. `TEMPO_LOCAL=0`. Disco descartável.                    |
| `apps/importer/docker-entrypoint.sh` | Grava `YTDLP_COOKIES_B64` em `/data/cookies.txt` na subida.                                        |

### Segredos a preencher no painel do Render

| Variável               | Obrigatória? |
| ---------------------- | ------------ |
| `IMPORT_SERVICE_TOKEN` | Sim          |
| `NVIDIA_API_KEY`       | Não          |
| `YTDLP_COOKIES_B64`    | Não          |

### Como ligar

1. Entrar no painel do Render com a conta do dono do projeto.
2. **New → Blueprint**.
3. Escolher este repositório. O Render lê o `render.yaml`.
4. Preencher os segredos da tabela acima.
5. Esperar o primeiro deploy e conferir `/health`.

> Criado em 03/11/2026 pela API do Render (serviço `radinho-importador`, contexto docker
> `./apps/importer`); `/health` responde 200 e `/blob/<id>?k=` redireciona para a borda.

Comportamento do plano grátis: dorme após 15 min sem tráfego e acorda em
cerca de 1 min. A primeira busca depois de dormir demora.

### Como a web usa a reserva

| Peça                                                     | Papel                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `IMPORTADORES_RESERVA` em `apps/web/src/lib/dominios.ts` | Lista de reservas. Padrão: `https://radinho-importador.onrender.com`.                                                                       |
| `VITE_IMPORTADOR_RESERVA`                                | Lista em CSV. Quando preenchida, manda sobre o padrão.                                                                                      |
| `apps/web/src/lib/telemetry/medico.ts`                   | Sonda o `/health` do principal. Se ele estiver fora, sonda as reservas e ativa a primeira que responde (`saudeDoImportador.ativarReserva`). |
| `helperUrl()`                                            | Passa a devolver a reserva enquanto ela está ativa.                                                                                         |
| Volta do principal                                       | Quando o principal volta, a alta desfaz a troca.                                                                                            |
| Diário                                                   | Registra `medico/reserva`.                                                                                                                  |

## 5. Relógio da letra no PC

Problema: produção não alinha (`TEMPO_LOCAL=0`). Por isso a letra ficava com
o tempo bruto do LRCLIB. A solução é alinhar no PC e publicar o resultado na borda.

### Como funciona

| Passo          | Detalhe                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Lista o acervo | Pela borda                                                                                                                   |
| Letra          | LRCLIB, com a regra de `packages/shared/src/letra`                                                                           |
| Áudio          | Da borda                                                                                                                     |
| Alinhamento    | `palavras.py alinhar` com whisper `small`                                                                                    |
| Saída          | `D:/Aurial/musicas-git/_aurial-indice-musicas/alinhamentos/<id>.json`, com `:` trocado por `_` no nome                       |
| Publicação     | Commit e push a cada 10 faixas                                                                                               |
| Borda          | `GET /blob/<id>/alinhar?k=` no Worker. Sem alinhamento responde 404 `sem-alinhamento`.                                       |
| App            | `apps/web/src/lib/lyrics/alinhamentoDaBorda.ts` pergunta à borda antes do importador e casa as linhas por texto normalizado. |

### Tempo medido

| Modelo  | Tempo                                | Erro contra o `small`     |
| ------- | ------------------------------------ | ------------------------- |
| `small` | 319 s para música de 204 s (i5-4590) | referência                |
| `base`  | cerca de 3x mais rápido              | mediana 60 ms, p90 380 ms |
| `tiny`  | —                                    | mediana 200 ms            |

### Estado e log

| Arquivo                                     | Conteúdo                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Tarefa agendada `Radinho relogio do acervo` | Criada por `infra/scripts/relogio-do-acervo.ps1`, que roda `infra/scripts/relogio-do-acervo.cmd` |
| `D:\Aurial\relogio\relogio.log`             | Log                                                                                              |
| `D:\Aurial\relogio\estado.json`             | Estado (o que já foi feito)                                                                      |

Fila inicial: **5.625 faixas**.

### Opções do script

| Opção        | Efeito                  |
| ------------ | ----------------------- |
| `--max N`    | Para depois de N faixas |
| `--so <id>`  | Processa só uma faixa   |
| `--sem-push` | Não faz commit e push   |
| `--continuo` | Roda sem parar          |

## 6. Como conferir

```bash
curl https://api.radinho.online/api/v1/catalogo
#   tocável: ~5,8 mil faixas (com o vnmax no ar)

curl -I https://musicas.radinho.online/acervo
#   200 (espelho de pé, com ou sem vnmax)

curl -I "https://importer.radinho.online/blob/<id>?k=<k>"
#   302 quando a faixa não está no cofre do vnmax (a borda responde)

schtasks /Query /TN "Radinho relogio do acervo"
#   tarefa do relógio da letra no PC
```

Se `api.radinho.online` não responde, o vnmax está fora ou o túnel caiu.
A web segue pelo espelho.

## 7. Pendências

| O que                                                  | Quem                        | Notas                                       |
| ------------------------------------------------------ | --------------------------- | ------------------------------------------- |
| Criar o serviço `radinho-importador` no Render         | Dono da conta               | Seção 4. Precisa de `IMPORT_SERVICE_TOKEN`. |
| Criar subdomínio `workers.dev` na Cloudflare           | Dono da conta               | Abrir a página Workers no painel.           |
| Descomentar `[triggers]` e rodar `npx wrangler deploy` | Quem tiver acesso ao Worker | Depois do item anterior.                    |
| Relógio da letra cobrir o acervo                       | PC                          | Leva semanas. Não há prazo.                 |
