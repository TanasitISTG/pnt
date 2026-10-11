import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ResolvedAvatar } from "@/lib/profile/types";

/**
 * Rendered size per variant. The photo editor sizes its crop stage from `lg`, so a
 * staged photo is never larger than the avatar it is about to replace.
 */
export const AVATAR_PIXELS = {
  sm: 28,
  default: 36,
  lg: 96,
} as const;

export type UserAvatarSize = keyof typeof AVATAR_PIXELS;

/** Code-point slice, so a name starting with an emoji or Thai cluster is not split. */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
  return `${Array.from(words[0])[0]}${Array.from(words[1])[0]}`.toUpperCase();
}

interface UserAvatarProps {
  name: string;
  avatar: ResolvedAvatar | null;
  size?: UserAvatarSize;
  className?: string;
}

/** Profile photo with an initials fallback, shared by the shell and the profile page. */
export function UserAvatar({ name, avatar, size = "default", className }: UserAvatarProps) {
  return (
    <Avatar size={size} className={className}>
      {avatar && (
        <AvatarImage
          src={avatar.url}
          srcSet={avatar.srcSet ?? undefined}
          sizes={`${AVATAR_PIXELS[size]}px`}
          alt=""
        />
      )}
      <AvatarFallback>{avatarInitials(name)}</AvatarFallback>
    </Avatar>
  );
}
