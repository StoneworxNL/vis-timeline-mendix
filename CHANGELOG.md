# Changelog

All notable changes to this widget are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the widget uses semantic versioning.

## [2.0.0]

### Added

-   The full vis-timeline feature set: item, group, subgroup, marker and hidden-period mapping and about 165 properties
    covering the vis-timeline options. The README maps every vis-timeline example to the properties that cover it.
-   Mendix widgets as item, group, visible-frame and tooltip templates.
-   Two-way selection through a selection property or a comma separated attribute.
-   Actions bound to the items data source, which receive the Mendix object.
-   A `Command` attribute for the imperative API (`fit`, `focus:`, `zoomIn`, `setWindow:…|…`).
-   Marker labels, drag sources without JavaScript, and **On items in view changed**.
-   **Extra options (JSON)** for any vis-timeline option the properties do not expose.

### Changed

-   **On update**, **On add** and **On remove** pass different variables, and **Fit to items** defaults to _On first
    load_. See _Upgrading from the first version_ in the README.
-   A click on a marker counts as a hit for **On click** and **On double click** with the default scope, which is now
    called _Items and markers_.
-   Requires Node 20 or later to build.

### Fixed

-   Moves, removals and adds that Mendix refuses no longer stay on the timeline, and items the timeline created itself
    no longer show up twice once the Mendix object arrives.
-   Actions no longer go stale after the first render, and rows deleted in Mendix leave the timeline.
-   Numeric ids, `fit()` before layout, focus on box and point items, group reordering, and axis labels in the
    configured locale.
-   The "in view" check no longer runs after the timeline is destroyed.
-   Label formats changed at runtime are applied.
-   `fit`, `focus`, `moveTo`, `setWindow` and the move commands leave rolling mode first instead of fighting it, and
    zooming while rolling no longer stutters.
-   Tooltips are no longer cut off at the edge of the timeline.

### Security

-   **Extra options (JSON)** can no longer write into `Object.prototype` or turn off XSS protection.
-   moment 2.31.0 and uuid 13.0.2 in the lockfile, so `npm audit --omit=dev` is clean.

## [1.0.0]

-   First version.
