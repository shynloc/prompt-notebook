import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import {
  characterProfileIdSchema,
  characterVersionSchema,
} from "@/modules/characters/character-schema";
import { CharacterService } from "@/modules/characters/character-service";

const characters = new CharacterService();
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request);
    const id = characterProfileIdSchema.parse((await context.params).id);
    const { version } = characterVersionSchema.parse(await request.json());
    return dataResponse(await characters.restore(session.user.id, id, version));
  } catch (error) {
    return errorResponse(error);
  }
}
