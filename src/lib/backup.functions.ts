import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { ensureAdminSession } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import { importBackupForUser } from "./backup.service";

const importBackupSchema = z.object({ backup: z.unknown() });

// Operator-only: a backup restores every novel and chapter an account owns, and the export
// side of the same feature is metered transfer on the production database. Reads and writes
// both refuse a non-operator rather than relying on the settings page not showing the card.
export const importBackup = createServerFn({ method: "POST" })
  .validator(importBackupSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureAdminSession();
      return importBackupForUser(session.user.id, data.backup);
    }),
  );
