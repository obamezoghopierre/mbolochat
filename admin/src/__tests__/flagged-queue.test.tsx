import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, type FlaggedItem } from '../api';
import { FlaggedQueue } from '../components/flagged-queue';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, api: { ...actual.api, flagged: vi.fn(), decideFlagged: vi.fn() } };
});

function flagged(overrides: Partial<FlaggedItem> = {}): FlaggedItem {
  return {
    id: 'pub-1',
    format: 'text',
    visibility: 'public',
    createdAt: new Date('2026-11-16T10:00:00Z').toISOString(),
    author: { id: 'u1', username: 'auteure', displayName: 'Auteure' },
    preview: 'Texte en attente',
    openReports: 0,
    ...overrides,
  };
}

describe('File « À valider »', () => {
  beforeEach(() => {
    vi.mocked(api.flagged).mockReset();
    vi.mocked(api.decideFlagged).mockReset();
  });

  it('affiche les publications en revue, même sans signalement', async () => {
    vi.mocked(api.flagged).mockResolvedValue({
      items: [flagged(), flagged({ id: 'pub-2', preview: 'Signalée', openReports: 2 })],
      nextCursor: null,
    });
    render(<FlaggedQueue />);

    expect(await screen.findByText('Texte en attente')).toBeInTheDocument();
    expect(screen.getByText('2 signalements')).toBeInTheDocument();
    expect(screen.getAllByText(/@auteure/)).toHaveLength(2);
  });

  it('publie puis retire la ligne de la file', async () => {
    vi.mocked(api.flagged).mockResolvedValue({ items: [flagged()], nextCursor: null });
    vi.mocked(api.decideFlagged).mockResolvedValue({ moderationStatus: 'approved' });
    render(<FlaggedQueue />);

    const card = (await screen.findByText('Texte en attente')).closest('li');
    await userEvent.click(within(card!).getByRole('button', { name: 'Publier' }));

    await waitFor(() => expect(api.decideFlagged).toHaveBeenCalledWith('pub-1', 'approve'));
    await waitFor(() => expect(screen.queryByText('Texte en attente')).not.toBeInTheDocument());
  });

  it('demande confirmation avant de retirer', async () => {
    vi.mocked(api.flagged).mockResolvedValue({ items: [flagged()], nextCursor: null });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<FlaggedQueue />);

    const card = (await screen.findByText('Texte en attente')).closest('li');
    await userEvent.click(within(card!).getByRole('button', { name: 'Retirer' }));

    expect(confirm).toHaveBeenCalled();
    expect(api.decideFlagged).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
