import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const variant = status === "error" ? "destructive" : status === "done" ? "secondary" : "outline";
  return <Badge variant={variant}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}
