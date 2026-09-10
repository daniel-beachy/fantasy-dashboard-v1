const encoder = new TextEncoder();
const encoded = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
const decoded = (value: string) => new Uint8Array(Buffer.from(value, 'base64url'));
export function randomToken(): string { return encoded(crypto.getRandomValues(new Uint8Array(32))); }
export class VaultCrypto {
  private readonly encryption: Promise<CryptoKey>;
  private readonly signing: Promise<CryptoKey>;
  constructor(secret: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || decoded(secret).length !== 32) throw new Error('VAULT_KEY must contain 32 random bytes encoded as base64url.');
    const root = crypto.subtle.importKey('raw', decoded(secret), 'HKDF', false, ['deriveKey']);
    const params = (purpose: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('sunday-hq:v1'), info: encoder.encode(purpose) });
    this.encryption = root.then(key => crypto.subtle.deriveKey(params('encryption'), key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    this.signing = root.then(key => crypto.subtle.deriveKey(params('signing'), key, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']));
  }
  async encrypt(value: unknown, context: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, await this.encryption, encoder.encode(JSON.stringify(value)));
    return `1.${encoded(iv)}.${encoded(ciphertext)}`;
  }
  async decrypt(value: string, context: string): Promise<unknown> {
    const [version, iv, ciphertext, extra] = value.split('.');
    if (version !== '1' || !iv || !ciphertext || extra || decoded(iv).length !== 12) throw new Error('Unsupported encrypted record.');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decoded(iv), additionalData: encoder.encode(context) }, await this.encryption, decoded(ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext));
  }
  async sign(purpose: string, value: string): Promise<string> {
    return encoded(await crypto.subtle.sign('HMAC', await this.signing, encoder.encode(`${purpose}\0${value}`)));
  }
  async verify(purpose: string, value: string, signature: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
    return crypto.subtle.verify('HMAC', await this.signing, decoded(signature), encoder.encode(`${purpose}\0${value}`));
  }
}
