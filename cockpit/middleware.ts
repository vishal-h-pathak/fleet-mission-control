import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/auth/allowlist.mjs";

// Gates every route except the login/callback routes themselves (see
// `matcher` below, which excludes /login and /auth/callback):
//   - no session               -> redirect to /login
//   - session, email not on COCKPIT_ALLOWED_EMAILS -> sign out, redirect to
//     /login?denied=1
//   - otherwise                -> allow through, refreshing the session
//     cookie so it doesn't expire under a long-lived tab.
//
// Uses supabase.auth.getUser() (not getSession()) because it revalidates the
// JWT against Supabase's Auth server rather than trusting an unverified
// cookie — the correct check to run in server/middleware code per Supabase's
// Next.js SSR guidance.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Server misconfigured — fail closed rather than let traffic through
    // unauthenticated.
    return NextResponse.json(
      { error: "server_misconfigured", message: "Supabase env vars not set." },
      { status: 500 },
    );
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  if (!isAllowedEmail(user.email, process.env.COCKPIT_ALLOWED_EMAILS)) {
    await supabase.auth.signOut();
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("denied", "1");
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except: /login, /auth/callback, Next internals, and common
    // static assets. Adjust the asset-extension list as the app grows.
    "/((?!login|auth/callback|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
