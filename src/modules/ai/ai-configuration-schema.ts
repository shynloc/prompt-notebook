import { z } from "zod";

import { AI_CAPABILITIES, AI_PROVIDER_TYPES, AI_PURPOSES } from "./types";

const capabilitySchema = z.enum(AI_CAPABILITIES);
const parameterValueSchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean()]);
const parametersSchema = z.record(z.string().trim().min(1).max(80), parameterValueSchema)
  .refine((value) => Object.keys(value).length <= 20, "At most 20 default parameters are allowed");

const modelFields = {
  modelId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(120),
  capabilities: z.array(capabilitySchema).min(1).max(AI_CAPABILITIES.length)
    .refine((values) => new Set(values).size === values.length, "Capabilities must be unique"),
  defaultParameters: parametersSchema.default({}),
};

export const createAiConfigurationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  providerType: z.enum(AI_PROVIDER_TYPES).default("openai_compatible"),
  baseUrl: z.string().trim().min(1).max(2_048),
  apiKey: z.string().min(1).max(10_000),
  enabled: z.boolean().default(true),
  ...modelFields,
});

export const updateAiConfigurationSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.string().trim().min(1).max(2_048).optional(),
  apiKey: z.string().min(1).max(10_000).optional(),
  enabled: z.boolean().optional(),
  modelId: modelFields.modelId.optional(),
  displayName: modelFields.displayName.optional(),
  capabilities: modelFields.capabilities.optional(),
  defaultParameters: parametersSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const updateAiPreferenceSchema = z.object({
  purpose: z.enum(AI_PURPOSES),
  modelProfileId: z.uuid().nullable(),
});

export type CreateAiConfigurationInput = z.infer<typeof createAiConfigurationSchema>;
export type UpdateAiConfigurationInput = z.infer<typeof updateAiConfigurationSchema>;
export type UpdateAiPreferenceInput = z.infer<typeof updateAiPreferenceSchema>;
