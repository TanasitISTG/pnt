import { useSyncExternalStore } from "react";

const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerHydratedSnapshot);
}
