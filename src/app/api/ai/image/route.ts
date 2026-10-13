import { NextRequest, NextResponse } from "next/server";
import { withMockApiKey } from "@/lib/mock-ai";
import { createProvider } from "@/lib/providers";
import { toRemoteUsableImage } from "@/lib/remote-image";
import { apiError, errText } from "@/lib/api-error";

// AI image generation
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { provider: providerName, model, prompt, imageUrl, imageUrls, mode, apiKey, baseUrl, options } = body;

  if (!providerName || !model || !prompt) {
    return apiError(req, "Missing required parameters", "Missing required parameters");
  }

  if (!withMockApiKey(apiKey)) {
    return apiError(req, "Missing API Key, please configure the corresponding platform in settings first", "Missing API Key, please configure the corresponding platform in settings first");
  }

  try {
    const provider = createProvider({ name: providerName, apiKey, baseUrl });

    // For image-to-image mode, convert local reference images to data URIs.
    // imageUrls (plural) feeds multi-reference edits (e.g. character sheet + product photo);
    // the array order is preserved so prompts can cite references by position.
    const referenceImageUrl = await toRemoteUsableImage(imageUrl);
    const referenceImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0
      ? (await Promise.all((imageUrls as string[]).map(toRemoteUsableImage))).filter((u): u is string => !!u)
      : undefined;

    const result = await provider.generateImage({
      modelId: model,
      mode: mode || "text-to-image",
      prompt,
      referenceImageUrl,
      ...(referenceImageUrls?.length && { referenceImageUrls }),
      ...options,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Image generation failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "Image generation failed", "Image generation failed") },
      { status: 500 }
    );
  }
}
