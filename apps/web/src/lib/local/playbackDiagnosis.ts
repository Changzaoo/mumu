/**
 * Por que ESTA faixa não toca — medido, não deduzido.
 *
 * Existe porque três "consertos" seguidos foram entregues sem verificação: eu
 * não tenho acesso ao armazenamento do navegador do usuário, escolhi a causa
 * mais provável e anunciei como resolvida. Quando o sintoma é sempre o mesmo
 * ("indisponível") e a cadeia que leva até ele tem seis elos, adivinhar qual
 * rompeu é chute com cara de diagnóstico.
 *
 * A cadeia que o player percorre para uma faixa importada (playerStore.ts,
 * `ensurePlayableSource`):
 *   object URL desta sessão → bytes no cofre local → cópia enviada ao
 *   importador (remoteUrl) → stream ao vivo do link de origem
 * Se os quatro falham, a faixa é declarada indisponível — sem dizer qual falhou.
 *
 * Este módulo percorre a MESMA cadeia e relata cada elo separadamente, então a
 * próxima correção parte de evidência.
 */
import { getIdToken } from '@/lib/firebase';
import { entryFor, hasStoredAudio, localAudioUrl } from '@/lib/local/localLibrary';
import { buildStreamUrl, helperUrl, ultimaFalhaDeUpload } from '@/lib/local/importerHelper';

export interface Elo {
  etapa: string;
  ok: boolean;
  detalhe: string;
}

/** Uma URL responde com áudio? Pede só o primeiro byte: confirmar que a fonte
 *  existe não deve custar o download da música inteira. */
async function respondeAudio(url: string): Promise<{ ok: boolean; detalhe: string }> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    if (!res.ok && res.status !== 206) return { ok: false, detalhe: `HTTP ${res.status}` };
    const tipo = res.headers.get('content-type') ?? '(sem tipo)';
    return { ok: true, detalhe: `HTTP ${res.status}, ${tipo}` };
  } catch (err) {
    // Falha de rede e bloqueio de CORS chegam iguais aqui — o navegador não
    // deixa distinguir. Vale registrar a diferença para não interpretar demais.
    return { ok: false, detalhe: `sem resposta (rede ou CORS): ${(err as Error).message}` };
  }
}

/** Percorre a cadeia inteira para uma faixa e devolve o resultado de cada elo. */
export async function diagnosticarFaixa(id: string): Promise<Elo[]> {
  const elos: Elo[] = [];
  const entry = entryFor(id);

  if (!entry) {
    return [{ etapa: 'registro', ok: false, detalhe: 'faixa não está no registro local' }];
  }
  elos.push({
    etapa: 'registro',
    ok: true,
    detalhe: `"${entry.track.title}" · ${entry.sizeBytes ?? 0} bytes declarados`,
  });

  elos.push({
    etapa: 'object URL (sessão)',
    ok: Boolean(localAudioUrl(id)),
    detalhe: localAudioUrl(id) ? 'presente' : 'ausente — normal após recarregar',
  });

  const noCofre = await hasStoredAudio(id);
  elos.push({
    etapa: 'bytes no cofre local',
    ok: noCofre,
    detalhe: noCofre ? 'áudio gravado neste aparelho' : 'NÃO há áudio gravado neste aparelho',
  });

  if (entry.remoteUrl) {
    const r = await respondeAudio(entry.remoteUrl);
    elos.push({ etapa: 'cópia enviada (remoteUrl)', ...r });
  } else {
    // Este é o elo que decide se a faixa toca nos OUTROS aparelhos. Sem ele,
    // o aparelho que importou continua tocando (tem os bytes) e todo o resto
    // fica mudo — o sintoma "toca no PC, não toca no celular".
    elos.push({
      etapa: 'cópia enviada (remoteUrl)',
      ok: false,
      detalhe: ultimaFalhaDeUpload
        ? `nunca enviada — última falha: ${ultimaFalhaDeUpload}`
        : 'a faixa nunca foi enviada ao importador',
    });
  }

  if (entry.sourceUrl) {
    const stream = await buildStreamUrl(entry.sourceUrl).catch(() => null);
    if (!stream) {
      elos.push({
        etapa: 'stream da origem',
        ok: false,
        detalhe: 'não foi possível montar a URL (login do Firebase indisponível?)',
      });
    } else {
      const r = await respondeAudio(stream);
      elos.push({ etapa: 'stream da origem', ...r });
    }
  } else {
    elos.push({ etapa: 'stream da origem', ok: false, detalhe: 'faixa sem link de origem' });
  }

  return elos;
}

/** Contexto que vale junto: sem login ou sem importador, metade da cadeia cai. */
async function diagnosticarAmbiente(): Promise<Elo[]> {
  const elos: Elo[] = [];
  const token = await getIdToken().catch(() => null);
  elos.push({
    etapa: 'login (token Firebase)',
    ok: Boolean(token),
    detalhe: token ? 'válido' : 'AUSENTE — bloqueia envio e stream',
  });
  try {
    const res = await fetch(`${helperUrl()}/health`);
    const body = (await res.json()) as { caps?: unknown };
    elos.push({
      etapa: 'importador',
      ok: res.ok,
      detalhe: `HTTP ${res.status} · caps=${JSON.stringify(body?.caps ?? null)}`,
    });
  } catch (err) {
    elos.push({
      etapa: 'importador',
      ok: false,
      detalhe: `inacessível: ${(err as Error).message}`,
    });
  }
  elos.push({
    etapa: 'conexão',
    ok: typeof navigator === 'undefined' || navigator.onLine,
    detalhe: typeof navigator !== 'undefined' && !navigator.onLine ? 'OFFLINE' : 'online',
  });
  return elos;
}

function formatar(titulo: string, elos: readonly Elo[]): string {
  const linhas = elos.map((e) => `  ${e.ok ? '✓' : '✗'} ${e.etapa}: ${e.detalhe}`);
  return [titulo, ...linhas].join('\n');
}

/**
 * Relatório pronto para copiar e colar. Diagnostica o ambiente e as primeiras
 * faixas sem áudio local — que são exatamente as que aparecem "indisponível".
 */
export async function relatorioDeReproducao(limite = 5): Promise<string> {
  const { tracksMissingAudio } = await import('@/lib/local/localLibrary');
  const partes = [formatar('AMBIENTE', await diagnosticarAmbiente())];

  const mudas = tracksMissingAudio().slice(0, limite);
  if (!mudas.length) {
    partes.push('\nTodas as faixas do registro têm áudio nesta sessão.');
  } else {
    for (const e of mudas) {
      partes.push('\n' + formatar(`FAIXA ${e.track.title}`, await diagnosticarFaixa(e.track.id)));
    }
  }
  return partes.join('\n');
}

/**
 * Publica o diagnóstico no console do navegador.
 *
 * É o caminho mais curto entre o problema do usuário e a evidência: ele abre o
 * console, roda uma linha e cola o resultado — sem precisar navegar por menu
 * nenhum enquanto está com raiva do app.
 */
export function instalarDiagnostico(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>).aurialDiagnostico = async (): Promise<string> => {
    const texto = await relatorioDeReproducao();
    // eslint-disable-next-line no-console
    console.log(texto);
    return texto;
  };
}
