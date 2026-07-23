import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SeekSlider } from '@/components/media/SeekSlider';

describe('SeekSlider', () => {
  it('não trava o relógio em 0:01 quando a duração ainda é desconhecida', () => {
    render(<SeekSlider value={37} duration={0} buffered={0} onSeek={vi.fn()} />);
    expect(screen.getByText('0:37')).toBeInTheDocument();
    expect(screen.getAllByText('0:00')).toHaveLength(1);
  });
});
