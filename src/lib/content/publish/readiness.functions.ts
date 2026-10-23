import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// The readiness read is owner-scoped like the residual scan beside it, and authenticates the
// same way so an operator viewing an account still sees what that owner sees.
import { ensureSessionForRead } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import { getPublicationReadinessForUser } from "./readiness.service";

export const getChapterPublicationReadiness = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return getPublicationReadinessForUser(session.user.id, data.novelId);
    }),
  );
