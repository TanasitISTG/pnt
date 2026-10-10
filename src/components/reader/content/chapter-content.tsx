import { memo } from "react";

import type { ReaderContentProps } from "./reader-content-types";
import { ReaderContentView } from "./reader-content-view";

export type { ReaderContentProps } from "./reader-content-types";

export const ReaderContent = memo(function ReaderContent(props: ReaderContentProps) {
  return <ReaderContentView {...props} />;
});
