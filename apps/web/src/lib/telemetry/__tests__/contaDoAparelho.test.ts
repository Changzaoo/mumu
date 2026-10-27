import { describe, expect, it } from 'vitest';
import { chaveDaConta, identidadeDoGrupo } from '@/lib/telemetry/contaDoAparelho';

// O caso real de 27/10/2026: três aparelhos da mesma conta; o iPhone (PWA
// instalado) abriu deslogado e gravou email: null.
const CONTA = 'cmshssgk90000o601lk5fc597';
const windows = { uid: CONTA, email: 'dono@gmail.com', displayName: 'Dono' };
const android = { uid: CONTA, email: 'dono@gmail.com', displayName: 'Dono' };
const iphone = { uid: CONTA, email: null, displayName: null };

describe('chaveDaConta', () => {
  it('aparelho vinculado à conta agrupa pelo userId, mesmo sem e-mail no documento', () => {
    expect(chaveDaConta(iphone)).toBe(chaveDaConta(windows));
    expect(chaveDaConta(android)).toBe(chaveDaConta(windows));
  });

  it('documento antigo sem vínculo ainda agrupa pelo e-mail, sem distinguir maiúsculas', () => {
    expect(chaveDaConta({ uid: 'anon:a1', email: 'Dono@Gmail.com' })).toBe(
      chaveDaConta({ uid: 'anon:b2', email: 'dono@gmail.com' }),
    );
  });

  it('anônimo sem e-mail não agrupa com ninguém', () => {
    expect(chaveDaConta({ uid: 'anon:a1', email: null })).not.toBe(
      chaveDaConta({ uid: 'anon:b2', email: null }),
    );
  });
});

describe('identidadeDoGrupo', () => {
  it('o iPhone deslogado visto por último herda o e-mail e o nome dos outros aparelhos', () => {
    expect(identidadeDoGrupo([iphone, windows, android], iphone)).toEqual({
      email: 'dono@gmail.com',
      displayName: 'Dono',
    });
  });

  it('o representante com identidade própria não é sobrescrito', () => {
    expect(
      identidadeDoGrupo(
        [{ uid: CONTA, email: 'outro@x.com', displayName: 'Outro' }, windows],
        windows,
      ),
    ).toEqual({ email: 'dono@gmail.com', displayName: 'Dono' });
  });

  it('grupo sem identidade nenhuma fica nulo (vira "Usuário" no painel)', () => {
    expect(identidadeDoGrupo([iphone], iphone)).toEqual({ email: null, displayName: null });
  });
});
