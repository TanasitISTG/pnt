import type { User as AuthUser } from "@/lib/auth/auth";

/** Profile-photo URLs for the browser, mirroring `ResolvedCover`. */
export interface ResolvedAvatar {
  url: string;
  srcSet: string | null;
}

/**
 * The signed-in viewer as the router context exposes it. `image` is deliberately
 * omitted: the stored value is an object-key prefix, not a URL, so the client gets
 * resolved addresses through `avatar` instead of a field it would misread as `src`.
 */
export type ViewerUser = Omit<AuthUser, "image">;

export interface ViewerProfile {
  user: ViewerUser;
  avatar: ResolvedAvatar | null;
  /**
   * Set while an operator is viewing as this account, which the shell renders as a
   * standing notice with the way back. Null in every ordinary session.
   */
  impersonation: ImpersonationState | null;
}

export interface ImpersonationState {
  operatorId: string;
  /** The operator's display name, or null when it could not be read. */
  operatorName: string | null;
}
