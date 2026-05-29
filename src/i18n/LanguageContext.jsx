// This file intentionally co-locates the LanguageProvider component with its
// useLanguage / useT hooks (the idiomatic React context pattern). That trips
// react-refresh/only-export-components, a dev-only Fast-Refresh rule — the
// alternative (splitting hooks into a separate module) would churn every import
// site app-wide for zero runtime benefit. Disabled here deliberately.
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo } from "react";
import { translate, LANGUAGES } from "./translations";

const LanguageContext = createContext({
  lang: "en",
  setLang: () => {},
  t: (key) => key,
});

export function LanguageProvider({ lang, setLang, children }) {
  const value = useMemo(() => ({
    lang,
    setLang,
    t: (key, vars) => translate(key, lang, vars),
  }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function useT() {
  return useContext(LanguageContext).t;
}

export { LANGUAGES };
