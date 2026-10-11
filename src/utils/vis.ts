import * as VisTimelineModule from "vis-timeline/standalone";

/**
 * The standalone build ships a few extras that are not covered by the bundled type declarations:
 * the moment instance it uses internally, and the `timeline.TimeStep.snap` helper that is the
 * default snapping implementation. Both are needed to implement the time zone and snapping
 * properties, so they are picked up here through a single narrow cast.
 */
interface VisMoment {
    locale(locale: string): VisMoment;
    utcOffset(offset: string): VisMoment;
    toDate(): Date;
}

interface VisStandaloneExtras {
    moment?: (input?: unknown) => VisMoment;
    timeline?: {
        TimeStep?: {
            snap?: (date: Date, scale: string, step: number) => Date;
        };
    };
}

const extras = VisTimelineModule as unknown as VisStandaloneExtras;

/** The moment factory bundled with vis-timeline, or undefined when the peer build is used. */
export const visMoment = extras.moment;

/** vis-timeline's own snapping function, used when snapping is on without a fixed interval. */
export const defaultSnap = extras.timeline?.TimeStep?.snap;
