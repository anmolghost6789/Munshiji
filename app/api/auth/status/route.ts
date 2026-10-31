import { NextResponse } from "next/server";
/** Sign-up is open: each new account creates its own business. */
export async function GET() { return NextResponse.json({ signupOpen: true }); }
