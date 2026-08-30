/**
 * O acervo inteiro do app chega por UMA chamada à API. Quando ela vai pelo
 * caminho relativo em produção, o pedido sai por um IP de datacenter da Vercel
 * (rewrite do `vercel.json`) e o Cloudflare do servidor responde com a página
 * de desafio "Just a moment..." — 403. Resultado medido no ar: Home sem uma
 * faixa sequer, nada para tocar.
 *
 * Estes testes prendem as três respostas que importam: produção vai DIRETO ao
 * servidor, desenvolvimento continua no proxy do Vite, e `VITE_API_URL` manda
 * em qualquer um dos dois.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const API_DIRETA = 'https://aurial-api.nexusholding.xyz/api/v1';

/** O módulo decide a base no import — cada caso precisa de uma carga limpa. */
async function carregarCom(hostname: string, viteApiUrl?: string): Promise<string> {
  vi.resetModules();
  if (viteApiUrl === undefined) vi.stubEnv('VITE_API_URL', '');
  else vi.stubEnv('VITE_API_URL', viteApiUrl);
  vi.stubGlobal('window', { ...window, location: { ...window.location, hostname } });
  const { API_BASE_URL } = await import('@/lib/apiBase');
  return API_BASE_URL;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('API_BASE_URL', () => {
  it('em produção fala DIRETO com o servidor — o rewrite leva 403 do Cloudflare', async () => {
    await expect(carregarCom('aurial.vercel.app')).resolves.toBe(API_DIRETA);
    await expect(carregarCom('radinho.online')).resolves.toBe(API_DIRETA);
  });

  it('em desenvolvimento continua na mesma origem (proxy do Vite)', async () => {
    await expect(carregarCom('localhost')).resolves.toBe('/api/v1');
    await expect(carregarCom('127.0.0.1')).resolves.toBe('/api/v1');
  });

  it('VITE_API_URL absoluta manda em tudo, e sem barra no fim', async () => {
    await expect(carregarCom('aurial.vercel.app', 'https://outro.exemplo/api/v1/')).resolves.toBe(
      'https://outro.exemplo/api/v1',
    );
    await expect(carregarCom('localhost', 'http://localhost:4000/api/v1')).resolves.toBe(
      'http://localhost:4000/api/v1',
    );
  });

  it('VITE_API_URL RELATIVA nao reintroduz o salto que toma 403', async () => {
    // `VITE_API_URL=/api/v1` esta gravado no `.env.production.local` da maquina
    // e pode estar nas variaveis da Vercel. Obedecer a ele em producao seria
    // embarcar o conserto e continuar sem musica nenhuma.
    await expect(carregarCom('radinho.online', '/api/v1')).resolves.toBe(API_DIRETA);
    await expect(carregarCom('localhost', '/api/v1')).resolves.toBe('/api/v1');
  });
});
