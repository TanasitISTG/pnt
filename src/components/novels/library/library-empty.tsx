import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export interface LibraryEmptyProps {
  /** True only in the signed-in workspace (`scope === "mine"`). */
  canManage: boolean;
  signedIn: boolean;
}

/**
 * The empty state doubles as the guest's onboarding: a visitor who lands on a catalog
 * with nothing published yet is the one person who can change that, so the call to
 * action is here rather than only behind the header's account menu.
 */
export function LibraryEmpty({ canManage, signedIn }: LibraryEmptyProps) {
  if (canManage) {
    return (
      <EmptyState
        icon={<BookOpen />}
        title="No novels yet"
        description="Create a novel project to start pasting chapters and translating them."
      >
        <Button render={<Link to="/novels/new" />}>New novel</Button>
      </EmptyState>
    );
  }

  if (signedIn) {
    return (
      <EmptyState
        icon={<BookOpen />}
        title="Nothing published yet"
        description="Check back later — published novels from other translators will appear here."
      />
    );
  }

  return (
    <EmptyState
      icon={<BookOpen />}
      title="No novels yet"
      description="Create a free account to translate your own novels, with a side-by-side reader and glossary."
    >
      <Button render={<Link to="/signup" />}>Create account</Button>
      <Button variant="outline" render={<Link to="/login" />}>
        Sign in
      </Button>
    </EmptyState>
  );
}
