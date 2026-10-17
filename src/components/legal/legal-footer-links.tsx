import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * The two links a policy page's closing sentence carries.
 *
 * These are `t.rich` tag renderers, not components: `t.rich` calls one function per tag with the
 * sentence's inner text, and each returns the link that should wrap it. They live at module scope
 * because they are handed over as props — a renderer written inside a page would be a new function
 * on every render, which is the shape React's own lint rules refuse, and the three pages would
 * spell the same link three times.
 */
const FOOTER_LINK_CLASS = "underline underline-offset-4 text-foreground";

export function privacyPolicyLink(chunks: ReactNode): ReactNode {
  return (
    <Link to="/{-$locale}/privacy" className={FOOTER_LINK_CLASS}>
      {chunks}
    </Link>
  );
}

export function termsOfServiceLink(chunks: ReactNode): ReactNode {
  return (
    <Link to="/{-$locale}/terms" className={FOOTER_LINK_CLASS}>
      {chunks}
    </Link>
  );
}

export function cookiePolicyLink(chunks: ReactNode): ReactNode {
  return (
    <Link to="/{-$locale}/cookie-policy" className={FOOTER_LINK_CLASS}>
      {chunks}
    </Link>
  );
}
