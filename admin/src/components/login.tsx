import React from 'react';

import { ApiError, api, setToken } from '../api';

/** Connexion : mêmes identifiants que l'application, puis contrôle du rôle. */
export function Login({ onDone }: { onDone: () => void }) {
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(identifier.trim(), password);
      setToken(result.accessToken);
      onDone();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 401
          ? 'Identifiants refusés.'
          : 'Connexion impossible. Vérifie que l’API est démarrée.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="card login__card" onSubmit={submit}>
        <h1>MboloChat — Modération</h1>
        <p className="muted">Réservé aux rôles modérateur et administrateur.</p>
        <label>
          Email ou nom d’utilisateur
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            minLength={8}
          />
        </label>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy || identifier.trim().length < 3 || password.length < 8}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </main>
  );
}
