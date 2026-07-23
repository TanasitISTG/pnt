import { Link } from "@tanstack/react-router";
import { BookOpen, Home } from "lucide-react";

import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
        <BookOpen className="size-7 text-muted-foreground" />
      </div>
      <h1 className="text-display font-bold text-foreground tracking-tight">404</h1>
      <h2 className="text-card-title font-semibold text-foreground mt-2">Page Not Found</h2>
      <p className="mt-2 max-w-sm text-body text-muted-foreground">
        The page or chapter you are looking for doesn't exist or has been moved.
      </p>
      <div className="mt-6">
        <Button render={<Link to="/" />}>
          <Home className="size-4" />
          Back to Library
        </Button>
      </div>
    </div>
  );
}
