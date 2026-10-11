import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

interface AuthCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Shell for every auth screen. One place owns the centred card, the mark, and the
 * alternate-action row so sign in, sign up, and the two recovery screens cannot
 * drift apart visually.
 *
 * Sign-up is the tightest case this shell has to hold — four fields, a consent row,
 * and a verification challenge — so the header stays short: a 48px mark and a
 * `text-card-title` heading, the same step every other page title in the app starts
 * at. The 64px mark and 36px title it replaced grew the card past the height of a
 * short window, which put the submit button and the provider row below the fold.
 *
 * The heading is a real `h1` so the screen has one document outline entry, and the
 * mark carries an empty `alt` the way the app shell's does: it is decoration beside
 * a title that already names the page.
 *
 * Centring comes from `m-auto` on the wrapper rather than `items-center` on the flex
 * parent. A centred flex item that overflows its container is clipped above the top
 * of the viewport, where scrolling cannot reach it; auto margins collapse to zero
 * instead and let the tall card scroll normally.
 */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="flex min-h-dvh bg-background px-5 py-8">
      <div className="m-auto w-full max-w-md">
        <Card>
          {/* CardHeader is a grid, so centring needs `justify-items`: `items-center`
              only aligns along the block axis and leaves the mark pinned to the
              left edge of its column while the text centres itself. */}
          <CardHeader className="items-center justify-items-center gap-1.5 text-center">
            <img src="/logo-256.png" alt="" width={48} height={48} className="size-12 rounded-lg" />
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
    </div>
  );
}
