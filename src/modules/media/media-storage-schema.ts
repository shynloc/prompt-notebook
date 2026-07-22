import { z } from "zod";

import { parseOutboundBaseUrl } from "@/modules/ai/outbound-url-policy";

function endpointSchema() {
  return z.string().trim().min(1).max(2_048).superRefine((value, context) => {
    try {
      parseOutboundBaseUrl(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error
          ? error.message.replace(/^AI provider Base URL/, "Image storage endpoint")
          : "Image storage endpoint is invalid",
      });
    }
  });
}

export const upsertMediaStorageSchema = z.object({
  providerType: z.literal("picbed").default("picbed"),
  endpoint: endpointSchema(),
  token: z.string().min(1).max(10_000).optional(),
  enabled: z.boolean().default(true),
});

export type UpsertMediaStorageInput = z.infer<typeof upsertMediaStorageSchema>;
