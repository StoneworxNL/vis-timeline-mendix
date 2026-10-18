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
    utcOffset(): number;
    format(format: string): string;
    toDate(): Date;
    date(): number;
    weekday(): number;
}

interface VisMomentFactory {
    (input?: unknown): VisMoment;
    locales?: () => string[];
}

/** Moment format strings per time axis scale, for example `{ day: "D", month: "MMM" }`. */
export type LabelFormats = Record<string, string>;

/** vis-timeline's own wording for one locale: the current time and marker tooltips, the delete button. */
export type VisLocale = Record<string, string>;

interface VisStandaloneExtras {
    moment?: VisMomentFactory;
    timeline?: {
        TimeStep?: {
            snap?: (date: Date, scale: string, step: number) => Date;
            FORMAT?: { minorLabels: LabelFormats; majorLabels: LabelFormats };
        };
        components?: {
            CurrentTime?: new (body: unknown, options: unknown) => {
                defaultOptions?: { locales?: Record<string, VisLocale> };
            };
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

/**
 * vis-timeline's built-in locales. They are not exported, but every current time bar starts from
 * them, and creating one only builds a detached element. They are needed because setOptions
 * replaces `locales` as a whole: a locale entry with only the labels the widget sets would lose
 * the rest of vis-timeline's wording for that locale.
 */
export const builtInLocales: Record<string, VisLocale> | undefined = (() => {
    const CurrentTime = extras.timeline?.components?.CurrentTime;
    try {
        return CurrentTime ? new CurrentTime(undefined, {}).defaultOptions?.locales : undefined;
    } catch {
        return undefined;
    }
})();

/**
 * vis-timeline's wording for a locale the moment way of writing it ('fr-ca'), which vis-timeline
 * keys as 'fr_CA'. Falls back to the language, then to English.
 */
export function builtInLocale(locale: string): VisLocale | undefined {
    if (!builtInLocales) {
        return undefined;
    }
    const [language, region] = locale.split("-");
    const candidates = [locale, region ? `${language}_${region.toUpperCase()}` : language, language, "en"];
    const key = candidates.find(candidate => candidate in builtInLocales);
    return key === undefined ? undefined : builtInLocales[key];
}

/**
 * The UTC offset in minutes that the axis uses at a given moment: the Time zone offset property
 * when it is set, otherwise the browser's own offset on that date (which follows daylight saving).
 */
export function utcOffsetMinutes(date: Date, offset: string | undefined): number {
    if (offset && visMoment) {
        return visMoment(date).utcOffset(offset).utcOffset();
    }
    return -date.getTimezoneOffset();
}

/**
 * Rounds a date to a whole number of minutes on the clock the axis shows, so with a 60 minute
 * interval an item lands on the hour in UTC+5:30 too, and with 1440 minutes on a local midnight.
 */
export function snapToMinutes(date: Date, minutes: number, offset: string | undefined): Date {
    const interval = minutes * 60000;
    const shift = utcOffsetMinutes(date, offset) * 60000;
    const local = Math.round((date.valueOf() + shift) / interval) * interval;
    // The offset can differ on the snapped date when the two sit on either side of a daylight
    // saving change, so the result is shifted back with the offset that applies there.
    const guess = new Date(local - shift);
    return new Date(local - utcOffsetMinutes(guess, offset) * 60000);
}
