import { NextResponse } from "next/server";
import { isWebMode } from "@/lib/web-mode-flag";

export const dynamic = "force-dynamic";

/**
 * GET /api/config — public runtime flags for the frontend. The shape is a contract: exactly
 * `{ webMode: boolean }` (true when WEB_MODE=1). Never add secrets or env values here.
 */
export function GET() {
  return NextResponse.json({ webMode: isWebMode() });
}
