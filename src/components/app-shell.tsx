import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ChevronDown, LogIn, LogOut, Menu, Moon, Settings, Sun, X, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";
import type { User as AuthUser } from "@/lib/auth";
import { useConsent } from "@/lib/consent";
import { cn } from "@/lib/utils";

interface AppShellProps {
  user: AuthUser | null;
  children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();
  const router = useRouter();
  const { consent } = useConsent();

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.invalidate().finally(() => navigate({ to: "/" }));
        },
        onError: () => {
          setSigningOut(false);
        },
      },
    });
  };

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col bg-background transition-all",
        consent === "pending" && "pb-28 md:pb-20",
      )}
    >
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link
              to="/"
              className="flex items-center gap-2 text-card-title font-semibold text-foreground no-underline"
            >
              <img src="/logo-256.png" alt="" className="size-8 rounded-md" />
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
              {user && (
                <Link
                  to="/settings"
                  className="text-body-lg text-foreground no-underline hover:text-muted-foreground"
                  activeProps={{ className: "font-semibold" }}
                >
                  Settings
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" />
            <ThemeToggle />
            <div className="hidden md:block">
              {user ? (
                <UserDropdown user={user} signingOut={signingOut} onSignOut={handleSignOut} />
              ) : (
                <Button variant="ghost" render={<Link to="/login" />}>
                  <LogIn className="size-4" />
                  Sign in
                </Button>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
            >
              {menuOpen ? <X /> : <Menu />}
            </Button>
          </div>
        </div>
        {menuOpen && (
          <div id="mobile-nav" className="border-t border-border bg-background px-6 py-4 md:hidden">
            <nav className="flex flex-col gap-4">
              <Link
                to="/"
                className="text-body-lg text-foreground no-underline"
                onClick={() => setMenuOpen(false)}
              >
                Library
              </Link>
              {user && (
                <Link
                  to="/settings"
                  className="text-body-lg text-foreground no-underline"
                  onClick={() => setMenuOpen(false)}
                >
                  Settings
                </Link>
              )}
            </nav>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
              {user ? (
                <>
                  <span className="truncate text-caption text-muted-foreground">{user.email}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={handleSignOut}
                    disabled={signingOut}
                  >
                    {signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
                    {signingOut ? "Signing out…" : "Sign out"}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  render={<Link to="/login" />}
                  onClick={() => setMenuOpen(false)}
                >
                  <LogIn className="size-4" />
                  Sign in
                </Button>
              )}
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-8">{children}</main>
      <footer className="mt-12 border-t border-border bg-background py-6">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-4 px-6 sm:flex-row text-caption text-muted-foreground">
          <p>© {new Date().getFullYear()} Pnt — Personal Novel Translator</p>
          <div className="flex items-center gap-6">
            <Link to="/privacy" className="hover:text-foreground no-underline">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:text-foreground no-underline">
              Terms of Service
            </Link>
            <Link to="/cookie-policy" className="hover:text-foreground no-underline">
              Cookie Policy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-9"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

function UserDropdown({
  user,
  signingOut,
  onSignOut,
}: {
  user: AuthUser;
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
        <DropdownMenuGroup>
          <DropdownMenuItem
            render={<Link to="/settings" className="no-underline text-foreground" />}
          >
            <Settings className="size-4" />
            Settings
          </DropdownMenuItem>
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
