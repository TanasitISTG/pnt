import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { ensureSession } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import { exportBackupForUser, importBackupForUser } from "./backup.service";

const exportBackupSchema = z.object({ novelId: z.string().optional() }).optional();
const importBackupSchema = z.object({ backup: z.unknown() });

export const exportBackup = createServerFn({ method: "POST" })
  .validator(exportBackupSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return exportBackupForUser(session.user.id, data?.novelId);
    }),
  );

export const importBackup = createServerFn({ method: "POST" })
  .validator(importBackupSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return importBackupForUser(session.user.id, data.backup);
    }),
  );
