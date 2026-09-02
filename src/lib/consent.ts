import { useSyncExternalStore } from "react";
import { useHydrated } from "@/lib/use-hydrated";

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

function subscribeToConsent(onStoreChange: () => void) {
  const handleConsentChange = () => onStoreChange();
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === CONSENT_KEY) onStoreChange();
  };

  window.addEventListener(CONSENT_EVENT, handleConsentChange);
  window.addEventListener("storage", handleStorageChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, handleConsentChange);
    window.removeEventListener("storage", handleStorageChange);
  };
}

function getServerConsentSnapshot(): ConsentState {
  return "pending";
}

export function useConsent() {
  const consent = useSyncExternalStore(subscribeToConsent, getConsent, getServerConsentSnapshot);
  const hydrated = useHydrated();
  return { consent, setConsent, hydrated };
}
