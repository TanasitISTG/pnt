import { Card, CardContent } from "@/components/ui/card";

interface MetricProps {
  label: string;
  value: string | number;
}

export function Metric({ label, value }: MetricProps) {
  return (
    <Card size="sm">
      <CardContent>
        <div
          className="truncate font-semibold tabular-nums text-foreground text-[clamp(1.75rem,4vw,2.5rem)]"
          title={String(value)}
        >
          {value}
        </div>
        <div className="mt-1 text-caption text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
