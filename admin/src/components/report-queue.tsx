import React from 'react';

import { ApiError, api, type ReportItem } from '../api';

const REASONS: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harcèlement',
  hate: 'Haine',
  nudity: 'Nudité',
  violence: 'Violence',
  misinformation: 'Désinformation',
  other: 'Autre',
};

const TARGETS: Record<string, string> = {
  publication: 'Publication',
  comment: 'Commentaire',
  story: 'Story',
  user: 'Compte',
};

const ACTIONS = [
  { action: 'hide', label: 'Masquer' },
  { action: 'remove', label: 'Retirer' },
  { action: 'restore', label: 'Restaurer' },
  { action: 'warn', label: 'Avertir' },
  { action: 'dismiss', label: 'Rejeter' },
] as const;

/**
 * File de signalements. Une décision est appliquée côté API dans une
 * transaction (cible + dossier + audit) : l'interface recharge ensuite la file.
 */
export function ReportQueue() {
  const [status, setStatus] = React.useState('open');
  const [items, setItems] = React.useState<ReportItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (nextStatus = status, nextCursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.reports(nextStatus, nextCursor);
        setItems((current) => (nextCursor ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Chargement impossible.');
      } finally {
        setLoading(false);
      }
    },
    [status],
  );

  React.useEffect(() => {
    void load(status);
  }, [load, status]);

  const decide = async (report: ReportItem, action: string) => {
    if (action === 'remove' && !window.confirm('Retirer définitivement ce contenu ?')) {
      return;
    }
    setBusyId(report.id);
    setError(null);
    try {
      await api.decide(report.id, action);
      await load(status);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Décision impossible.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <header className="section-head">
        <h2>Signalements</h2>
        <div className="filters" role="group" aria-label="Statut des signalements">
          {['open', 'reviewing', 'resolved', 'dismissed'].map((value) => (
            <button
              key={value}
              type="button"
              className={value === status ? 'chip chip--active' : 'chip'}
              onClick={() => setStatus(value)}>
              {
                {
                  open: 'Ouverts',
                  reviewing: 'En cours',
                  resolved: 'Traités',
                  dismissed: 'Rejetés',
                }[value]
              }
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      {loading && items.length === 0 ? <p className="muted">Chargement…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="muted">Aucun signalement dans cette catégorie.</p>
      ) : null}

      <ul className="reports">
        {items.map((report) => (
          <li key={report.id} className="card report">
            <div className="report__head">
              <span className="badge">{TARGETS[report.targetType] ?? report.targetType}</span>
              <span className="badge badge--muted">{REASONS[report.reason] ?? report.reason}</span>
              <time dateTime={report.createdAt}>
                {new Date(report.createdAt).toLocaleString('fr-FR')}
              </time>
            </div>
            <p className="report__preview">
              {report.targetPreview ?? <span className="muted">Contenu indisponible</span>}
            </p>
            {report.details ? <p className="muted">Motif : {report.details}</p> : null}
            <p className="muted">
              Signalé par{' '}
              {report.reporter ? `@${report.reporter.username}` : 'un compte supprimé'}
            </p>
            <div className="actions">
              {ACTIONS.map((entry) => (
                <button
                  key={entry.action}
                  type="button"
                  className={entry.action === 'remove' ? 'danger' : 'secondary'}
                  disabled={
                    busyId === report.id ||
                    (report.status !== 'open' && entry.action !== 'restore')
                  }
                  onClick={() => void decide(report, entry.action)}>
                  {entry.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {cursor ? (
        <button type="button" className="secondary" onClick={() => void load(status, cursor)}>
          Charger plus
        </button>
      ) : null}
    </section>
  );
}
