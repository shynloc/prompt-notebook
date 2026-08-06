import { z } from "zod";

export const CHARACTER_VIEW_TYPES = [
  "portrait",
  "half_body",
  "full_body",
  "left",
  "right",
  "back",
  "expression",
  "outfit",
  "other",
] as const;

export const CHARACTER_ROLES = ["primary", "supporting", "reference"] as const;

const httpUrl = z.url().max(4_000).refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "Image URLs must use HTTP or HTTPS without embedded credentials");

const attributeValue = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(200)).max(20),
]);

const attributesSchema = z.record(z.string().trim().min(1).max(80), attributeValue)
  .refine((value) => Object.keys(value).length <= 30, "At most 30 character attributes are allowed");

export const characterImageInputSchema = z.object({
  id: z.uuid().optional(),
  storageProvider: z.enum(["picbed", "external"]),
  objectKey: z.string().trim().min(1).max(1_000),
  displayUrl: httpUrl,
  thumbnailUrl: httpUrl,
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  viewType: z.enum(CHARACTER_VIEW_TYPES).default("other"),
  caption: z.string().trim().max(300).default(""),
  isCover: z.boolean().default(false),
  isPrimary: z.boolean().default(false),
  focusX: z.number().int().min(0).max(100).default(50),
  focusY: z.number().int().min(0).max(100).default(50),
  metadata: z.record(z.string().max(80), z.union([z.string().max(500), z.number().finite(), z.boolean()])).default({}),
});

function normalizeUseCases(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.trim().normalize("NFKC")).filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateImages(images: z.infer<typeof characterImageInputSchema>[], context: z.RefinementCtx) {
  if (images.filter((image) => image.isCover).length > 1) {
    context.addIssue({ code: "custom", message: "Only one cover image is allowed" });
  }
  if (images.filter((image) => image.isPrimary).length > 1) {
    context.addIssue({ code: "custom", message: "Only one primary reference image is allowed" });
  }
  const identities = images.map((image) => image.id ?? `${image.storageProvider}:${image.objectKey}`);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", message: "Character images must be unique" });
  }
}

const profileFields = {
  name: z.string().trim().min(1).max(100),
  summary: z.string().trim().max(500).default(""),
  roleDefinition: z.string().trim().min(1).max(5_000),
  useCases: z.array(z.string().max(40)).max(12).transform(normalizeUseCases).default([]),
  appearance: z.string().trim().max(5_000).default(""),
  promptAnchor: z.string().trim().max(10_000).default(""),
  negativePrompt: z.string().trim().max(5_000).default(""),
  rightsNote: z.string().trim().max(2_000).default(""),
  attributes: attributesSchema.default({}),
  images: z.array(characterImageInputSchema).max(12).default([]),
};

export const createCharacterProfileSchema = z.object(profileFields)
  .superRefine((value, context) => validateImages(value.images, context));

export const updateCharacterProfileSchema = z.object({
  version: z.number().int().positive(),
  name: profileFields.name.optional(),
  summary: z.string().trim().max(500).optional(),
  roleDefinition: profileFields.roleDefinition.optional(),
  useCases: z.array(z.string().max(40)).max(12).transform(normalizeUseCases).optional(),
  appearance: z.string().trim().max(5_000).optional(),
  promptAnchor: z.string().trim().max(10_000).optional(),
  negativePrompt: z.string().trim().max(5_000).optional(),
  rightsNote: z.string().trim().max(2_000).optional(),
  attributes: attributesSchema.optional(),
  images: z.array(characterImageInputSchema).max(12).optional(),
  archivedAt: z.coerce.date().nullable().optional(),
}).superRefine((value, context) => {
  if (Object.keys(value).every((key) => key === "version")) {
    context.addIssue({ code: "custom", message: "At least one character field is required" });
  }
  if (value.images) validateImages(value.images, context);
});

export const characterProfileIdSchema = z.uuid();
export const characterVersionSchema = z.object({ version: z.number().int().positive() });

export const listCharacterProfilesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().max(500).optional(),
  q: z.string().trim().max(100).optional(),
  view: z.enum(["active", "archived", "trash", "all"]).default("active"),
  useCase: z.string().trim().max(40).optional(),
});

export const noteCharacterAssociationSchema = z.object({
  id: z.uuid(),
  role: z.enum(CHARACTER_ROLES).default("primary"),
  sortOrder: z.number().int().min(0).max(7).default(0),
});

export const noteCharacterAssociationsSchema = z.array(noteCharacterAssociationSchema).max(8)
  .superRefine((items, context) => {
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      context.addIssue({ code: "custom", message: "A character can only be linked once" });
    }
    if (items.filter((item) => item.role === "primary").length > 1) {
      context.addIssue({ code: "custom", message: "A note can only have one primary character" });
    }
    if (new Set(items.map((item) => item.sortOrder)).size !== items.length) {
      context.addIssue({ code: "custom", message: "Character association order values must be unique" });
    }
  });

export type CharacterImageInput = z.infer<typeof characterImageInputSchema>;
export type CreateCharacterProfileInput = z.infer<typeof createCharacterProfileSchema>;
export type UpdateCharacterProfileInput = z.infer<typeof updateCharacterProfileSchema>;
export type NoteCharacterAssociationInput = z.infer<typeof noteCharacterAssociationSchema>;
