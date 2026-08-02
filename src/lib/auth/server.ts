import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";

import { db } from "@/db/client";
import { account, session, user, verification } from "@/db/schema";
import { parseIpAddressHeaders } from "@/lib/auth/client-ip";
import { createMailer, type Mailer } from "@/lib/email/mailer";

interface CreatePromptAuthOptions {
  mailer?: Mailer;
  requireEmailVerification?: boolean;
  ipAddressHeaders?: string[];
  rateLimitEnabled?: boolean;
}

const authSchema = { user, session, account, verification };

export function createPromptAuth(options: CreatePromptAuthOptions = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  const appUrl = process.env.APP_URL ?? (isProduction ? "" : "http://localhost:3000");
  const secret =
    process.env.BETTER_AUTH_SECRET ??
    (isProduction ? "" : "development-only-secret-change-before-production");

  if (!appUrl) throw new Error("APP_URL is required in production");
  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }

  const mailer = options.mailer ?? createMailer();
  const requireEmailVerification =
    options.requireEmailVerification ?? isProduction;
  const ipAddressHeaders =
    options.ipAddressHeaders
    ?? parseIpAddressHeaders(process.env.BETTER_AUTH_IP_ADDRESS_HEADERS);

  return betterAuth({
    appName: "Prompt Notebook",
    baseURL: appUrl,
    secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
      transaction: true,
    }),
    trustedOrigins: [appUrl],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user: resetUser, url }) {
        await mailer.send({
          to: resetUser.email,
          subject: "Reset your Prompt Notebook password",
          text: `Open this link to reset your password: ${url}`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: requireEmailVerification,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user: pendingUser, url }) {
        await mailer.send({
          to: pendingUser.email,
          subject: "Verify your Prompt Notebook email",
          text: `Open this link to verify your email: ${url}`,
        });
      },
    },
    user: {
      deleteUser: { enabled: true },
    },
    advanced: {
      useSecureCookies: new URL(appUrl).protocol === "https:",
      ...(ipAddressHeaders ? { ipAddress: { ipAddressHeaders } } : {}),
    },
    rateLimit: { enabled: options.rateLimitEnabled ?? isProduction },
  });
}

export const auth = createPromptAuth();

export type AuthSession = typeof auth.$Infer.Session;
