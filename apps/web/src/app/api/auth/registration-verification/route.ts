import { withApiLogging } from "@repo/shared/api-logger";
import { sendRegistrationVerificationCode } from "@repo/shared/auth/registration-verification";
import { type NextRequest, NextResponse } from "next/server";

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email : "";

    await sendRegistrationVerificationCode(email);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to send verification code";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export const POST = withApiLogging(handlePost);
