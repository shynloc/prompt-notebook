const HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Parses the ordered list of single-value client IP headers that Better Auth
 * may trust. The reverse proxy must overwrite every configured header; never
 * point this at a header that can reach the application unchanged from a user.
 */
export function parseIpAddressHeaders(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;

  const headers = Array.from(
    new Set(value.split(",").map((header) => header.trim().toLowerCase()).filter(Boolean)),
  );

  const malformed = headers.find((header) => !HTTP_HEADER_NAME.test(header));
  if (malformed) {
    throw new Error(
      `BETTER_AUTH_IP_ADDRESS_HEADERS contains an invalid HTTP header name: ${malformed}`,
    );
  }

  return headers.length > 0 ? headers : undefined;
}
