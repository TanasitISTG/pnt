import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TermCategory, TermStatus } from "@/lib/glossary.schemas";

const CATEGORY_ITEMS: Record<string, string> = {
  all: "All Categories",
  character: "Character",
  place: "Place",
  skill: "Skill",
  item: "Item",
  other: "Other",
};

const STATUS_ITEMS: Record<string, string> = {
  approved: "Approved",
  pending: "Pending",
  rejected: "Rejected",
  all: "All Status",
};

interface GlossaryFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  categoryFilter: TermCategory | "all";
  onCategoryFilterChange: (value: TermCategory | "all") => void;
  statusFilter: TermStatus | "all";
  onStatusFilterChange: (value: TermStatus | "all") => void;
}

export function GlossaryFilters({
  search,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  statusFilter,
  onStatusFilterChange,
}: GlossaryFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search source, target, or note..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
        <div className="w-full sm:w-44">
          <Select
            value={categoryFilter}
            onValueChange={(val) => onCategoryFilterChange(val as TermCategory | "all")}
            items={CATEGORY_ITEMS}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="character">Character</SelectItem>
              <SelectItem value="place">Place</SelectItem>
              <SelectItem value="skill">Skill</SelectItem>
              <SelectItem value="item">Item</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-full sm:w-36">
          <Select
            value={statusFilter}
            onValueChange={(val) => onStatusFilterChange(val as TermStatus | "all")}
            items={STATUS_ITEMS}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All Status</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
