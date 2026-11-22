import React from 'react';

import { ApiError, api, type FlaggedItem } from '../api';

const FORMATS: Record<FlaggedItem['format'], string> = {
  text: 'Texte',
  image: 'Photo',
  carousel: 'Carrousel',
  video: 'Vidéo',
};

const VISIBILITY: Record<FlaggedItem['visibility'], string> = {
  public: 'Public',
  followers: 'Abonnés',
  private: 'Privé',
};

/**
 * File « À valider » : publications mises en revue (mot bloqué ou masquées),
 * qu'elles aient été signalées ou non. Publier rend le post visible et envoie
 * ses mentions ; Retirer le supprime avec ses médias.
 */
export function FlaggedQueue() {
  const [items, setItems] = React.useState<FlaggedItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async (nextCursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.flagged(nextCursor);
      setItems((current) => (nextCursor ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const decide = async (item: FlaggedItem, decision: 'approve' | 'remove') => {
    if (decision === 'remove' && !window.confirm('Retirer définitivement cette publication ?')) {
      return;
    }
    setBusyId(item.id);
    setError(null);
    try {
      await api.decideFlagged(item.id, decision);
      // Retrait local immédiat : la file ne recharge pas tout pour une ligne.
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Décision impossible.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <header className="section-head">
        <h2>À valider</h2>
        <button type="button" className="secondary" onClick={() => void load()}>
          Actualiser
        </button>
      </header>

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      {loading && items.length === 0 ? <p className="muted">Chargement…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="muted">Aucune publication en attente de validation.</p>
      ) : null}

      <ul className="reports">
        {items.map((item) => (
          <li key={item.id} className="card report">
            <div className="report__head">
              <span className="badge">{FORMATS[item.format] ?? item.format}</span>
              <span className="badge badge--muted">{VISIBILITY[item.visibility]}</span>
              {item.openReports > 0 ? (
                <span className="badge badge--muted">
                  {item.openReports} signalement{item.openReports > 1 ? 's' : ''}
                </span>
              ) : null}
              <time dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString('fr-FR')}
              </time>
            </div>
            <p className="report__preview">
              {item.preview ?? <span className="muted">Publication sans texte</span>}
            </p>
            <p className="muted">
              Par @{item.author.username} ({item.author.displayName})
            </p>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={busyId === item.id}
                onClick={() => void decide(item, 'approve')}>
                Publier
              </button>
              <button
                type="button"
                className="danger"
                disabled={busyId === item.id}
                onClick={() => void decide(item, 'remove')}>
                Retirer
              </button>
            </div>
          </li>
        ))}
      </ul>

      {cursor ? (
        <button type="button" className="secondary" onClick={() => void load(cursor)}>
          Charger plus
        </button>
      ) : null}
    </section>
  );
}
