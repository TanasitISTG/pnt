import { queryOptions } from "@tanstack/react-query";

import { DEFAULT_AUDIENCE_RANGE } from "./aggregate";
import { getAccountAudience, getNovelAudience } from "./functions";
import type { AudienceRange } from "./types";

/**
 * One novel's report for one range.
 *
 * The range is part of the key rather than a filter applied to a cached answer: the server does
 * the counting per window, and two windows are two different reads. Switching back to a range
 * the screen already showed is then free, which is what makes the selector feel like a lens.
 * The numbers move when readers finish chapters, which is far slower than the screen's own
 * polling needs; a minute of staleness is a rounding error on a lifetime count.
 */
export const audienceQueryOptions = (
  novelId: string,
  range: AudienceRange = DEFAULT_AUDIENCE_RANGE,
) =>
  queryOptions({
    queryKey: ["novelAudience", novelId, range] as const,
    queryFn: () => getNovelAudience({ data: { novelId, range } }),
    staleTime: 60_000,
  });

/**
 * The account's own rollup, keyed by the range and nothing else: the answer is whatever this
 * session owns. A novel created or deleted elsewhere invalidates the whole key, not one entry.
 */
export const accountAudienceQueryOptions = (range: AudienceRange = DEFAULT_AUDIENCE_RANGE) =>
  queryOptions({
    queryKey: ["accountAudience", range] as const,
    queryFn: () => getAccountAudience({ data: { range } }),
    staleTime: 60_000,
  });
