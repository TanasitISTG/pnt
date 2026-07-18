import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X, ChevronDown, LogOut, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";
import type { User } from "@/lib/auth";

interface AppShellProps {
  user: User;
  children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          navigate({ to: "/login" });
        },
        onError: () => {
          setSigningOut(false);
        },
      },
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-card-title font-semibold text-foreground no-underline">
              Pnt
            </Link>
            <nav className="hidden items-center gap-6 md:flex">
              <Link
                to="/"
                className="text-body-lg text-foreground no-underline hover:text-muted-foreground"
                activeProps={{ className: "font-semibold" }}
              >
                Library
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" />
            <div className="hidden md:block">
              <UserDropdown user={user} signingOut={signingOut} onSignOut={handleSignOut} />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              {menuOpen ? <X /> : <Menu />}
            </Button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-border bg-background px-6 py-4 md:hidden">
            <nav className="flex flex-col gap-4">
              <Link
                to="/"
                className="text-body-lg text-foreground no-underline"
                onClick={() => setMenuOpen(false)}
              >
                Library
              </Link>
            </nav>
            <div className="mt-4 border-t border-border pt-4">
              <div className="mb-3 text-caption text-muted-foreground">{user.email}</div>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                {signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-[1200px] px-6 py-8">{children}</main>
    </div>
  );
}

function UserDropdown({
  user,
  signingOut,
  onSignOut,
}: {
  user: User;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const displayName = user.name || user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="gap-2" />}
        disabled={signingOut}
      >
        {displayName}
        <ChevronDown className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="text-card-title text-foreground">{user.name}</div>
            <div className="text-caption text-muted-foreground">{user.email}</div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} disabled={signingOut}>
          {signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
