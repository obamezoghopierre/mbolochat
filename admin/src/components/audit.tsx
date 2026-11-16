import React from 'react';

import { ApiError, api, type AuditItem } from '../api';

/** Journal des décisions de modération (append-only côté API). */
export function AuditLog() {
  const [items, setItems] = React.useState<AuditItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async (nextCursor?: string) => {
    setLoading(true);
    try {
      const page = await api.audit(nextCursor);
      setItems((current) => (nextCursor ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <header className="section-head">
        <h2>Journal de modération</h2>
      </header>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {!loading && items.length === 0 ? <p className="muted">Aucune décision enregistrée.</p> : null}

      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Action</th>
            <th>Cible</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{new Date(item.createdAt).toLocaleString('fr-FR')}</td>
              <td>{item.action}</td>
              <td>
                {item.targetType} · {item.targetId.slice(0, 8)}…
              </td>
              <td>{item.notes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {cursor ? (
        <button type="button" className="secondary" onClick={() => void load(cursor)}>
          Charger plus
        </button>
      ) : null}
    </section>
  );
}
