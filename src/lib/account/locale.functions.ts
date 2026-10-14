import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { ensureSession } from "@/lib/auth/functions";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";
import { withSafeHandler } from "@/lib/server-fn-error";

const setLocaleSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES),
});

/**
 * Remembers the signed-in account's interface language.
 *
 * This is the one thing a signed-in reader keeps server-side about how they read, so the
 * choice follows them to a device that has never seen the cookie. The value is validated
 * against the supported locales rather than stored as free text, and `ensureSession` keeps
 * an operator viewing as this account from choosing on its behalf. A guest never reaches
 * this: their choice lives in the cookie alone.
 *
 * A failed write is not a failed switch - the caller has already written the cookie and
 * reloaded - so the handler reports success and the next visit simply re-seeds.
 */
export const setViewerLocale = createServerFn({ method: "POST" })
  .validator(setLocaleSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<{ success: true; locale: string }> => {
      const session = await ensureSession();
      await db
        .update(user)
        .set({ locale: data.locale, updatedAt: new Date() })
        .where(eq(user.id, session.user.id));
      return { success: true, locale: data.locale };
    }),
  );
