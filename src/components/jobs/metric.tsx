import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

interface MetricProps {
  label: string;
  value: string | number;
  detail?: ReactNode;
  /**
   * `true` (the default) gives the number its own card. `false` drops the frame, which is
   * how a band header reuses the same typography without putting a card inside a card.
   */
  framed?: boolean;
}

/**
 * One number that answers a question, with the label asking it. The label names what the
 * number means ("Needs attention", not "Errors"), because a bare count is not a sentence.
 */
export function Metric({ label, value, detail, framed = true }: MetricProps) {
  const content = (
    <>
      <div
        className="truncate font-semibold tabular-nums text-foreground text-metric"
        title={String(value)}
      >
        {value}
      </div>
      <div className="mt-1 text-caption text-muted-foreground">{label}</div>
      {detail && <div className="mt-2 truncate text-micro text-muted-foreground">{detail}</div>}
    </>
  );

  if (!framed) return <div className="min-w-0">{content}</div>;

  return (
    <Card size="sm">
      <CardContent>{content}</CardContent>
    </Card>
  );
}
