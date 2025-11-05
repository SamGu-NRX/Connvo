import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const LOGO_FILES: Record<string, { filename: string; contentType: string }> = {
  light: { filename: "Connvo-black.png", contentType: "image/png" },
  dark: { filename: "Connvo-white.png", contentType: "image/png" },
  favicon: { filename: "Connvo-white.svg", contentType: "image/svg+xml" },
};

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { variant: string } },
) {
  const variant = params.variant.toLowerCase();
  const fileInfo = LOGO_FILES[variant];

  if (!fileInfo) {
    return NextResponse.json(
      { error: `Unknown logo variant '${variant}'.` },
      { status: 404 },
    );
  }

  const filePath = path.join(
    process.cwd(),
    "public",
    "ConnvoLogos",
    fileInfo.filename,
  );

  try {
    const fileBuffer = await fs.readFile(filePath);
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": fileInfo.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Logo asset not found." },
      { status: 404 },
    );
  }
}
