import React from 'react';

import { ApiError, api } from '../api';

interface Row {
  id: string;
  username: string;
  displayName: string;
  role: string;
  verified: boolean;
  privateAccount: boolean;
  createdAt: string;
}

/** Recherche de comptes pour retrouver un auteur signalé. */
export function UserSearch() {
  const [query, setQuery] = React.useState('');
  const [rows, setRows] = React.useState<Row[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRows(await api.users(query.trim()));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Recherche impossible.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section>
      <header className="section-head">
        <h2>Comptes</h2>
      </header>
      <form className="search" onSubmit={search}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Pseudo ou nom affiché"
          aria-label="Rechercher un compte"
        />
        <button type="submit" disabled={loading || query.trim().length < 2}>
          Rechercher
        </button>
      </form>

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {!loading && rows.length === 0 ? <p className="muted">Aucun résultat.</p> : null}

      {rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Pseudo</th>
              <th>Nom</th>
              <th>Rôle</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>@{row.username}</td>
                <td>{row.displayName}</td>
                <td>{row.role}</td>
                <td>
                  {row.privateAccount ? 'Privé' : 'Public'}
                  {row.verified ? ' · vérifié' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
