import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";

import { ensureSession } from "@/lib/auth/functions";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { withSafeHandler } from "@/lib/server-fn-error";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

/**
 * Records that the signed-in account accepts the terms currently in force.
 *
 * The version is never taken from the request: both columns are `input: false`, so
 * the client cannot stamp itself, and a server-side `auth.api.updateUser` would be
 * filtered the same way. Writing the server's own constant is what makes a version
 * bump mean something. `ensureSession` keeps an operator viewing as this account from
 * accepting on its behalf - accepting is a decision only the account itself makes.
 */
export const acceptCurrentTerms = createServerFn({ method: "POST" }).handler(async () =>
  withSafeHandler(async (): Promise<{ success: true; termsVersion: string }> => {
    const session = await ensureSession();
    const now = new Date();

    await db
      .update(user)
      .set({
        termsVersion: CURRENT_TERMS_VERSION,
        termsAcceptedAt: now,
        updatedAt: now,
      })
      .where(eq(user.id, session.user.id));

    return { success: true, termsVersion: CURRENT_TERMS_VERSION };
  }),
);
