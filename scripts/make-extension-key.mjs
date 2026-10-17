// Generates the manifest "key" that pins the extension ID for unpacked builds.
// Google and Yandex sign-in only redirect to registered URLs, and those contain the
// extension ID, so it must not change between machines or folders.
//   node scripts/make-extension-key.mjs   (prints the key and the resulting ID)
// Only the public key is needed for a stable ID; the private key is discarded.
import { createHash, generateKeyPairSync } from 'node:crypto';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });

/** Chrome's extension ID: first 32 hex digits of SHA-256(public key), mapped 0-f -> a-p. */
export function extensionId(publicKeyDer) {
  const hex = createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

console.log(`key: ${der.toString('base64')}`);
console.log(`id:  ${extensionId(der)}`);
