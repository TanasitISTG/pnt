import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { ensureSession } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import { importBackupForUser } from "./backup.service";

const importBackupSchema = z.object({ backup: z.unknown() });

export const importBackup = createServerFn({ method: "POST" })
  .validator(importBackupSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return importBackupForUser(session.user.id, data.backup);
    }),
  );
