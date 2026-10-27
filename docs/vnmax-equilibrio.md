# Equilíbrio das três aplicações no vnmax

> Plano de 27/10/2026. O vnmax é um notebook: Celeron N4020 (2 núcleos a 1,1 GHz), 3,4 GB de RAM,
> eMMC de 26 GB (92% cheio), cartão SD de 29,7 GB que já desmontou sozinho, Ubuntu 26.04, Node 24,
> Python 3.14, Docker 29. O PC Windows do Vinicius é um i5-4590 (4 núcleos), 16 GB, 194 GB livres.

## Princípio

O vnmax **serve**; ele não **processa** nem **constrói**. Tudo que é pesado em CPU, RAM ou disco
(yt-dlp, ffmpeg, whisper, alinhamento de letra, build de imagem ou de `dist`) roda no PC ou na
nuvem com os créditos da API. No vnmax ficam só processos leves, 24/7, cada um com teto de memória.

Medido em 27/10: o Docker custa **452 MB de RAM parado** (daemon + containerd), mais do que a API
(67 MB) e o worker (206 MB) juntos; o `kdump` reserva **320 MB** de RAM que nunca são usados; o
importador duplicado gastava 136 MB; imagens e cache de build do Docker ocupam **11 GB** do eMMC. Foi
o build da imagem da API, feito no próprio Celeron, que levou o servidor ao thrashing hoje.

## Onde cada peça roda

| Peça                                                                | Onde                                                          | Tecnologia                                                                    | Por quê                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| VNMAX: site (`cripto-academy/server.py`), porteiro, engine, eventos | vnmax                                                         | python3 em `systemd --user` (como hoje)                                       | leve, já funciona; ganha teto de memória            |
| filminho                                                            | vnmax                                                         | node em `systemd --user` (como hoje)                                          | 36 MB                                               |
| radinho API + worker                                                | vnmax                                                         | **node direto em `systemd --user`**, sem Docker                               | tira 450 MB do daemon e elimina o build no servidor |
| Postgres 16 + Redis                                                 | vnmax                                                         | **pacotes nativos** (`apt`), não contêiner                                    | menos RAM, sem daemon, backup simples               |
| radinho importador (yt-dlp, ffmpeg, whisper, alinhamento, Jev)      | **PC Windows**                                                | laço `D:\Aurial\importador.cmd` + Cloudflare Tunnel (como hoje)               | precisa de CPU e RAM; o i5 com 16 GB tem            |
| Build da API (`dist`)                                               | **PC Windows**                                                | `pnpm build` + `rsync` do `dist` e do `node_modules` de produção para o vnmax | nunca buildar no Celeron                            |
| Web                                                                 | Vercel                                                        | como hoje                                                                     | —                                                   |
| Acervo de áudio                                                     | GitHub privado + Cloudflare Worker (`musicas.radinho.online`) | como hoje                                                                     | —                                                   |
| Curadoria 24/7 (Nemotron)                                           | worker no vnmax chamando a NVIDIA                             | rede, não CPU; `NVIDIA_CONCURRENCY=2`                                         | —                                                   |

## Orçamento de memória (3,4 GB)

| Grupo                                  | Teto (`MemoryMax`) | Uso esperado                |
| -------------------------------------- | ------------------ | --------------------------- |
| Sistema + kernel (sem kdump)           | —                  | 350 MB                      |
| VNMAX (site 805 MB hoje)               | 1100 MB            | 1000 MB                     |
| radinho API                            | 400 MB             | 150 MB                      |
| radinho worker                         | 512 MB             | 300 MB                      |
| Postgres (`shared_buffers=128MB`)      | 320 MB             | 200 MB                      |
| Redis (`maxmemory 64mb`)               | 96 MB              | 32 MB                       |
| filminho                               | 128 MB             | 40 MB                       |
| cloudflared (um processo, 4 hostnames) | 64 MB              | 20 MB                       |
| **Soma**                               |                    | **~2,1 GB → sobra ~1,3 GB** |

Hoje se desperdiçam ~900 MB (Docker 450 + kdump 320 + importador duplicado 136). Swap: **zram de
1,5 GB (zstd)** como primeira swap, `/swap.img` como segunda. Num Celeron com 3,4 GB a zram muda a
responsividade sob pressão; a swap no eMMC só segura o pior caso.

## CPU (2 núcleos)

- `Nice=10` para o worker do radinho e `Nice=5` para o engine do VNMAX; site, porteiro e eventos no padrão.
- Nada de ffmpeg, whisper ou yt-dlp no vnmax. Varredura noturna e reimportações só das 3h às 6h, e pelo importador do PC.
- `OOMScoreAdjust`: VNMAX site `-500`, API `-200`, worker `+500` (se faltar memória, o worker morre primeiro e volta sozinho).

## Disco

- Sem Docker: **-11 GB** no eMMC. `journald` com `SystemMaxUse=200M`; logs das aplicações com `logrotate`.
- Cartão SD: só para o descartável (backup diário `pg_dump` que também é copiado para o PC). **Nunca dado vivo** no cartão; se ele desmontar, nada para.

## Entrada de rede

- **Um** `cloudflared` com quatro regras: `api.radinho.online → :4000`, `importer.radinho.online →
100.75.26.46:8790` (PC), `bitcoin.vnmax.org → porteiro`, `filminho.vnmax.org → :4310`.
- Apagar os seis configs mortos em `~/.cloudflared` (bbds-nexus-backend, community-panel, studio-bridge, lowcost, studio-ia-bridge, watchdog).

## Proteções

- Toda unidade com `Restart=always`, `MemoryMax`, `Nice` e `OOMScoreAdjust` como acima.
- Vigia a cada 5 min (`systemd` timer) escrevendo `/home/v/STATUS.md` com `free`, `df` e o `/health` das
  três aplicações, e avisando por push quando algo cai. O mesmo padrão do `guardiao.py` do VNMAX.

## Ordem de execução (sessão de hospedagem), um passo por vez, com `free -m` e `df -h` antes e depois

1. Desligar e desabilitar o importador duplicado; desligar `kdump-tools` e tirar o `crashkernel` do boot; remover `open-vm-tools`, `vgauth`, `apport` (reboot combinado com o Vinicius).
2. zram + `swappiness`.
3. Postgres e Redis nativos: `pg_dump` → instalar → restaurar → trocar `DATABASE_URL`/`REDIS_URL` → parar os contêineres.
4. API e worker como `systemd --user` com node; `dist` buildado no PC e enviado por `rsync`; `deploy-api.sh` vira "rsync + `prisma migrate deploy` + restart".
5. Remover o Docker (`apt purge`): -450 MB de RAM, -11 GB de disco.
6. `cloudflared` único; limpeza dos configs; `MemoryMax`/`Nice`/`OOMScoreAdjust`; vigia com `STATUS.md`.

Riscos: a troca do Postgres tem minutos de indisponibilidade da API e exige backup antes; o reboot do
passo 1 derruba as três aplicações por alguns minutos. Fora isso, cada passo é reversível.
