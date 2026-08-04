/**
 * Agente de armazenamento — o único que olha para fora da biblioteca.
 *
 * POR QUE ELE EXISTE: o disco deste servidor já encheu duas vezes, e as duas
 * vezes o sintoma NÃO pareceu disco. Na primeira, o build do Docker morreu com
 * "erro de assinatura GPG do apt" — nada no erro dizia "sem espaço". Na
 * segunda, uploads começaram a falhar em silêncio. Quando o disco enche, cada
 * subsistema quebra de um jeito diferente e nenhum deles acusa a causa.
 *
 * Um agente que olha o espaço o tempo todo transforma isso num aviso ANTES de
 * quebrar. Ele não conserta nada sozinho por padrão — encher o disco é
 * sintoma de decisão humana (mais blobs, mais imagens) e apagar por conta
 * própria seria pior. O que ele faz é medir, avisar cedo, e recolher o lixo
 * que é seguro recolher: cache de build do Docker e imagens órfãs, que se
 * refazem sozinhos.
 */
import { statfs } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';

const log = logger.child({ worker: 'armazenamento' });
const run = promisify(exec);

/** Acima disto o worker começa a avisar em toda volta. */
const ALERTA = 0.85;
/** Acima disto ele recolhe o lixo seguro por conta própria. */
const CRITICO = 0.92;

export interface EstadoDoDisco {
  totalBytes: number;
  livreBytes: number;
  usadoFracao: number;
}

/** Quanto o volume que hospeda o caminho tem de espaço. */
export async function medirDisco(caminho = '/'): Promise<EstadoDoDisco | null> {
  try {
    const fs = await statfs(caminho);
    const total = fs.blocks * fs.bsize;
    // `bavail` (e não `bfree`) é o que um processo comum pode realmente usar:
    // o ext4 reserva uma fatia para o root, e contar essa reserva como livre
    // faz o alarme só disparar quando o disco JÁ encheu para quem escreve.
    const livre = fs.bavail * fs.bsize;
    if (total <= 0) return null;
    return { totalBytes: total, livreBytes: livre, usadoFracao: 1 - livre / total };
  } catch (err) {
    log.warn({ err, caminho }, 'não foi possível medir o disco');
    return null;
  }
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}G`;
}

/**
 * Recolhe o lixo que se refaz sozinho: cache de build e imagens sem container.
 *
 * Estas duas coisas são reconstruídas sob demanda — o custo de apagar é um
 * build mais lento da próxima vez, não perda de dado. É deliberadamente o
 * MESMO comando que o `deploy-api.sh` já roda na etapa 6; nada aqui apaga
 * blob, banco ou volume.
 */
async function recolherLixoSeguro(): Promise<void> {
  for (const comando of ['docker builder prune -af', 'docker image prune -f']) {
    try {
      const { stdout } = await run(comando, { timeout: 120_000 });
      const liberado = /Total reclaimed space:\s*(.+)/.exec(stdout)?.[1]?.trim();
      log.info({ comando, liberado }, 'lixo recolhido');
    } catch (err) {
      // Sem socket do Docker dentro do container é o caso NORMAL: o worker não
      // tem por que enxergar o daemon. Avisar em warn seria ruído toda hora.
      log.debug({ err, comando }, 'não deu para recolher (sem acesso ao Docker?)');
    }
  }
}

/** Uma medição, com aviso proporcional ao aperto. */
export async function verificarArmazenamento(): Promise<EstadoDoDisco | null> {
  const estado = await medirDisco(env.STORAGE_LOCAL_PATH || '/');
  if (!estado) return null;

  const pct = Math.round(estado.usadoFracao * 100);
  const dados = { usado: `${pct}%`, livre: gb(estado.livreBytes), total: gb(estado.totalBytes) };

  if (estado.usadoFracao >= CRITICO) {
    log.error(dados, 'disco crítico — recolhendo lixo seguro');
    await recolherLixoSeguro();
    const depois = await medirDisco(env.STORAGE_LOCAL_PATH || '/');
    if (depois) {
      log.warn({ antes: dados.livre, depois: gb(depois.livreBytes) }, 'espaço depois da limpeza');
    }
  } else if (estado.usadoFracao >= ALERTA) {
    log.warn(dados, 'disco apertado — vale olhar antes que algo quebre por causa disso');
  } else {
    log.debug(dados, 'disco ok');
  }

  return estado;
}

/**
 * Sobe o laço. Devolve a função de parada, no mesmo contrato dos outros
 * agentes.
 *
 * O intervalo é curto de propósito comparado à curadoria: espaço acaba rápido
 * quando um import grande entra, e um aviso de quinze em quinze minutos chega
 * tarde demais para servir de aviso.
 */
export function startArmazenamentoWorker(intervaloMs = 5 * 60_000): () => void {
  let parado = false;
  let timer: NodeJS.Timeout | null = null;

  const volta = async (): Promise<void> => {
    if (parado) return;
    try {
      await verificarArmazenamento();
    } catch (err) {
      log.error({ err }, 'volta do agente de armazenamento falhou');
    }
    if (parado) return;
    timer = setTimeout(() => void volta(), intervaloMs);
    timer.unref();
  };

  log.info({ intervaloMs, alerta: ALERTA, critico: CRITICO }, 'agente de armazenamento de olho');
  void volta();

  return () => {
    parado = true;
    if (timer) clearTimeout(timer);
  };
}
