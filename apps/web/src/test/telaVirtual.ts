/**
 * jsdom não faz layout: todo elemento mede 0×0 e o virtualizador não monta
 * linha nenhuma. Este helper dá à área rolável do `VirtualList` (a caixa
 * própria, `overflow-y-auto`) o tamanho da tela de um Moto G34 (360×800),
 * como o navegador de verdade daria. As linhas (`data-index`) medem
 * `alturaDaLinha`.
 */
export function telaDoMotoG34(alturaDaLinha = 60): void {
  const medida = (eixo: 'offsetWidth' | 'offsetHeight', valor: number): void => {
    Object.defineProperty(HTMLElement.prototype, eixo, {
      configurable: true,
      get(this: HTMLElement) {
        if (this.className.includes('overflow-y-auto')) return valor;
        // Linhas medidas (`dynamic`): sem altura, colapsam a 0, mais linhas
        // cabem na janela e o ciclo não termina — coisa que só jsdom faz.
        if (eixo === 'offsetHeight' && this.hasAttribute('data-index')) return alturaDaLinha;
        return 0;
      },
    });
  };
  medida('offsetWidth', 360);
  medida('offsetHeight', 800);
}
