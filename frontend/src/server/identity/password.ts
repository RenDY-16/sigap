import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
export async function hashPassword(password: string): Promise<{ salt: string; verifier: string }> {
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 1024) throw new Error('Password must be 12 to 1024 bytes.');
  const salt = randomBytes(16).toString('hex');
  const verifier = (await scrypt(password, Buffer.from(salt, 'hex'), KEY_LENGTH)) as Buffer;
  return { salt, verifier: verifier.toString('hex') };
}
export async function verifyPassword(password: string, salt: string, verifier: string): Promise<boolean> {
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(verifier) || typeof password !== 'string') return false;
  const actual = (await scrypt(password, Buffer.from(salt, 'hex'), KEY_LENGTH)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(verifier, 'hex'));
}
