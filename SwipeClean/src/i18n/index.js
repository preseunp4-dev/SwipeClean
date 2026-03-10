import { I18n } from 'i18n-js';
import { getLocales } from 'expo-localization';

import en from './en';
import nl from './nl';
import de from './de';
import fr from './fr';
import es from './es';
import it from './it';
import pt from './pt';
import ja from './ja';
import ko from './ko';
import zh from './zh';
import ar from './ar';
import tr from './tr';
import ru from './ru';
import da from './da';

const i18n = new I18n({
  en,
  nl,
  de,
  fr,
  es,
  it,
  pt,
  ja,
  ko,
  zh,
  ar,
  tr,
  ru,
  da,
});

i18n.enableFallback = true;
i18n.defaultLocale = 'en';

// Set locale from device
const locales = getLocales();
if (locales.length > 0) {
  i18n.locale = locales[0].languageCode || 'en';
}

export function t(key, options) {
  return i18n.t(key, options);
}

export default i18n;
