/**
 * Erro de entrada na rota de busca: 422 com caminho do campo, e erro
 * inesperado vira 500 genérico — sem stack nem mensagem interna no corpo.
 */
import { describe, expect, it, vi } from 'vitest';
import { searchQuerySchema } from '@radinho/shared';
import { errorHandler } from './errorHandler.js';
import { validate } from './validate.js';

function resposta() {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: undefined as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
    end: vi.fn(),
  };
  return res;
}

describe('erros da busca', () => {
  it('parâmetro inválido vira 422 apontando o campo', () => {
    const next = vi.fn();
    validate({ query: searchQuerySchema })(
      { query: { q: '', limit: '999' } } as never,
      {} as never,
      next,
    );
    const err = next.mock.calls[0]?.[0];
    const res = resposta();
    errorHandler(err, { id: 'r1', originalUrl: '/search' } as never, res as never, vi.fn());
    expect(res.statusCode).toBe(422);
    const detalhes = (res.body as { error: { details: Array<{ path: string }> } }).error.details;
    expect(detalhes.map((d) => d.path).sort()).toEqual(['limit', 'q']);
  });

  it('falha inesperada (ex.: banco caiu) não vaza stack nem mensagem', () => {
    const res = resposta();
    const erro = new Error('connect ECONNREFUSED 127.0.0.1:5432 senha=segredo');
    errorHandler(erro, { id: 'r2', originalUrl: '/search?q=a' } as never, res as never, vi.fn());
    expect(res.statusCode).toBe(500);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toContain('ECONNREFUSED');
    expect(texto).not.toContain('segredo');
    expect(texto).not.toContain('at ');
  });
});
