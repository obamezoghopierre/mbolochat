import React from 'react';

import { ApiError, api } from '../api';

interface Word {
  id: string;
  word: string;
  active: boolean;
  createdAt: string;
}

/** Mots bloqués : un contenu qui en contient un part en revue humaine. */
export function BlockedWords() {
  const [words, setWords] = React.useState<Word[]>([]);
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setWords(await api.blockedWords());
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

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const word = value.trim();
    if (word.length < 2) {
      return;
    }
    try {
      await api.addBlockedWord(word);
      setValue('');
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Ajout impossible.');
    }
  };

  const remove = async (id: string) => {
    try {
      await api.removeBlockedWord(id);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Suppression impossible.');
    }
  };

  return (
    <section>
      <header className="section-head">
        <h2>Mots bloqués</h2>
      </header>
      <form className="search" onSubmit={add}>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Mot ou expression"
          aria-label="Mot à bloquer"
        />
        <button type="submit" disabled={value.trim().length < 2}>
          Bloquer
        </button>
      </form>

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {!loading && words.length === 0 ? <p className="muted">Aucun mot bloqué.</p> : null}

      <ul className="words">
        {words.map((word) => (
          <li key={word.id} className="card word">
            <span>{word.word}</span>
            <button type="button" className="secondary" onClick={() => void remove(word.id)}>
              Retirer
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
