import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export default function proxy(request: NextRequest) {
  // Currently no middleware-style handling; simply continue the request chain.
  return NextResponse.next();
}
