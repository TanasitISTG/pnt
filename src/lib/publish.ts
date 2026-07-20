export type PublishState = "draft" | "scheduled" | "live";

export function publishState(
  publishedAt: Date | string | null | undefined,
  now: Date = new Date(),
): PublishState {
  if (!publishedAt) return "draft";
  return new Date(publishedAt) <= now ? "live" : "scheduled";
}
