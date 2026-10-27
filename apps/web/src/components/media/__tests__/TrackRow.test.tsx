import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('@/lib/audio/AudioEngine', () => ({
  audioEngine: {
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setRate: vi.fn(),
    preloadNext: vi.fn(),
    setEq: vi.fn(),
    setNormalizeVolume: vi.fn(),
    getPosition: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getBufferedEnd: vi.fn(() => 0),
    on: vi.fn(() => () => undefined),
    analyser: null,
  },
  AudioEngine: class {},
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
  buildQuery: () => '',
  resolveMediaUrl: (url: string) => url,
}));

import { TrackRow } from '@/components/media/TrackRow';
import { makeTrack } from '@/test/factories';
import { useSettingsStore } from '@/stores/settingsStore';

function renderRow(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TrackRow', () => {
  it('renders index, title, artist, album and duration', () => {
    const track = makeTrack('t1', { durationMs: 225_000 });
    renderRow(<TrackRow track={track} index={4} />);

    expect(screen.getByText('5')).toBeInTheDocument(); // index + 1
    expect(screen.getByText('Track t1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Artist t1' })).toHaveAttribute(
      'href',
      '/artist/artist-t1',
    );
    expect(screen.getByRole('link', { name: 'Album t1' })).toHaveAttribute(
      'href',
      '/album/album-t1',
    );
    expect(screen.getByText('3:45')).toBeInTheDocument();
  });

  it('calls onPlay from the hover play button', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const track = makeTrack('t2');
    renderRow(<TrackRow track={track} index={0} onPlay={onPlay} />);

    await user.click(screen.getByRole('button', { name: 'Reproduzir Track t2' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('plays when clicking the track title', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const track = makeTrack('t2b');
    renderRow(<TrackRow track={track} index={0} onPlay={onPlay} />);

    await user.click(screen.getByRole('button', { name: 'Track t2b' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('mostra o selo "E" quando a faixa é explícita e esconde quando não é', () => {
    renderRow(<TrackRow track={makeTrack('e1', { explicit: true })} index={0} />);
    expect(screen.getByLabelText('Conteúdo explícito')).toHaveTextContent('E');
  });

  it('título com palavrão acende o selo mesmo sem veredito gravado', () => {
    // Adulto: senão a faixa explícita nem aparece na lista (regra da idade).
    useSettingsStore.setState({ dataNascimento: '1990-01' });
    renderRow(<TrackRow track={makeTrack('e2', { title: 'Foda-se o mundo' })} index={0} />);
    expect(screen.getByLabelText('Conteúdo explícito')).toBeInTheDocument();
  });

  it('faixa limpa não tem selo', () => {
    renderRow(<TrackRow track={makeTrack('e3')} index={0} />);
    expect(screen.queryByLabelText('Conteúdo explícito')).not.toBeInTheDocument();
  });

  it('marks the active row with accent styling and exposes the row label', () => {
    const track = makeTrack('t3');
    renderRow(<TrackRow track={track} index={0} active playing />);

    const row = screen.getByRole('listitem', { name: 'Track t3 — Artist t3' });
    expect(row).toBeInTheDocument();
    expect(screen.getByText('Track t3')).toHaveClass('text-accent');
  });
});
