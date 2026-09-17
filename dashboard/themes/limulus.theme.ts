import { DeepPartial, Theme } from '@embeddable.com/remarkable-pro';

/**
 * The Limulus brand, as used on the marketing site.
 *
 * Semantic tokens only, plus font family and radius from core. That is
 * deliberate: the ~25 semantic tokens repaint every component in the library,
 * including ones added in future releases and any custom components we build,
 * whereas component-level tokens pin today's component set and fail silently
 * when the library renames one.
 *
 * The one rule this palette exists to enforce: colour means a state.
 * Red stopped a payment, amber is holding one, green released one. Nothing is
 * tinted for decoration, which is why the chart palette leads with the three
 * state colours rather than a rainbow — a bar that is red in a Limulus
 * dashboard should always mean the same thing as a red line in the product.
 */

// ---------------------------------------------------------------- palette
const palette = {
  // Warm neutrals. Not grey — the warmth is what stops it reading as a
  // default admin panel.
  white: 'rgb(255 255 255)',
  beige400: 'rgb(248 247 246)', // card fill
  beige300: 'rgb(244 242 241)', // borders, subtle fills
  beige200: 'rgb(237 235 232)', // muted fills
  beige100: 'rgb(210 205 198)',

  // Cool near-blacks for type. Body text is #262e41, never pure black.
  ink900: 'rgb(9 12 27)',
  ink800: 'rgb(25 31 43)',
  ink700: 'rgb(38 46 65)', // primary text
  ink500: 'rgb(82 93 115)', // muted text
  ink400: 'rgb(102 110 129)', // subtle text — the lightest value that clears
                              // 4.5:1 on the CARD, which is the stricter of the
                              // two grounds. The site's #a3a39e is decorative
                              // there; here it carries axis and legend labels.
  ink300: 'rgb(184 190 201)', // hairlines and disabled marks, never text

  // The accent. Horseshoe crab hemolymph runs blue, which is the whole reason
  // the company is called Limulus, so the blue carries a meaning.
  blood: 'rgb(47 65 242)',
  bloodWash: 'rgb(238 240 254)',

  // State. These three are load-bearing and must not be reused decoratively.
  stop: 'rgb(228 0 20)',       // fills and marks
  stopText: 'rgb(193 0 17)',   // same hue, darkened for text on the wash
                               // (228 0 20 lands at 4.24:1 there, just under AA)
  stopWash: 'rgb(253 235 236)',
  hold: 'rgb(249 109 74)',
  holdWash: 'rgb(254 241 237)',
  go: 'rgb(27 105 92)',
  goWash: 'rgb(232 246 243)',

  // Supporting hues, only for series beyond the three states.
  mint: 'rgb(122 232 214)',
  violet: 'rgb(155 120 221)',
  orchid: 'rgb(236 161 231)',
  sky: 'rgb(113 152 244)',
  lime: 'rgb(181 232 122)',
  teal: 'rgb(38 163 142)',
};

/**
 * Series order is shared by both variants on purpose. Colours bind to
 * dimension values in first-seen order and the binding is cached per theme,
 * so a value keeps its hue when someone flips to dark.
 *
 * Positions 1-3 are the verdict colours in verdict order: released, held,
 * blocked. A chart grouped on `decisions.outcome` therefore comes out in the
 * product's own colours without anyone configuring it.
 */
const series = [
  palette.go,      // released
  palette.hold,    // held / escalated
  palette.stop,    // blocked
  palette.blood,   // the accent, for non-state series
  palette.sky,
  palette.violet,
  palette.teal,
  palette.orchid,
  palette.lime,
  palette.ink500,
];

const fonts = {
  // defineTheme REPLACES arrays rather than merging them, so Inter has to be
  // listed here explicitly even though it is the library's base UI font.
  google: [
    { name: 'Schibsted Grotesk' },
    { name: 'Inter' },
    { name: 'Geist Mono' },
  ],
};

// --------------------------------------------------------------- light
export const limulusLight: DeepPartial<Theme> = {
  fonts,
  charts: {
    backgroundColors: series,
    borderColors: series,
  },
  styles: {
    // Type. Display face carries headings; Inter is the base UI font and
    // stays the body face, exactly as on the site.
    '--em-core-font-family--base': "'Inter', -apple-system, 'Segoe UI', Arial, sans-serif",
    '--em-core-font-family--code': "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",

    // Radius 8-10px. The library ramp is used by different components, so the
    // small end is tightened rather than everything set to one value.
    '--em-core-border-radius--100': '6px',
    '--em-core-border-radius--150': '8px',
    '--em-core-border-radius--200': '10px',
    '--em-core-border-radius--300': '10px',

    // Borders, not shadows. Depth on the site comes from a 1px warm line.
    '--em-core-shadow-blur': '0px',
    '--em-core-shadow-spread': '0px',
    '--em-core-shadow-position-x': '0px',
    '--em-core-shadow-position-y': '0px',
    '--em-core-shadow-color': 'rgb(0 0 0 / 0%)',

    // Surfaces: white page, warm off-white cards.
    '--em-sem-background': palette.white,
    '--em-sem-background--light': palette.beige400,
    '--em-sem-background--subtle': palette.beige300,
    '--em-sem-background--muted': palette.beige200,
    '--em-sem-background--neutral': palette.beige400,
    '--em-sem-background--inverted': palette.ink900,

    // Text.
    '--em-sem-text': palette.ink700,
    '--em-sem-text--neutral': palette.ink800,
    '--em-sem-text--muted': palette.ink500,
    '--em-sem-text--subtle': palette.ink400,
    '--em-sem-text--inverted': palette.white,

    // Status. Error is a blocked payment; success is a released one.
    '--em-sem-status-error-background': palette.stopWash,
    '--em-sem-status-error-text': palette.stopText,
    '--em-sem-status-success-background': palette.goWash,
    '--em-sem-status-success-text': palette.go,

    // Built-in chart fallbacks kept in step with charts.backgroundColors, so
    // anything reading the tokens directly still gets the verdict order.
    '--em-sem-chart-color--1': series[0],
    '--em-sem-chart-color--2': series[1],
    '--em-sem-chart-color--3': series[2],
    '--em-sem-chart-color--4': series[3],
    '--em-sem-chart-color--5': series[4],
    '--em-sem-chart-color--6': series[5],
    '--em-sem-chart-color--7': series[6],
    '--em-sem-chart-color--8': series[7],
    '--em-sem-chart-color--9': series[8],
    '--em-sem-chart-color--10': series[9],
  },
};

// ---------------------------------------------------------------- dark
// Derived from the same palette rather than a fresh one: the ink ramp becomes
// the ground and the warm neutrals become the type, so the two variants stay
// recognisably one brand. Washes are re-mixed for a dark ground — the light
// washes would be invisible — but the three state hues themselves do not move.
/**
 * Same order, one hue swapped. Deep green disappears on near-black, so
 * "released" borrows the mint the site already uses on dark grounds. Order is
 * what binds a value to a slot, so a value keeps its slot across variants —
 * only the ink in that slot changes.
 */
const darkSeries = [palette.mint, ...series.slice(1)];

export const limulusDark: DeepPartial<Theme> = {
  fonts,
  charts: {
    backgroundColors: darkSeries,
    borderColors: darkSeries,
  },
  styles: {
    ...limulusLight.styles,

    '--em-sem-background': palette.ink900,
    '--em-sem-background--light': palette.ink800,
    '--em-sem-background--subtle': 'rgb(30 37 52)',
    '--em-sem-background--muted': palette.ink700,
    '--em-sem-background--neutral': palette.ink800,
    '--em-sem-background--inverted': palette.white,

    '--em-sem-text': palette.white,
    '--em-sem-text--neutral': palette.beige300,
    '--em-sem-text--muted': palette.ink300,
    '--em-sem-text--subtle': 'rgb(122 132 152)',
    '--em-sem-text--inverted': palette.ink900,

    // Dark grounds need lifted foregrounds to stay legible; the wash becomes a
    // deep tint of the same hue rather than a pale one.
    '--em-sem-status-error-background': 'rgb(61 12 18)',
    '--em-sem-status-error-text': 'rgb(255 122 109)',
    '--em-sem-status-success-background': 'rgb(9 42 37)',
    '--em-sem-status-success-text': palette.mint,

    // Keep the token fallbacks in step with darkSeries.
    '--em-sem-chart-color--1': darkSeries[0],
  },
};
