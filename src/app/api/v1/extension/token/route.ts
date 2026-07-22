import { dataResponse, errorResponse } from "@/lib/api/response";
import { exchangeExtensionCodeSchema } from "@/modules/extension/extension-schema";
import { ExtensionTokenService } from "@/modules/extension/token-service";

const tokens = new ExtensionTokenService();

export async function POST(request: Request) {
  try {
    const result = await tokens.exchange(exchangeExtensionCodeSchema.parse(await request.json()));
    return dataResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}

