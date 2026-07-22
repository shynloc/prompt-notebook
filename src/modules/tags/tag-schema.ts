import { z } from "zod";
import { tagNameSchema } from "@/modules/notes/note-schema";

export const createTagSchema = z.object({ name: tagNameSchema });
export const updateTagSchema = z.union([
  z.object({ name: tagNameSchema }),
  z.object({ mergeIntoId: z.uuid() }),
]);
export const tagIdSchema = z.uuid();
