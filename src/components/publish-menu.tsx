import { useState } from "react";
import { ChevronDown, Globe, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { publishState } from "@/lib/publish";

interface PublishMenuProps {
  publishedAt: Date | string | null | undefined;
  onChange: (publishedAt: Date | null) => void;
  pending?: boolean;
}

// datetime-local values are local time with no timezone suffix
const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInputValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PublishMenu({ publishedAt, onChange, pending = false }: PublishMenuProps) {
  const state = publishState(publishedAt);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [value, setValue] = useState("");

  const openSchedule = () => {
    const base = publishedAt ? new Date(publishedAt) : new Date();
    setValue(toLocalInputValue(base));
    setScheduleOpen(true);
  };

  const label =
    state === "draft"
      ? "Draft"
      : state === "live"
        ? "Live"
        : `Scheduled ${new Date(publishedAt as string).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" disabled={pending} />}
          aria-label="Publishing options"
          title="Publishing options"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
          <span className="max-w-64 truncate">{label}</span>
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => onChange(new Date())}>Publish now</DropdownMenuItem>
            <DropdownMenuItem onClick={openSchedule}>Schedule…</DropdownMenuItem>
            {state !== "draft" && (
              <DropdownMenuItem onClick={() => onChange(null)}>Unpublish</DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule publish</DialogTitle>
            <DialogDescription>
              Guests can see it once this time passes. Leave as-is to keep the current schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="publish-at">Publish at</Label>
            <Input
              id="publish-at"
              type="datetime-local"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={!value || pending}
              onClick={() => {
                if (!value) return;
                onChange(new Date(value));
                setScheduleOpen(false);
              }}
            >
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
