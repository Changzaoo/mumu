import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SobreOArtista } from '@/components/media/SobreOArtista';

describe('SobreOArtista', () => {
  it('mostra foto, ouvintes e a bio cortada que abre no clique', async () => {
    render(
      <SobreOArtista
        name="Anitta"
        imageUrl="https://exemplo.test/anitta.jpg"
        stat="12 mi ouvintes mensais"
        text="Anitta é uma cantora brasileira."
      />,
    );
    expect(screen.getByRole('heading', { name: 'Sobre o artista' })).toBeInTheDocument();
    expect(screen.getByAltText('Foto de Anitta')).toHaveAttribute(
      'src',
      'https://exemplo.test/anitta.jpg',
    );
    expect(screen.getByText('12 mi ouvintes mensais')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { expanded: false });
    expect(screen.getByText(/cantora brasileira/)).toHaveClass('line-clamp-3');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/cantora brasileira/)).not.toHaveClass('line-clamp-3');
  });

  it('sem número não inventa "0 ouvintes"', () => {
    render(<SobreOArtista name="X" text="Bio." stat={null} />);
    expect(screen.queryByText(/ouvintes/)).toBeNull();
  });
});
