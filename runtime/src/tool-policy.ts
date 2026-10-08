import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { RuntimeConfig } from "./types.js";

function normalizeHost(value: string): string {
  return value.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
}

function ipv4Parts(value: string): number[] | undefined {
  if (isIP(value) !== 4) return undefined;
  return value.split(".").map(Number);
}

function privateAddress(value: string): boolean {
  const address = normalizeHost(value);
  const parts = ipv4Parts(address);
  if (parts) {
    const [a, b, c] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a === 255;
  }
  if (isIP(address) !== 6) return true;
  if (address.startsWith("::ffff:")) {
    const mapped = address.slice("::ffff:".length);
    return privateAddress(mapped);
  }
  return address === "::" || address === "::1" ||
    /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address) || /^ff/i.test(address);
}

export async function assertToolEndpointAllowed(endpoint: string, config: RuntimeConfig): Promise<URL> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("MCP endpoint is invalid");
  }
  const host = normalizeHost(url.hostname);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !host ||
      url.username || url.password || url.hash || url.search ||
      url.origin === "null" || host.includes("%")) {
    throw new Error("MCP endpoint must be an HTTP(S) URL without credentials, query, or fragment");
  }
  if (!config.toolAllowedHosts.includes(host)) throw new Error("MCP endpoint host is not allowlisted");
  if (url.protocol === "http:" && !config.toolHttpHosts.includes(host)) {
    throw new Error("MCP endpoint requires explicit HTTP allowlisting");
  }

  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((result) => result.address);
    } catch {
      throw new Error("MCP endpoint host could not be resolved");
    }
  }
  if (addresses.length === 0) throw new Error("MCP endpoint host has no addresses");
  if (!config.toolPrivateHosts.includes(host) && addresses.some(privateAddress)) {
    throw new Error("MCP endpoint resolves to a private or reserved address");
  }
  return url;
}

export async function guardedFetch(
  config: RuntimeConfig,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
  await assertToolEndpointAllowed(url.toString(), config);
  const timeout = AbortSignal.timeout(15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const response = await fetch(input, { ...init, signal, redirect: "error" });
  if (!response.body) return response;
  const reader = response.body.getReader();
  let received = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        received += value.byteLength;
        if (received > 1_048_576) {
          await reader.cancel();
          controller.error(new Error("MCP response exceeded the size limit"));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
