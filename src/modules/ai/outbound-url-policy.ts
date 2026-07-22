import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type ResolvedAddress = { address: string; family: number };
export type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home", ".lan"];

function blockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 2)
    || (a === 192 && b === 31 && c === 196)
    || (a === 192 && b === 52 && c === 193)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 192 && b === 175 && c === 48)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function ipv6Hextets(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) !== 6) return null;
  const [leftText, rightText = ""] = normalized.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  const expandIpv4 = (parts: string[]) => parts.flatMap((part) => {
    if (!part.includes(".")) return [part];
    const bytes = part.split(".").map(Number);
    return [((bytes[0] << 8) | bytes[1]).toString(16), ((bytes[2] << 8) | bytes[3]).toString(16)];
  });
  const expandedLeft = expandIpv4(left);
  const expandedRight = expandIpv4(right);
  const missing = 8 - expandedLeft.length - expandedRight.length;
  const hextets = normalized.includes("::")
    ? [...expandedLeft, ...Array.from({ length: missing }, () => "0"), ...expandedRight]
    : expandedLeft;
  if (missing < 0 || hextets.length !== 8) return null;
  return hextets.map((hextet) => Number.parseInt(hextet || "0", 16));
}

function inIpv6Prefix(value: number[], prefix: number[], bits: number) {
  const wholeHextets = Math.floor(bits / 16);
  for (let index = 0; index < wholeHextets; index += 1) {
    if (value[index] !== (prefix[index] ?? 0)) return false;
  }
  const remainingBits = bits % 16;
  if (!remainingBits) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (value[wholeHextets] & mask) === ((prefix[wholeHextets] ?? 0) & mask);
}

function blockedIpv6(address: string) {
  const value = ipv6Hextets(address);
  if (value === null || (value.slice(0, 7).every((part) => part === 0) && (value[7] === 0 || value[7] === 1))) return true;
  if (value.slice(0, 5).every((part) => part === 0) && value[5] === 0xffff) {
    const mapped = (value[6] * 0x10000) + value[7];
    return blockedIpv4([
      mapped >>> 24,
      (mapped >>> 16) & 255,
      (mapped >>> 8) & 255,
      mapped & 255,
    ].join("."));
  }
  return inIpv6Prefix(value, [0xfc00], 7)
    || inIpv6Prefix(value, [0xfe80], 10)
    || inIpv6Prefix(value, [0xff00], 8)
    || inIpv6Prefix(value, [0x0100, 0, 0, 0], 64)
    || inIpv6Prefix(value, [0x0064, 0xff9b, 0, 0, 0, 0], 96)
    || inIpv6Prefix(value, [0x0064, 0xff9b, 1], 48)
    || inIpv6Prefix(value, [0x2001, 0x0002, 0], 48)
    || inIpv6Prefix(value, [0x2001, 0x0010], 28)
    || inIpv6Prefix(value, [0x2001, 0x0020], 28)
    || inIpv6Prefix(value, [0x2001, 0x0db8], 32)
    || inIpv6Prefix(value, [0x2002], 16);
}

export function isBlockedOutboundAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return blockedIpv4(address);
  if (family === 6) return blockedIpv6(address);
  return true;
}

export function parseOutboundBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AI provider Base URL is invalid");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (url.protocol !== "https:") throw new Error("AI provider Base URL must use HTTPS");
  if (url.username || url.password) throw new Error("AI provider Base URL cannot include credentials");
  if (url.search || url.hash) throw new Error("AI provider Base URL cannot include a query or fragment");
  if (url.port && url.port !== "443") throw new Error("AI provider Base URL must use the standard HTTPS port");
  if (!hostname || hostname === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error("AI provider Base URL cannot target a local hostname");
  }
  if (isIP(hostname) && isBlockedOutboundAddress(hostname)) {
    throw new Error("AI provider Base URL cannot target a private or reserved address");
  }
  url.hostname = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

export const defaultAddressResolver: AddressResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({ address, family }));
};

export async function validateOutboundBaseUrl(
  value: string,
  resolver: AddressResolver = defaultAddressResolver,
) {
  return (await resolveOutboundTarget(value, resolver)).url;
}

export async function resolveOutboundTarget(
  value: string,
  resolver: AddressResolver = defaultAddressResolver,
) {
  const url = parseOutboundBaseUrl(value);
  const literalHostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(literalHostname)
    ? [{ address: literalHostname, family: isIP(literalHostname) }]
    : await resolver(literalHostname);
  if (!addresses.length) throw new Error("AI provider hostname did not resolve");
  if (addresses.some(({ address }) => isBlockedOutboundAddress(address))) {
    throw new Error("AI provider hostname resolves to a private or reserved address");
  }
  return { url, addresses };
}
