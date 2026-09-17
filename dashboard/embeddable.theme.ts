import { defineTheme } from '@embeddable.com/core';
import { Theme, DeepPartial } from '@embeddable.com/remarkable-pro';
import { limulusLight, limulusDark } from './themes/limulus.theme';

/**
 * Theme lookup. Runs on every theme change in the builder and in every embed,
 * so it stays pure and synchronous — no fetches, no globals.
 *
 * `dark` and `light` are kept as aliases because they are the keys a host app
 * passes at embed time; renaming them would break a live embed, and they cost
 * nothing to keep.
 */
const themes: Record<string, DeepPartial<Theme>> = {
  limulus: limulusLight,
  'limulus-dark': limulusDark,
  light: limulusLight,
  dark: limulusDark,
};

const themeProvider = (clientContext: any, parentTheme: Theme): Theme => {
  const key = clientContext?.theme;
  // Default to the brand's light variant rather than the library default, so
  // an embed that passes no theme at all still looks like Limulus.
  const theme = (key && themes[key]) || limulusLight;
  return defineTheme(parentTheme, theme) as Theme;
};

export default themeProvider;
