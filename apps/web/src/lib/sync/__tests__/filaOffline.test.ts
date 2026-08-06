/**
 * A CURTIDA NÃO PODE DEPENDER DO SERVIDOR ESTAR DE PÉ.
 *
 * O pedido foi direto: servidor fora do ar, a curtida (e tudo mais) fica
 * guardada e sobe sozinha depois. Três decisões desse desenho podem quebrar em
 * silêncio, e são elas que estes testes travam:
 *
 *  1. A escrita entra na fila ANTES de tentar a rede. Enfileirar só o que falhou
 *     perderia justamente a escrita que estava em voo quando a aba fechou.
 *  2. Uma entrada por item, a última vence. Curtir e descurtir cinco vezes
 *     offline é UMA escrita quando o servidor voltar, não cinco.
 *  3. Confirmar remove só o que subiu. Limpar a fila inteira apagaria a escrita
 *     que entrou enquanto o lote viajava — sem nunca a ter enviado.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import * as fila from '@/lib/sync/filaOffline';

async function limpar(): Promise<void> {
  await fila.confirmar((await fila.pendentes()).map((p) => p.chave));
}

describe('fila de escritas offline', () => {
  beforeEach(async () => {
    await limpar();
  });

  it('guarda a escrita mesmo sem nenhuma rede envolvida', async () => {
    await fila.enfileirar('likes', 'faixa-1', 'gravar', { curtida: true });

    const pendentes = await fila.pendentes();
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0]).toMatchObject({
      colecao: 'likes',
      id: 'faixa-1',
      operacao: 'gravar',
      data: { curtida: true },
    });
  });

  // ── a rajada offline ─────────────────────────────────────────────────────

  it('curtir e descurtir várias vezes vira UMA escrita — a última vence', async () => {
    await fila.enfileirar('likes', 'faixa-1', 'gravar', { v: 1 });
    await fila.enfileirar('likes', 'faixa-1', 'apagar');
    await fila.enfileirar('likes', 'faixa-1', 'gravar', { v: 2 });

    const pendentes = await fila.pendentes();
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0]?.operacao).toBe('gravar');
    expect(pendentes[0]?.data).toEqual({ v: 2 });
  });

  it('itens diferentes não se atropelam', async () => {
    await fila.enfileirar('likes', 'a', 'gravar', {});
    await fila.enfileirar('likes', 'b', 'apagar');
    expect(await fila.quantasPendentes()).toBe(2);
  });

  it('coleções diferentes com o mesmo id não se atropelam', async () => {
    // "library/faixa-1" e "likes/faixa-1" são coisas distintas.
    await fila.enfileirar('library', 'faixa-1', 'gravar', { onde: 'biblioteca' });
    await fila.enfileirar('likes', 'faixa-1', 'gravar', { onde: 'curtidas' });
    expect(await fila.quantasPendentes()).toBe(2);
  });

  it('apagar não carrega corpo — não há o que gravar', async () => {
    await fila.enfileirar('likes', 'a', 'apagar');
    expect((await fila.pendentes())[0]?.data).toBeUndefined();
  });

  // ── confirmação ──────────────────────────────────────────────────────────

  it('confirmar tira só o que subiu, nunca o que entrou depois', async () => {
    await fila.enfileirar('likes', 'a', 'gravar', {});
    await fila.enfileirar('likes', 'b', 'gravar', {});
    const lote = await fila.pendentes();

    // Simula uma escrita nova entrando ENQUANTO o lote viajava.
    await fila.enfileirar('likes', 'c', 'gravar', {});
    await fila.confirmar(lote.map((p) => p.chave));

    const sobrou = await fila.pendentes();
    expect(sobrou.map((p) => p.id)).toEqual(['c']);
  });

  it('confirmar nada não apaga nada', async () => {
    await fila.enfileirar('likes', 'a', 'gravar', {});
    await fila.confirmar([]);
    expect(await fila.quantasPendentes()).toBe(1);
  });

  it('a ordem é a de chegada — mais antigo sobe primeiro', async () => {
    await fila.enfileirar('likes', 'primeiro', 'gravar', {});
    await new Promise((r) => setTimeout(r, 2));
    await fila.enfileirar('likes', 'segundo', 'gravar', {});
    expect((await fila.pendentes()).map((p) => p.id)).toEqual(['primeiro', 'segundo']);
  });
});
