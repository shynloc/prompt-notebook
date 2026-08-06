import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import {
  characterProfileIdSchema,
  characterVersionSchema,
  updateCharacterProfileSchema,
} from "@/modules/characters/character-schema";
import { CharacterService } from "@/modules/characters/character-service";

const characters = new CharacterService();
type RouteContext = { params: Promise<{ id: string }> };

async function profileId(context: RouteContext) {
  return characterProfileIdSchema.parse((await context.params).id);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request);
    const includeDeleted = new URL(request.url).searchParams.get("includeDeleted") === "true";
    return dataResponse(await characters.get(session.user.id, await profileId(context), includeDeleted));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request);
    const input = updateCharacterProfileSchema.parse(await request.json());
    return dataResponse(await characters.update(session.user.id, await profileId(context), input));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request);
    const input = characterVersionSchema.parse(await request.json());
    const permanent = new URL(request.url).searchParams.get("mode") === "permanent";
    return dataResponse(permanent
      ? await characters.permanentlyRemove(session.user.id, await profileId(context), input.version)
      : await characters.remove(session.user.id, await profileId(context), input.version));
  } catch (error) {
    return errorResponse(error);
  }
}
