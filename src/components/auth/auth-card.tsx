import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { QuietShell } from "@/components/shell/quiet-shell";

interface AuthCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Shell for every auth screen. One place owns the frame, the centred card, and the
 * alternate-action row so sign in, sign up, and the recovery screens cannot drift apart
 * visually.
 *
 * The frame is `QuietShell`, which supplies the parts a bare page used to be missing: the
 * skip link, the one `<main>` landmark, a brand link home, and the legal links. The card
 * itself therefore carries no mark - the frame's brand bar sits directly above it, and two
 * logos on one screen is one logo too many.
 *
 * Sign-up is the tightest case this shell has to hold - four fields, a consent row, and a
 * verification challenge - so the header stays short: a `text-card-title` heading, the same
 * step every other card title in the app starts at.
 *
 * The heading is a real `h1` so the screen has one document outline entry.
 */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <QuietShell>
      <div className="m-auto w-full max-w-md">
        <Card>
          <CardHeader className="items-center justify-items-center gap-1.5 text-center">
            <h1 className="text-card-title font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            {children}
            {footer ? (
              <div className="mt-4 border-t border-border pt-3.5 text-center text-caption text-muted-foreground">
                {footer}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </QuietShell>
  );
}
