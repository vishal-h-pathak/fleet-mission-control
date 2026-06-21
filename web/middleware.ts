import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";

// Gate the authed slice. P0: the only sensitive route is the per-job links API,
// which returns rc_url/rc_qr from the private table. No valid cookie → 401.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const ok = await verifySessionToken(token);
  if (!ok) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sign in to reveal remote-control links." },
      { status: 401 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/job/:id/links"],
};
