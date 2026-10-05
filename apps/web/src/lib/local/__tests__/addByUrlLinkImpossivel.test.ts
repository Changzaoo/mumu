/**
 * `addByUrl` recusa link impossível com status 400 — a língua que a fila
 * entende como defeito PERMANENTE do link (ver linkRuimNaoTravaAFila.test.ts).
 * Sem isso, link colado errado era retentado 5x, recuperado 3x e ainda somava no
 * breaker que pausa a fila inteira.
 */
import { describe, expect, it } from 'vitest';
import { addByUrl } from '@/lib/local/localLibrary';

describe('addByUrl recusa link impossível com status 400 (permanente na fila)', () => {
  it.each([
    ['texto que não é link', 'isso nao e um link'],
    ['protocolo que não é http', 'ftp://exemplo.com/a.mp3'],
    ['serviço que não importamos', 'https://podcasters.spotify.com/pod/show/x'],
  ])('%s', async (_nome, url) => {
    const erro = await addByUrl(url).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as { status?: number }).status).toBe(400);
  });
});
