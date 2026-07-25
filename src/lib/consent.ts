import { useEffect, useState } from "react";

export type ConsentState = "pending" | "granted" | "denied";

const CONSENT_KEY = "pnt-consent-v1";
const CONSENT_EVENT = "pnt-consent-change";

export function getConsent(): ConsentState {
  if (typeof window === "undefined") return "pending";
  const val = localStorage.getItem(CONSENT_KEY);
  if (val === "granted" || val === "denied") return val;
  return "pending";
}

export function setConsent(value: ConsentState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONSENT_KEY, value);
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
}

let cachedConsent: ConsentState | null = null;

export function useConsent() {
  const [consent, setConsentState] = useState<ConsentState>(() => cachedConsent ?? "pending");
  const [hydrated, setHydrated] = useState(cachedConsent !== null);

  useEffect(() => {
    if (cachedConsent === null) {
      cachedConsent = getConsent();
    }
    setConsentState(cachedConsent);
    setHydrated(true);

    const handleCustomEvent = (e: Event) => {
      const custom = e as CustomEvent<ConsentState>;
      if (custom.detail) {
        cachedConsent = custom.detail;
        setConsentState(custom.detail);
      }
    };
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === CONSENT_KEY) {
        const next = getConsent();
        cachedConsent = next;
        setConsentState(next);
      }
    };

    window.addEventListener(CONSENT_EVENT, handleCustomEvent);
    window.addEventListener("storage", handleStorageEvent);

    return () => {
      window.removeEventListener(CONSENT_EVENT, handleCustomEvent);
      window.removeEventListener("storage", handleStorageEvent);
    };
  }, []);

  const handleSetConsent = (value: ConsentState) => {
    cachedConsent = value;
    setConsent(value);
  };

  return { consent, setConsent: handleSetConsent, hydrated };
}
