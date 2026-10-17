import { Agent, buildConnector } from 'undici';
import axios, { AxiosInstance } from 'axios';
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { Duplex } from 'node:stream';
import { isBlockedIp } from './webhook.url.validator';

// Pins DNS resolution: every resolved IP is checked with `isBlockedIp` and
// the caller connects to that same set. Closes the TOCTOU window
// `isSafePublicHttpsUrl` alone leaves open (see GHSA-f7jj-p389-4w45).
function ssrfSafeLookup(
  hostname: string,
  options: any,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: any,
    family?: number
  ) => void
) {
  dns.lookup(hostname, options, (err, address: any, family: any) => {
    if (err) return callback(err, '', 0);
    if (Array.isArray(address)) {
      for (const entry of address) {
        if (isBlockedIp(entry.address)) {
          return callback(new Error('Blocked IP'), '', 0);
        }
      }
      return callback(null, address as any, 0);
    }
    if (isBlockedIp(address)) {
      return callback(new Error('Blocked IP'), '', 0);
    }
    callback(null, address, family);
  });
}

// net.connect / tls.connect skip `lookup` when the host is already an IP
// literal, so those hosts are checked here before any socket is opened.
function isBlockedIpLiteral(host: string | null | undefined): boolean {
  const ip = (host || '').replace(/^\[|\]$/g, '');
  return net.isIP(ip) !== 0 && isBlockedIp(ip);
}

const ssrfSafeConnector = buildConnector({ lookup: ssrfSafeLookup });

export const ssrfSafeDispatcher = new Agent({
  connect: (options, callback) => {
    if (isBlockedIpLiteral(options.hostname)) {
      return callback(new Error('Blocked IP'), null);
    }
    ssrfSafeConnector(options, callback);
  },
});

interface ConnectionFactory {
  createConnection(
    options: http.ClientRequestArgs,
    oncreate: (err: Error | null, socket?: Duplex) => void
  ): Duplex | undefined;
}

function guardIpLiterals<T extends http.Agent>(agent: T): T {
  const factory = agent as unknown as ConnectionFactory;
  const createConnection = factory.createConnection.bind(agent);
  factory.createConnection = (options, oncreate) => {
    if (isBlockedIpLiteral(options.host)) {
      oncreate(new Error('Blocked IP'));
      return undefined;
    }
    return createConnection(options, oncreate);
  };
  return agent;
}

// axios can't use an undici dispatcher, but Node's http(s) agents accept the
// same `lookup` hook, so axios requests (providers that need form-data /
// stream uploads) get the identical pinned-DNS guard as `this.fetch`.
const ssrfSafeAxios = axios.create({
  httpAgent: guardIpLiterals(
    new http.Agent({ lookup: ssrfSafeLookup } as http.AgentOptions)
  ),
  httpsAgent: guardIpLiterals(
    new https.Agent({ lookup: ssrfSafeLookup } as https.AgentOptions)
  ),
});

// Self-hosters legitimately connect Postiz to WordPress/Mastodon/Lemmy/Listmonk
// instances that live on a private network (e.g. the same Docker network or VPC).
// Setting DISABLE_SSRF_PROTECTION=true opts those deployments out of the IP
// guard. It stays ON by default so the hosted product is protected.
export function getSsrfSafeDispatcher(): Agent | undefined {
  return process.env.DISABLE_SSRF_PROTECTION === 'true'
    ? undefined
    : ssrfSafeDispatcher;
}

export function getSsrfSafeAxios(): AxiosInstance {
  return process.env.DISABLE_SSRF_PROTECTION === 'true' ? axios : ssrfSafeAxios;
}
