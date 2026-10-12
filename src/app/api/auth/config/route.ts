import { NextResponse } from "next/server";
import { getStudioAuthConfig } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

/** Public auth config for the browser (anon key is public by design; service keys are never exposed). */
export async function GET() {
  return NextResponse.json(getStudioAuthConfig());
}
