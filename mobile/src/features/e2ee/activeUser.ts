/**
 * Identité du compte dont la session locale est ouverte.
 *
 * Toute lecture de clé ou de base chiffrée passe par `assertActiveE2eeUser` :
 * une base, un pickle de compte ou une session Olm ne peuvent jamais être
 * manipulés pour un autre utilisateur que celui authentifié à l'écran. Le
 * registre est volontairement unique : un bogue de routage doit échouer, pas
 * ouvrir silencieusement la base d'un autre compte.
 *
 * `null` signifie « aucune session E2EE active » (déconnexion) : toute
 * opération est alors refusée.
 */

let activeUserId: string | null = null;

type Waiter = {
  userId: string;
  operation: string;
  finish: (error?: Error) => void;
};

const waiters = new Set<Waiter>();

export function setActiveE2eeUser(userId: string | null): void {
  activeUserId = userId && userId.trim().length > 0 ? userId : null;
  for (const waiter of [...waiters]) {
    if (activeUserId === waiter.userId) {
      waiter.finish();
    } else {
      waiter.finish(
        new Error(
          activeUserId === null
            ? `e2ee_no_active_user:${waiter.operation}`
            : `e2ee_account_mismatch:${waiter.operation}`,
        ),
      );
    }
  }
}

/**
 * Attend brièvement que la session attache son compte.
 *
 * Au démarrage, la reprise de l'outbox ou de la file programmée peut s'armer
 * avant que l'authentification asynchrone n'ait posé l'identité : on attend son
 * arrivée au lieu d'échouer. Un autre compte, une déconnexion ou un délai
 * dépassé refusent l'opération.
 */
export function waitForActiveE2eeUser(
  userId: string | null | undefined,
  operation: string,
  timeoutMs = 5_000,
): Promise<string> {
  if (!userId) {
    return Promise.reject(new Error(`e2ee_user_missing:${operation}`));
  }
  if (activeUserId === userId) return Promise.resolve(userId);
  if (activeUserId !== null) {
    return Promise.reject(new Error(`e2ee_account_mismatch:${operation}`));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`e2ee_no_active_user:${operation}`));
    }, timeoutMs);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      waiters.delete(waiter);
      if (error) reject(error);
      else resolve(userId);
    };
    const waiter: Waiter = { userId, operation, finish };
    waiters.add(waiter);
  });
}

export function getActiveE2eeUser(): string | null {
  return activeUserId;
}

export function assertActiveE2eeUser(userId: string | null | undefined, operation: string): string {
  if (!userId) {
    throw new Error(`e2ee_user_missing:${operation}`);
  }
  if (activeUserId === null) {
    throw new Error(`e2ee_no_active_user:${operation}`);
  }
  if (activeUserId !== userId) {
    throw new Error(`e2ee_account_mismatch:${operation}`);
  }
  return userId;
}

/** Réservé aux tests : remet le registre à zéro entre deux cas. */
export function resetActiveE2eeUserForTests(): void {
  for (const waiter of [...waiters]) {
    waiter.finish(new Error(`e2ee_no_active_user:${waiter.operation}`));
  }
  activeUserId = null;
}
