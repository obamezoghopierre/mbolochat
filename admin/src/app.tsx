import React from 'react';

import { ApiError, api, clearToken, getToken, type AdminUser } from './api';
import { AuditLog } from './components/audit';
import { FlaggedQueue } from './components/flagged-queue';
import { Login } from './components/login';
import { ReportQueue } from './components/report-queue';
import { UserSearch } from './components/users';
import { BlockedWords } from './components/words';

type Section = 'reports' | 'flagged' | 'users' | 'words' | 'audit';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'reports', label: 'Signalements' },
  { id: 'flagged', label: 'À valider' },
  { id: 'users', label: 'Comptes' },
  { id: 'words', label: 'Mots bloqués' },
  { id: 'audit', label: 'Journal' },
];

export function App() {
  const [user, setUser] = React.useState<AdminUser | null>(null);
  const [checking, setChecking] = React.useState(Boolean(getToken()));
  const [section, setSection] = React.useState<Section>('reports');
  const [error, setError] = React.useState<string | null>(null);

  const loadSession = React.useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const me = await api.me();
      if (me.role !== 'moderator' && me.role !== 'admin') {
        clearToken();
        setUser(null);
        setError('Ce compte n’a pas accès à la modération.');
      } else {
        setUser(me);
      }
    } catch (cause) {
      clearToken();
      setUser(null);
      if (!(cause instanceof ApiError && cause.status === 401)) {
        setError('Session expirée ou API indisponible.');
      }
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSession();
  }, [loadSession]);

  if (checking) {
    return (
      <main className="login">
        <p className="muted">Vérification de la session…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <>
        {error ? (
          <p role="alert" className="error error--standalone">
            {error}
          </p>
        ) : null}
        <Login onDone={() => void loadSession()} />
      </>
    );
  }

  const logout = () => {
    clearToken();
    setUser(null);
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <p className="brand">MboloChat</p>
          <p className="muted">Modération</p>
        </div>
        <nav aria-label="Sections de modération">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === section ? 'nav nav--active' : 'nav'}
              onClick={() => setSection(entry.id)}>
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="sidebar__foot">
          <p className="muted">
            @{user.username}
            <br />
            {user.role}
          </p>
          <button type="button" className="secondary" onClick={logout}>
            Se déconnecter
          </button>
        </div>
      </aside>

      <main className="content">
        {section === 'reports' ? <ReportQueue /> : null}
        {section === 'flagged' ? <FlaggedQueue /> : null}
        {section === 'users' ? <UserSearch /> : null}
        {section === 'words' ? <BlockedWords /> : null}
        {section === 'audit' ? <AuditLog /> : null}
      </main>
    </div>
  );
}
