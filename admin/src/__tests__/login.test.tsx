import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, api } from '../api';
import { Login } from '../components/login';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    api: { ...actual.api, login: vi.fn() },
    setToken: vi.fn(),
  };
});

describe('Connexion au back-office', () => {
  it('refuse de soumettre tant que les champs sont incomplets', async () => {
    render(<Login onDone={vi.fn()} />);
    const submit = screen.getByRole('button', { name: 'Se connecter' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Email ou nom d’utilisateur'), 'modo');
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Mot de passe'), 'password123');
    expect(submit).toBeEnabled();
  });

  it('envoie les identifiants et signale une session prête', async () => {
    const onDone = vi.fn();
    vi.mocked(api.login).mockResolvedValue({ accessToken: 'jeton' });
    render(<Login onDone={onDone} />);

    await userEvent.type(screen.getByLabelText('Email ou nom d’utilisateur'), 'modo@e2e.dev');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.login).toHaveBeenCalledWith('modo@e2e.dev', 'password123');
  });

  it('affiche un message clair quand les identifiants sont refusés', async () => {
    vi.mocked(api.login).mockRejectedValue(new ApiError('Unauthorized', 401));
    render(<Login onDone={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Email ou nom d’utilisateur'), 'modo');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants refusés.');
  });
});
