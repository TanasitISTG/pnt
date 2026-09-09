import { queryOptions } from "@tanstack/react-query";

import { listNovels } from "@/lib/content/novel.functions";

export const novelsQueryOptions = queryOptions({
  queryKey: ["novels"],
  queryFn: () => listNovels(),
});
