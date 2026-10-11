import * as VisTimelineModule from "vis-timeline/standalone";

/**
 * The standalone build ships a few extras that are not covered by the bundled type declarations:
 * the moment instance it uses internally, and the `timeline.TimeStep` class with the default
 * snapping implementation and label formats. They are needed to implement the time zone, locale,
 * snapping and label format properties, so they are picked up here through a single narrow cast.
 */
export interface VisMoment {
    locale(locale: string): VisMoment;
    utcOffset(offset: string): VisMoment;
    format(format: string): string;
    toDate(): Date;
}

interface VisMomentFactory {
    (input?: unknown): VisMoment;
    locales?: () => string[];
}

/** Moment format strings per time axis scale, for example `{ day: "D", month: "MMM" }`. */
export type LabelFormats = Record<string, string>;

interface VisStandaloneExtras {
    moment?: VisMomentFactory;
    timeline?: {
        TimeStep?: {
            snap?: (date: Date, scale: string, step: number) => Date;
            FORMAT?: { minorLabels: LabelFormats; majorLabels: LabelFormats };
        };
    };
}

const extras = VisTimelineModule as unknown as VisStandaloneExtras;

/** The moment factory bundled with vis-timeline, or undefined when the peer build is used. */
export const visMoment = extras.moment;

/** vis-timeline's own snapping function, used when snapping is on without a fixed interval. */
export const defaultSnap = extras.timeline?.TimeStep?.snap;

const format = extras.timeline?.TimeStep?.FORMAT;

/**
 * vis-timeline's default label formats, copied when this module loads. The time axis shares the
 * original objects between all timelines, so this copy is what each timeline builds its own on.
 */
export const defaultLabelFormats = format && {
    minorLabels: { ...format.minorLabels },
    majorLabels: { ...format.majorLabels }
};

/**
 * Turns the Locale property into a locale the bundled moment has loaded: as typed, lower case, with
 * a dash instead of an underscore, or just the language ('de_DE' becomes 'de'). Anything else falls
 * back to English. Moment itself would silently use its global locale for an unknown name, and the
 * standalone build leaves that on the last locale it registered (Ukrainian).
 */
export function resolveLocale(locale: string | undefined): string {
    const known = visMoment?.locales?.();
    if (!locale) {
        return "en";
    }
    if (!known) {
        return locale;
    }
    const normalized = locale.toLowerCase().replace("_", "-");
    const candidates = [locale, normalized, normalized.split("-")[0]];
    return candidates.find(candidate => known.includes(candidate)) ?? "en";
}
