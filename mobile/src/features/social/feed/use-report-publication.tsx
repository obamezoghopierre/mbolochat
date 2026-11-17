import { useCallback, useMemo, useState } from 'react';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { FeedPost, ReportReason } from '@/lib/types';

/** Motifs proposés au signalement d'une publication, avec leur libellé. */
const REASONS: { reason: ReportReason; label: string }[] = [
  { reason: 'spam', label: fr.social.reportSpam },
  { reason: 'harassment', label: fr.social.reportHarassment },
  { reason: 'hate', label: fr.social.reportHate },
  { reason: 'nudity', label: fr.social.reportNudity },
  { reason: 'violence', label: fr.social.reportViolence },
  { reason: 'misinformation', label: fr.social.reportMisinformation },
  { reason: 'other', label: fr.social.reportOther },
];

/**
 * Signalement d'une publication depuis le feed.
 *
 * Deux étapes volontairement : le motif d'abord, puis une confirmation — un
 * signalement n'est pas annulable côté serveur, il ne doit pas partir sur un
 * tap mal placé.
 */
export function useReportPublication(onDone: (message: string) => void) {
  const { token } = useAuth();
  const [target, setTarget] = useState<FeedPost | null>(null);
  const [sending, setSending] = useState(false);

  const open = useCallback((post: FeedPost) => setTarget(post), []);
  const close = useCallback(() => setTarget(null), []);

  const submit = useCallback(
    async (reason: ReportReason) => {
      if (!target || !token || sending) {
        return;
      }
      setSending(true);
      try {
        await api.report(token, 'publication', target.id, reason);
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
      title={fr.social.reportTitle}
      subtitle={fr.social.reportSubtitle}
      actions={actions}
      onClose={close}
    />
  );

  return { open, sheet };
}
