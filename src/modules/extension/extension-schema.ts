import { z } from "zod";

export const authorizeExtensionSchema = z.object({
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  redirectUri: z.url().max(500),
  deviceName: z.string().trim().min(1).max(80),
});

export const exchangeExtensionCodeSchema = z.object({
  code: z.string().min(40).max(200),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  redirectUri: z.url().max(500),
});

export const refreshExtensionTokenSchema = z.object({
  refreshToken: z.string().min(40).max(200),
});

export const revokeExtensionSchema = z.object({
  refreshToken: z.string().min(40).max(200).optional(),
});

export type AuthorizeExtensionInput = z.infer<typeof authorizeExtensionSchema>;
export type ExchangeExtensionCodeInput = z.infer<typeof exchangeExtensionCodeSchema>;

