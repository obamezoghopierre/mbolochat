import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, type ReportItem } from '../api';
import { ReportQueue } from '../components/report-queue';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, api: { ...actual.api, reports: vi.fn(), decide: vi.fn() } };
});

function report(overrides: Partial<ReportItem> = {}): ReportItem {
  return {
    id: 'report-1',
    targetType: 'publication',
    targetId: 'pub-1',
    reason: 'spam',
    details: 'Publicité répétée',
    status: 'open',
    createdAt: new Date('2026-11-16T10:00:00Z').toISOString(),
    reporter: { id: 'u1', username: 'rapporteur', displayName: 'Rapporteur' },
    targetPreview: 'Achetez mes produits',
    targetAuthorId: 'u2',
    ...overrides,
  };
}

describe('File de signalements', () => {
  beforeEach(() => {
    vi.mocked(api.reports).mockReset();
    vi.mocked(api.decide).mockReset();
  });

  it('affiche l’aperçu, le motif et le rapporteur', async () => {
    vi.mocked(api.reports).mockResolvedValue({ items: [report()], nextCursor: null });
    render(<ReportQueue />);

    expect(await screen.findByText('Achetez mes produits')).toBeInTheDocument();
    expect(screen.getByText('Spam')).toBeInTheDocument();
    expect(screen.getByText(/@rapporteur/)).toBeInTheDocument();
  });

  it('envoie la décision puis recharge la file', async () => {
    vi.mocked(api.reports).mockResolvedValue({ items: [report()], nextCursor: null });
    vi.mocked(api.decide).mockResolvedValue({ status: 'resolved' });
    render(<ReportQueue />);

    const card = (await screen.findByText('Achetez mes produits')).closest('li');
    expect(card).not.toBeNull();
    await userEvent.click(within(card!).getByRole('button', { name: 'Masquer' }));

    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('report-1', 'hide'));
    await waitFor(() => expect(api.reports).toHaveBeenCalledTimes(2));
  });

  it('n’autorise pas à rejouer une décision sur un dossier clos, sauf restauration', async () => {
    vi.mocked(api.reports).mockResolvedValue({
      items: [report({ status: 'resolved' })],
      nextCursor: null,
    });
    render(<ReportQueue />);

    const card = (await screen.findByText('Achetez mes produits')).closest('li');
    const buttons = within(card!).getAllByRole('button');
    const byName = (name: string) => buttons.find((button) => button.textContent === name)!;

    expect(byName('Masquer')).toBeDisabled();
    expect(byName('Retirer')).toBeDisabled();
    expect(byName('Restaurer')).toBeEnabled();
    expect(byName('Rejeter')).toBeDisabled();
  });

  it('propose de charger la page suivante quand un curseur existe', async () => {
    vi.mocked(api.reports)
      .mockResolvedValueOnce({ items: [report()], nextCursor: 'curseur-1' })
      .mockResolvedValueOnce({ items: [report({ id: 'report-2', targetPreview: 'Second' })], nextCursor: null });
    render(<ReportQueue />);

    await userEvent.click(await screen.findByRole('button', { name: 'Charger plus' }));
    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(api.reports).toHaveBeenLastCalledWith('open', 'curseur-1');
  });
});
