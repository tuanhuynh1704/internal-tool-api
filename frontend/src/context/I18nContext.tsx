import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, Language, TranslationKey } from '../i18n/translations';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey | string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType>({
  language: 'vi',
  setLanguage: () => {},
  toggleLanguage: () => {},
  t: (key: string) => key,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('internal_tool_language');
      if (saved === 'vi' || saved === 'en') return saved;
    } catch {}
    return 'vi'; // default to Vietnamese
  });

  const setLanguage = (newLang: Language) => {
    setLanguageState(newLang);
    try {
      localStorage.setItem('internal_tool_language', newLang);
    } catch {}
  };

  const toggleLanguage = () => {
    setLanguage(language === 'vi' ? 'en' : 'vi');
  };

  const t = (key: TranslationKey | string, params?: Record<string, string | number>): string => {
    const langDict = translations[language] || translations.vi;
    let text = (langDict as Record<string, string>)[key] || (translations.en as Record<string, string>)[key] || key;

    if (params) {
      Object.entries(params).forEach(([paramKey, val]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(val));
      });
    }

    return text;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => useContext(I18nContext);
