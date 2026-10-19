import { z } from "zod";

import { AUDIENCE_RANGES } from "./types";

/**
 * The range is validated as the vocabulary the client and the server share, so an unknown
 * window is refused at the boundary instead of falling back to a report nobody asked for.
 */
export const audienceRangeSchema = z.enum(AUDIENCE_RANGES);

export const audienceInputSchema = z.object({
  novelId: z.string().min(1),
  range: audienceRangeSchema,
});

export const accountAudienceInputSchema = z.object({
  range: audienceRangeSchema,
});
