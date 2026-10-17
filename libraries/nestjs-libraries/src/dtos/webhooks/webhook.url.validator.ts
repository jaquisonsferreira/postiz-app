import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { URL } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';

export function isBlockedIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);

  if ([a, b].some((n) => Number.isNaN(n))) return true;

  return (
    a === 0 ||                       // 0.0.0.0/8
    a === 10 ||                      // 10.0.0.0/8
    a === 127 ||                     // 127.0.0.0/8
    (a === 169 && b === 254) ||      // 169.254.0.0/16
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) ||      // 192.168.0.0/16
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    a >= 224                         // multicast/reserved
  );
}

// Checked on the canonical spelling (lowercase, zeros compressed) and on the
// bits of the first group, so a range holds however the address was written
export function isBlockedIPv6(ip: string): boolean {
  if (net.isIP(ip) !== 6) return true;
  const canonical = new URL(`https://[${ip}]/`).hostname.slice(1, -1);
  const first = canonical.startsWith('::') ? 0 : parseInt(canonical.split(':')[0], 16);

  return (
    canonical === '::1' ||           // loopback
    canonical === '::' ||            // unspecified
    (first & 0xffc0) === 0xfe80 ||   // link-local fe80::/10
    (first & 0xfe00) === 0xfc00 ||   // unique local fc00::/7
    (first & 0xff00) === 0xff00      // multicast ff00::/8
  );
}

export function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    return isBlockedIPv4(ip);
  }
  if (version === 6) {
    // IPv4-mapped IPv6 has many spellings (::ffff:a.b.c.d, ::ffff:7f00:1,
    // 0:0:0:0:0:ffff:...), so it is canonicalized first, then checked as IPv4
    const canonical = new URL(`https://[${ip}]/`).hostname;
    const mapped = canonical.match(/^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/);
    if (mapped) {
      const [high, low] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
      return isBlockedIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return isBlockedIPv6(ip);
  }
  return true;
}

// "unresolved" is a lookup that failed (a resolver timeout, EAI_AGAIN): the
// same URL may resolve on a retry, while "blocked" never becomes safe
export type PublicHttpsUrlCheck = 'safe' | 'blocked' | 'unresolved';

export async function checkPublicHttpsUrl(value: unknown): Promise<PublicHttpsUrlCheck> {
  if (typeof value !== 'string' || !value.trim()) {
    return 'blocked';
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'blocked';
  }

  if (parsed.protocol !== 'https:') {
    return 'blocked';
  }

  if (!parsed.hostname) {
    return 'blocked';
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (hostname === 'localhost') {
    return 'blocked';
  }

  // If user supplied a literal IP directly, validate it immediately
  const literalIpVersion = net.isIP(hostname);
  if (literalIpVersion) {
    return isBlockedIp(hostname) ? 'blocked' : 'safe';
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    return 'unresolved';
  }

  if (!records.length) {
    return 'unresolved';
  }

  return records.some((record) => isBlockedIp(record.address)) ? 'blocked' : 'safe';
}

export async function isSafePublicHttpsUrl(value: unknown): Promise<boolean> {
  return (await checkPublicHttpsUrl(value)) === 'safe';
}

@ValidatorConstraint({ name: 'IsSafeWebhookUrl', async: true })
export class IsSafeWebhookUrlConstraint implements ValidatorConstraintInterface {
  async validate(value: unknown, _args: ValidationArguments): Promise<boolean> {
    return isSafePublicHttpsUrl(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'URL must be a public HTTPS URL and must not resolve to localhost, private, loopback, or link-local addresses';
  }
}

export function IsSafeWebhookUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsSafeWebhookUrlConstraint,
    });
  };
}