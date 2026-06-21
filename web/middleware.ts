import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";

// Gate the authed slice. Sensitive per-job routes that read the private
// fleet_job_links table: /links returns rc_url/rc_qr, /log returns log_tail.
// No valid cookie → 401.
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
  matcher: ["/api/job/:id/links", "/api/job/:id/log"],
};
