import { describe, expect, it } from 'vitest';
import { VaultCrypto, randomToken } from '../worker/crypto';

describe('hosted vault cryptography', () => {
  it('encrypts private data with unique nonces and authenticated vault/revision context', async () => {
    const vault = new VaultCrypto(randomToken());
    const secret = { espnS2: 'private-cookie', selections: ['123'] };
    const first = await vault.encrypt(secret, 'vault-a:1');
    const second = await vault.encrypt(secret, 'vault-a:1');
    expect(first).not.toContain('private-cookie');
    expect(first).not.toEqual(second);
    expect(await vault.decrypt(first, 'vault-a:1')).toEqual(secret);
    await expect(vault.decrypt(first, 'vault-b:1')).rejects.toThrow();
    await expect(vault.decrypt(first, 'vault-a:2')).rejects.toThrow();
    await expect(new VaultCrypto(randomToken()).decrypt(first, 'vault-a:1')).rejects.toThrow();
  });
  it('separates signing purposes and detects changed payloads', async () => {
    const vault = new VaultCrypto(randomToken());
    const signature = await vault.sign('preauth', 'payload');
    expect(await vault.verify('preauth', 'payload', signature)).toBe(true);
    expect(await vault.verify('session', 'payload', signature)).toBe(false);
    expect(await vault.verify('preauth', 'changed', signature)).toBe(false);
  });
  it('requires a full length encryption secret', () => {
    expect(() => new VaultCrypto('short')).toThrow();
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
