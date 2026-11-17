import { builtInLocale, snapToMinutes } from "../vis";

describe("snapToMinutes", () => {
    it("snaps to the hour on the clock of a half hour time zone", () => {
        // 14:10 in UTC+5:30 is 08:40Z; the nearest whole hour there is 14:00, which is 08:30Z.
        expect(snapToMinutes(new Date("2026-10-18T08:40:00Z"), 60, "+05:30").toISOString()).toBe(
            "2026-10-18T08:30:00.000Z"
        );
    });

    it("snaps a whole day to midnight in the configured offset", () => {
        // 14:10 at +02:00 rounds up to the next midnight there, 22:00Z.
        expect(snapToMinutes(new Date("2026-10-18T12:10:00Z"), 1440, "+02:00").toISOString()).toBe(
            "2026-10-18T22:00:00.000Z"
        );
    });

    it("uses the browser time zone when no offset is set", () => {
        const date = new Date(2026, 9, 18, 14, 10);
        const snapped = snapToMinutes(date, 60, undefined);
        expect([snapped.getHours(), snapped.getMinutes()]).toEqual([14, 0]);
        const midnight = snapToMinutes(date, 1440, undefined);
        expect([midnight.getDate(), midnight.getHours(), midnight.getMinutes()]).toEqual([19, 0, 0]);
    });
});

describe("snapToMinutes around daylight saving", () => {
    // Only meaningful in a zone with daylight saving, so each runs when TZ names its zone.
    const zoned = (zone: string): boolean => Intl.DateTimeFormat().resolvedOptions().timeZone === zone;

    (zoned("Europe/Lisbon") ? it : it.skip)("snaps a time in the skipped hour forward to when the clocks jump", () => {
        // 29 Mar 2026: 01:00 becomes 02:00. 00:55 rounds to the hour that does not exist.
        const snapped = snapToMinutes(new Date(2026, 2, 29, 0, 55), 60, undefined);
        expect([snapped.getHours(), snapped.getMinutes()]).toEqual([2, 0]);
    });

    (zoned("Europe/Amsterdam") ? it : it.skip)("snaps to midnight on the day the clocks go back", () => {
        const snapped = snapToMinutes(new Date(2026, 9, 25, 14, 10), 1440, undefined);
        expect([snapped.getDate(), snapped.getHours()]).toEqual([26, 0]);
    });
});

describe("builtInLocale", () => {
    it("finds vis-timeline's wording however the locale is written", () => {
        expect(builtInLocale("nl")?.current).toBe("huidige");
        expect(builtInLocale("fr-ca")?.current).toBe("actuel");
        expect(builtInLocale("de-at")?.time).toBe("Zeit");
        expect(builtInLocale("hy-am")).toEqual(builtInLocale("en"));
    });
});
