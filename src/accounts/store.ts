// Credentials live in storage.local on this device only; nothing is synced or sent
// anywhere except to the host they belong to.
export type AccountId = 'pixeldrain' | 'google' | 'yandex';

export interface Account {
  /** API key (Pixeldrain) or OAuth access token (Google, Yandex). */
  secret: string;
  /** OAuth only: when the access token stops working (ms since epoch). */
  expiresAt?: number;
  /** Who it is, for the settings page, e.g. a username or email. */
  label?: string;
}

const key = (id: AccountId) => `accounts.${id}`;

export async function getAccount(id: AccountId): Promise<Account | undefined> {
  return (await browser.storage.local.get(key(id)))[key(id)] as Account | undefined;
}

export async function setAccount(id: AccountId, account: Account) {
  await browser.storage.local.set({ [key(id)]: account });
}

export async function clearAccount(id: AccountId) {
  await browser.storage.local.remove(key(id));
}

export class NotConnectedError extends Error {}
