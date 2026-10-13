import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

// fetch project list, most recently edited first (the /start "continue" cards rely on this order)
export async function GET() {
  try {
    const db = getDb();
    const result = await db.select().from(projects).orderBy(desc(projects.updatedAt));
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch projects" },
      { status: 500 }
    );
  }
}

// create a new project
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();

    // validate videoMode / sourceType against enum allowlists; fall back to default for invalid values
    const VIDEO_MODES = ["product_closeup", "graphic_montage", "scene_demo", "live_presenter"];
    const videoMode = VIDEO_MODES.includes(body.videoMode) ? body.videoMode : undefined;
    const sourceType = body.sourceType === "clone" ? "clone" : undefined;

    const newProject = await db
      .insert(projects)
      .values({
        name: body.name || "Untitled project",
        productName: body.productName,
        productCategory: body.productCategory,
        productDescription: body.productDescription,
        productImages: body.productImages || [],
        ...(videoMode && { videoMode }),
        ...(sourceType && { sourceType }),
        ...(body.sourceVideoUrl && { sourceVideoUrl: body.sourceVideoUrl }),
      })
      .returning();

    return NextResponse.json(newProject[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create project" },
      { status: 500 }
    );
  }
}
