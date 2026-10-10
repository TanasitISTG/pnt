import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

interface MetricProps {
  label: string;
  value: string | number;
  detail?: ReactNode;
}

export function Metric({ label, value, detail }: MetricProps) {
  return (
    <Card size="sm">
      <CardContent>
        <div
          className="truncate font-semibold tabular-nums text-foreground text-metric"
          title={String(value)}
        >
          {value}
        </div>
        <div className="mt-1 text-caption text-muted-foreground">{label}</div>
        {detail && <div className="mt-2 truncate text-micro text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  );
}
