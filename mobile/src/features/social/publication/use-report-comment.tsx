import { useCallback, useMemo, useState } from 'react';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { PublicationComment, ReportReason } from '@/lib/types';

const REASONS: { reason: ReportReason; label: string }[] = [
  { reason: 'spam', label: fr.social.reportSpam },
  { reason: 'harassment', label: fr.social.reportHarassment },
  { reason: 'hate', label: fr.social.reportHate },
  { reason: 'nudity', label: fr.social.reportNudity },
  { reason: 'violence', label: fr.social.reportViolence },
  { reason: 'misinformation', label: fr.social.reportMisinformation },
  { reason: 'other', label: fr.social.reportOther },
];

/** Signalement d'un commentaire : motif, puis envoi à la file de modération. */
export function useReportComment(onDone: (message: string) => void) {
  const { token } = useAuth();
  const [target, setTarget] = useState<PublicationComment | null>(null);
  const [sending, setSending] = useState(false);

  const open = useCallback((comment: PublicationComment) => setTarget(comment), []);
  const close = useCallback(() => setTarget(null), []);

  const submit = useCallback(
    async (reason: ReportReason) => {
      if (!target || !token || sending) {
        return;
      }
      setSending(true);
      try {
        await api.report(token, 'comment', target.id, reason);
        onDone(fr.social.reportSent);
      } catch {
        onDone(fr.social.reportError);
      } finally {
        setSending(false);
        setTarget(null);
      }
    },
    [onDone, sending, target, token],
  );

  const actions = useMemo<SheetAction[]>(
    () =>
      REASONS.map((entry) => ({
        key: entry.reason,
        label: entry.label,
        onPress: () => void submit(entry.reason),
      })),
    [submit],
  );

  const sheet = (
    <ActionSheet
      visible={target !== null}
      title={fr.social.reportCommentTitle}
      subtitle={fr.social.reportSubtitle}
      actions={actions}
      onClose={close}
    />
  );

  return { open, sheet };
}
