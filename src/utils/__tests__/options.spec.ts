import { buildStaticOptions } from "../options";
import { attribute, containerProps, dateAttribute, dynamic, listValue, Row } from "../testUtils";

/** Stands in for a moment instance: formatting returns the format string itself. */
const fakeMoment = { format: (format: string) => format };

describe("buildStaticOptions", () => {
    it("starts from the same defaults as vis-timeline itself", () => {
        const options = buildStaticOptions(containerProps()) as any;
        expect(options.editable).toEqual({
            add: false,
            remove: false,
            updateTime: false,
            updateGroup: false,
            overrideItems: false
        });
        expect(options.stack).toBe(true);
        expect(options.selectable).toBe(true);
        expect(options.orientation).toEqual({ axis: "bottom", item: "bottom" });
        expect(options.margin).toEqual({ axis: 20, item: { horizontal: 10, vertical: 10 } });
    });

    it("translates the zoom key none into the empty string vis-timeline expects", () => {
        expect(buildStaticOptions(containerProps({ zoomKey: "none" } as any)).zoomKey).toBe("");
        expect(buildStaticOptions(containerProps({ zoomKey: "ctrlKey" } as any)).zoomKey).toBe("ctrlKey");
    });

    it("leaves out the options that mean 'let vis-timeline decide', and defaults the locale to English", () => {
        const options = buildStaticOptions(containerProps());
        expect(options.type).toBeUndefined();
        expect(options.groupOrder).toBeUndefined();
        expect(options.timeAxis).toBeUndefined();
        expect(options.cluster).toBeUndefined();
        expect(options.height).toBeUndefined();
        expect(options.locale).toBe("en");
    });

    it("stacks items by their order value only when that attribute is mapped", () => {
        expect(buildStaticOptions(containerProps()).order).toBeUndefined();
        const order = buildStaticOptions(containerProps({ itemOrderValue: attribute("Order") } as any)).order as any;
        expect(order({ orderValue: 1 }, { orderValue: 3 })).toBeLessThan(0);
        expect(order({ orderValue: 5 }, { orderValue: 2 })).toBeGreaterThan(0);
    });

    it("sets a fixed scale only when one was chosen", () => {
        const options = buildStaticOptions(containerProps({ timeAxisScale: "hour", timeAxisStep: 4 } as any));
        expect(options.timeAxis).toEqual({ scale: "hour", step: 4 });
    });

    it("builds the cluster options only when clustering is on", () => {
        const options = buildStaticOptions(
            containerProps({ clusterItems: true, clusterMaxItems: 3, clusterTitleTemplate: dynamic("{count}x") } as any)
        ) as any;
        expect(options.cluster).toEqual({
            maxItems: 3,
            fitOnDoubleClick: true,
            showStipes: false,
            titleTemplate: "{count}x"
        });
    });

    it("reads the editing flags from their expressions", () => {
        const options = buildStaticOptions(
            containerProps({
                editableAdd: dynamic(true),
                editableUpdateTime: dynamic(true),
                groupEditableOrder: dynamic(true)
            } as any)
        );
        expect(options.editable).toMatchObject({ add: true, updateTime: true, remove: false });
        expect(options.groupEditable).toMatchObject({ order: true, add: false });
    });

    it("switches multi select on when the selection property is set to Multi", () => {
        expect(buildStaticOptions(containerProps()).multiselect).toBe(false);
        expect(buildStaticOptions(containerProps({ itemSelection: { type: "Multi" } } as any)).multiselect).toBe(true);
        expect(buildStaticOptions(containerProps({ itemSelection: { type: "Single" } } as any)).multiselect).toBe(
            false
        );
    });

    it("accepts both forms of the data attributes option", () => {
        expect(buildStaticOptions(containerProps({ dataAttributes: dynamic("all") } as any)).dataAttributes).toBe(
            "all"
        );
        expect(
            buildStaticOptions(containerProps({ dataAttributes: dynamic(" id , start ") } as any)).dataAttributes
        ).toEqual(["id", "start"]);
    });

    it("only overrides the locale labels that were given", () => {
        const options = buildStaticOptions(
            containerProps({ locale: dynamic("nl"), localeCurrentLabel: dynamic("nu") } as any)
        ) as any;
        expect(options.locale).toBe("nl");
        expect(options.locales).toEqual({ nl: { current: "nu" } });
    });

    it("parses the label formats and ignores a malformed one", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation();
        const options = buildStaticOptions(
            containerProps({
                formatMinorLabels: dynamic('{"day":"ddd D"}'),
                formatMajorLabels: dynamic("{oops")
            } as any)
        );
        const format = options.format as any;
        expect(format.minorLabels(fakeMoment, "day")).toBe("ddd D");
        expect(format.minorLabels(fakeMoment, "month")).toBe("MMM");
        expect(format.majorLabels(fakeMoment, "day")).toBe("MMMM YYYY");
        warn.mockRestore();
    });

    it("passes the label formats as functions, so timelines never share format objects", () => {
        const first = buildStaticOptions(containerProps({ formatMinorLabels: dynamic('{"day":"ddd D"}') } as any));
        const second = buildStaticOptions(containerProps());
        expect(typeof first.format?.minorLabels).toBe("function");
        expect((second.format as any).minorLabels(fakeMoment, "day")).toBe("D");
        expect((second.format as any).majorLabels(fakeMoment, "year")).toBe("");
    });

    it("resolves the locale to one moment has loaded, falling back to English", () => {
        const localeOf = (value?: string): string | undefined =>
            buildStaticOptions(containerProps(value ? ({ locale: dynamic(value) } as any) : undefined)).locale;
        expect(localeOf()).toBe("en");
        expect(localeOf("nl")).toBe("nl");
        expect(localeOf("NL")).toBe("nl");
        expect(localeOf("de_DE")).toBe("de");
        expect(localeOf("nl-BE")).toBe("nl");
        expect(localeOf("englsh")).toBe("en");
    });

    it("collects the hidden periods from their data source", () => {
        const rows: Row[] = [{ id: "1", from: "2024-05-04T00:00:00Z", to: "2024-05-06T00:00:00Z" }];
        const options = buildStaticOptions(
            containerProps({
                hiddenDatesDataSource: listValue(rows),
                hiddenDateStart: dateAttribute("from"),
                hiddenDateEnd: dateAttribute("to"),
                hiddenDateRepeat: attribute("repeat")
            } as any)
        );
        expect(options.hiddenDates).toHaveLength(1);
    });

    it("merges the JSON escape hatch last, without dropping the siblings of what it overrides", () => {
        const options = buildStaticOptions(
            containerProps({
                optionsJson: dynamic('{"orientation":{"axis":"top"},"tooltip":{"delay":0},"unknownOption":1}')
            } as any)
        ) as any;
        expect(options.orientation).toEqual({ axis: "top", item: "bottom" });
        expect(options.tooltip).toEqual({ followMouse: false, overflowMethod: "flip", delay: 0 });
        expect(options.unknownOption).toBe(1);
    });

    it("survives a JSON escape hatch that is not an object", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation();
        expect(() => buildStaticOptions(containerProps({ optionsJson: dynamic("nope") } as any))).not.toThrow();
        warn.mockRestore();
    });

    it("converts the numeric expressions vis-timeline wants as plain numbers", () => {
        const big = { toString: () => "315360000000000" };
        const options = buildStaticOptions(
            containerProps({
                zoomMax: { status: "available", value: big },
                rollingModeOffset: { toString: () => "0.25" }
            } as any)
        );
        expect(options.zoomMax).toBe(315360000000000);
        expect((options.rollingMode as any).offset).toBe(0.25);
    });
});
