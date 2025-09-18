import { NextResponse } from "next/server";

/**
 * Placeholder API route for future messaging features.
 * Provides a well-typed stub so TypeScript treats this file as a module.
 */
export async function POST(): Promise<Response> {
  return NextResponse.json(
    { success: false, error: "Not implemented" },
    { status: 501 },
  );
}

export async function GET(): Promise<Response> {
  return NextResponse.json(
    { success: false, error: "Not implemented" },
    { status: 501 },
  );
}
