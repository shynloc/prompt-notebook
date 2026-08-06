import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import {
  createCharacterProfileSchema,
  listCharacterProfilesSchema,
} from "@/modules/characters/character-schema";
import { CharacterService } from "@/modules/characters/character-service";

const characters = new CharacterService();

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const url = new URL(request.url);
    const input = listCharacterProfilesSchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      view: url.searchParams.get("view") ?? undefined,
      useCase: url.searchParams.get("useCase") ?? undefined,
    });
    const result = await characters.list(session.user.id, input);
    return dataResponse(result.items, undefined, { nextCursor: result.nextCursor });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const input = createCharacterProfileSchema.parse(await request.json());
    return dataResponse(await characters.create(session.user.id, input), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
