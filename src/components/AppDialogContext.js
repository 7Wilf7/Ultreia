import { createContext, useContext } from "react";

export const AppDialogContext = createContext(null);

export function useAppDialog() {
  const ctx = useContext(AppDialogContext);
  if (!ctx) {
    return {
      alert: async (message) => window.alert(message),
      confirm: async (message) => window.confirm(message),
    };
  }
  return ctx;
}
