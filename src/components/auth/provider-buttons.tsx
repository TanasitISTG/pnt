import { useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { FieldSeparator } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { authErrorMessage } from "@/lib/auth/error-codes";
import { signIn } from "@/lib/auth/auth-client";

type SocialProvider = "google" | "discord";

interface ProviderButtonsProps {
  google: boolean;
  discord: boolean;
  /** Where the provider should return the reader once the callback completes. */
  callbackURL: string;
  disabled?: boolean;
  onError: (message: string) => void;
}

/**
 * A provider's own name, which is a proper noun and stays put in both languages. The button's
 * wording around it comes from `auth.continueWith`.
 */
const PROVIDER_NAMES: Record<SocialProvider, string> = {
  google: "Google",
  discord: "Discord",
};

/**
 * Each provider's own glyph, in a single path filled with `currentColor`.
 *
 * Monochrome on purpose: the mark then inherits the button's foreground, so it is
 * legible on both surfaces and dark mode needs no second asset. Sizing comes from the
 * Button's `[&_svg:not([class*='size-'])]:size-4` rule rather than a class here.
 */
const PROVIDER_ICONS: Record<SocialProvider, ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.344-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z"
      />
    </svg>
  ),
  discord: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286ZM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189Zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  ),
};

/**
 * Social sign-in options, rendered only for providers this deployment configured.
 *
 * These belong *below* the credential form: an email and password is the primary path,
 * and the separator above the buttons then reads as "or continue with" for the form
 * the reader has just filled in — the reverse order asked them to pick a route before
 * they had seen the alternative.
 *
 * The buttons are the same width and height as the text inputs (`h-9 w-full`), so the
 * column reads as one stack of controls rather than two sizes of the same thing.
 *
 * The separator is separated by 16px rather than the field system's 20px, because the
 * gap either side of it is not a field boundary: the rule and its label carry the
 * break on their own, and the extra 4px on both sides is 8px of card height an
 * already-tall sign-up form does not need.
 */
export function ProviderButtons({
  google,
  discord,
  callbackURL,
  disabled,
  onError,
}: ProviderButtonsProps) {
  const t = useTranslations("auth");
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const providers: SocialProvider[] = [
    ...(google ? (["google"] as const) : []),
    ...(discord ? (["discord"] as const) : []),
  ];

  if (providers.length === 0) return null;

  const start = async (provider: SocialProvider) => {
    setPending(provider);
    try {
      const { error } = await signIn.social({ provider, callbackURL });
      if (error) {
        onError(
          authErrorMessage(error, "auth.providerFailed", { provider: PROVIDER_NAMES[provider] }),
        );
        setPending(null);
      }
    } catch {
      onError(t("providerFailed", { provider: PROVIDER_NAMES[provider] }));
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col">
      <FieldSeparator className="my-4">{t("or")}</FieldSeparator>
      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="outline"
            className="h-9 w-full"
            onClick={() => void start(provider)}
            disabled={disabled || pending !== null}
          >
            {pending === provider ? <Spinner /> : PROVIDER_ICONS[provider]}
            {t("continueWith", { provider: PROVIDER_NAMES[provider] })}
          </Button>
        ))}
      </div>
    </div>
  );
}
