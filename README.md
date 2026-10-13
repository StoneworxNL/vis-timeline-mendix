## VisTimeline

Mendix pluggable widget around [vis-timeline](https://github.com/visjs/vis-timeline) 8.5.4.

The goal of this widget is full coverage: everything demonstrated on the
[vis-timeline examples page](https://visjs.github.io/vis-timeline/examples/timeline/) can be configured from Studio Pro,
without writing JavaScript.

## Features

-   **Items** from any data source, with per item start/end, group, subgroup, type (box, point, range, background),
    class name, inline style, alignment, tooltip, order value, selectability and editability.
-   **Groups** with nesting through a self reference set, tree levels, visibility, expand state, ordering, subgroups and
    subgroup visibility.
-   **Templates**: item content, the visible frame of a range item, the group label and the tooltip can each be built
    from any Mendix widgets, rendered through React portals into the elements vis-timeline owns.
-   **Markers**: the current time bar plus a data source of draggable custom time bars, each with its own tooltip, CSS
    class and an optional label on the bar that the user can type in.
-   **Time axis**: visible window, min/max limits, fixed scale and step, custom moment.js label formats, week scale,
    locale and locale label overrides, a fixed time zone offset, hidden periods and rolling mode.
-   **Interaction**: selection (single, multi, per group, sequential) through the Mendix selection property or a two way
    bound attribute, move and zoom limits, zoom key, horizontal and vertical scrolling, click to use and clustering.
-   **Editing**: add, remove, drag in time, drag between groups, group add/remove/reorder, snapping to nice values or to
    a fixed number of minutes, and manipulation callbacks that hand the change to a microflow.
-   **Events**: click, double click, context menu, item hover in/out, external drop, selection change, window change,
    initial draw, marker move and marker label change, and the full set of item and group manipulation events - at
    widget level with the ids, or bound to the items data source so the microflow receives the object.
-   **Escape hatches**: a `Command` attribute for the imperative API, extra options as JSON, data attributes, and an XSS
    protection switch for HTML content.

## Usage

1. Place the widget on a page inside a data view.
2. Under **Items**, pick the data source and map at least **Item ID** and **Start**.
3. Optionally add a **Groups** data source and map **Group ID**; point **Item Group ID** at the same value so items land
   in the right row.
4. Configure the rest from the property tabs. Studio Pro hides the properties that do not apply to the choices you made
   and reports the combinations that cannot work.

### Identifiers

All ids (items, groups, subgroups, markers) are normalised to strings, so an Integer group id and a String item group id
still match each other. Ids are also reported back to microflows as strings.

### Controlling the timeline from a microflow

Write one of these values into the attribute bound to **Command** (Advanced → Control). The widget runs it and clears
the attribute again, so the same command can be used twice in a row.

| Command                            | Effect                                            |
| ---------------------------------- | ------------------------------------------------- |
| `fit`                              | Move the window so all items fit                  |
| `redraw`                           | Force a redraw                                    |
| `zoomIn` / `zoomOut`               | Zoom by 50%, or by `zoomIn:0.2`                   |
| `moveLeft` / `moveRight`           | Move by 20% of the window, or by `moveLeft:0.5`   |
| `toggleRollingMode`                | Turn rolling mode on or off                       |
| `focus:<id>`                       | Centre on one item, or several with `focus:1,2,3` |
| `focusSelection`                   | Centre on the current selection                   |
| `moveTo:<ISO date>`                | Centre on a moment in time                        |
| `setWindow:<ISO start>\|<ISO end>` | Set both bounds at once                           |

### Selection

There are two ways in, and they can be used together:

-   **Selection** (Interaction → Selection) is the Mendix selection property, bound to the items data source. It deals
    in objects, so a microflow or another widget on the page gets the item objects themselves. Choosing _Multi_ also
    switches multi select on.
-   **Selected item IDs** is a two way bound attribute holding the comma separated ids. Writing to it from a microflow
    changes the selection.

When both are bound, Selection decides what is shown as selected and the attribute is kept up to date alongside it.

### Actions that receive the object

The actions under **Events → Item** are bound to the items data source, so the microflow or page they call gets the item
object as its parameter - no retrieve from an id needed. **On item moved** also receives the new start, end and group,
so the drag can be written straight onto the object.

Their counterparts under **Events → Mouse** and **Events → Item manipulation** stay id based and still fire, which is
what a page needs when it reacts to a click on the background or the axis rather than on an item. Binding both means
both run.

### Editing behaviour

vis-timeline expects an answer while the user is still dragging, which a Mendix action cannot give. The three **Editing
→ Behaviour** properties decide what happens in the meantime:

-   _On add_: discard the drawn item and let the action create it through the data source (default), or keep it on
    screen and call the action.
-   _On move_: keep the new position and call the action (default), or revert and let the action move it through the
    data source.
-   _On remove_: keep the item until the action deletes it through the data source (default), or remove it immediately
    and call the action.

_On update_ always cancels the inline edit and calls the action, so the item can be edited on a page or in a microflow.

Reordering groups by dragging needs **Group order** set to _Order value_. The widget swaps the two order values and
calls **On group order swap** with both new values, so they can be persisted.

### Templates

Set **Content type** (or **Group content type**, **Tooltip type**) to _Custom_ and drop any widgets into the drop zone
that appears. They are rendered per row with the row's object in context, so data views, images, progress bars and
buttons all work. Plain HTML in an attribute works too, but only when **Disable XSS protection** is on - and only for
content you fully control.

### Click events

Clicking empty space, the time axis or a group label is still a click as far as vis-timeline is concerned. **On click
fires for** (and its double click and context menu counterparts) decides whether the action runs there too. The default,
_Items only_, means the action can count on an item ID being filled in. _Anywhere on the timeline_ reports every click,
with an empty item ID and the kind of thing that was hit in the `what` variable - that is what the Event listeners
example of vis-timeline does.

**On select** always fires, including when the selection is cleared, so the selected IDs can be empty there.

### Fitting the window

**Fit to items** decides when the window is moved to contain all items: never, on first load (default) or on every data
change. The fit waits for a layout pass, because vis-timeline derives the window from the _rendered_ width of the items.
When some of those items sit in a collapsed nested group vis-timeline cannot measure them and refuses to fit at all, so
the widget falls back to the plain date range of the data plus a small margin.

### Extra options

Anything not exposed as a property can be passed as JSON through **Advanced → Extra options (JSON)**. It is deep merged
into the options after everything else, so a single nested value can be overridden without losing its siblings:

```json
{ "orientation": { "axis": "top" }, "margin": { "item": { "vertical": 2 } } }
```

JSON cannot carry functions. The options that only accept a function are covered by dedicated properties instead:
snapping (**Snap to minutes**), item ordering (**Order value**), group ordering (**Group order**), subgroup ordering
(**Subgroup order field**) and the manipulation callbacks.

### Drag and drop onto the timeline

vis-timeline only reports a drop when the dragged element carries JSON with a `content` field. A Mendix page cannot set
drag data, so the widget does it: any element with `draggable="true"` and a `data-vis-timeline-item` attribute becomes a
drag source, and the attribute value is handed over as the drag data. With the HTML element widget that is two
attributes, for example `data-vis-timeline-item` = `{"type": "range", "content": "New task"}`.

From your own JavaScript the same works directly:

```js
event.dataTransfer.setData("text", JSON.stringify({ content: "New task", target: "item" }));
```

The raw JSON is handed to **On drop** together with the time and group it was dropped on. When **Editable: add** is on,
the drop also runs **On add**, whose **Content** variable carries the dropped item's content.

### What is in view

**On items in view changed** reports the ids of the items and of the groups inside the visible window, after moving,
zooming, scrolling or a data change. Only an actual change runs the action, so a microflow that updates the page from it
does not trigger itself again.

### Marker labels

**Marker label** puts text on the bar itself, as vis-timeline's custom time markers do; **Marker tooltip** stays the
hover text. Map **Marker label editable** to a Boolean to let the user type in the label. Every keystroke runs **On
marker label changing** and leaving the label runs **On marker label changed**, both with the marker id and the plain
text of the label; store the text in the attribute behind the label to keep it. A label the user is typing in is never
rebuilt from Mendix data, so the caret stays put while those actions run.

**On click** and **On double click** also report the id of the marker that was hit, which is what the vis-timeline
example of adding a marker on double click and removing it on a second double click needs.

## Security

-   **Every action variable is client input.** Item and group IDs, dates, `data`, `droppedData` and `addedContent` come
    from the browser and can be crafted, and **On drop** accepts text dragged in from any site. Microflows must check
    access and validate these values, and never commit straight from them. Prefer the actions under **Events → Item**,
    which receive the Mendix object itself.
-   **XSS protection** is on unless the **Disable XSS protection** property turns it off. `xss` in **Extra options
    (JSON)** is ignored, so the JSON cannot switch it off behind the property's back.
-   **Extra options (JSON)** never merges `__proto__`, `constructor` or `prototype` keys.

## Upgrading from the first version

The property keys of the first version are all still there, so existing pages keep their mappings. Three behaviours did
change, and pages built against the old widget need a look:

-   **On update** used to fire whenever the data source changed, which also meant a microflow could trigger itself. It
    now fires only when the user double clicks an editable item.
-   **On add**, **On update** and **On remove** pass the item as a JSON object in `data`. The old widget passed a JSON
    _array_ for add and update, and the bare item id for remove - which is now a separate `Item ID` variable.
-   **Fit to items** defaults to _On first load_. The old widget refitted on every data change, which is the _Every data
    change_ option.

## Examples page coverage

| Example                                                      | Configured with                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| Basic demo, Data serialization, External data                | Items data source                                             |
| Custom snapping                                              | Apply snapping, Snap to minutes                               |
| Individual editable items (+ override)                       | Item editability attributes, Timeline settings override items |
| itemsAlwaysDraggable                                         | Items always draggable, Ranges always resizable               |
| Manipulation callbacks, Update data on event                 | On add / update / move / moving / remove + Behaviour          |
| Editable groups, Group example, Groups ordering              | Groups data source, Order value, Group order, group editing   |
| Nested groups (2 and 3 levels)                               | Nested groups association, Tree level, Show nested groups     |
| Subgroups, Subgroup visibility                               | Item Subgroup ID, Subgroups data source, Stack subgroups      |
| Visible groups, Vertical items hide                          | Group visible, Maximum height, Vertical scroll                |
| Animate window, navigation menu                              | Window start/end, Command, Animate window changes             |
| Click to use, Limit move and zoom                            | Click to use, Minimum/Maximum date, zoom interval             |
| Select items, Sequential selection, Item selectability       | Selection group, Selectable per item                          |
| Selection driven by another widget on the page               | Selection property bound to the items data source             |
| Event listeners                                              | Events tab                                                    |
| Background areas (+ with groups), Point items                | Type attribute, Default item type                             |
| Dynamic content, HTML data, Templates, React components      | Custom content widgets                                        |
| Tooltips, Tooltip template, onUpdateTime tooltip             | Item tooltip group, Tooltip while dragging                    |
| Item ordering, Range overflow                                | Order value, Limit size                                       |
| Markers, Marker events, Editable markers, Current time       | Markers group, Marker label, On marker label changing/changed |
| A lot of grouped data, performance, Stress performance       | Only changed rows are pushed to vis, clustering               |
| Clustering                                                   | Cluster items and its sub properties                          |
| Custom label format, Show day scale with calendar week       | Minor/Major label formats, Show week scale                    |
| Localization, Custom localization, Time zone, RTL            | Localization group, Right to left                             |
| Data attributes (all)                                        | Data attributes                                               |
| Drag & drop                                                  | On drop, data-vis-timeline-item drag sources                  |
| Hiding periods                                               | Hidden periods data source                                    |
| Horizontal/Vertical/Bi-directional scroll, Invert            | Move and zoom group                                           |
| Loading screen                                               | Show loading overlay, On initial draw complete                |
| Rolling mode                                                 | Rolling mode, Rolling mode offset                             |
| Custom styling, Grid styling, Item class names, Week styling | Class name and Style attributes plus your own CSS             |
| Orientation                                                  | Axis orientation, Item orientation                            |
| Peer/Standalone/require.js builds                            | Not applicable, the widget ships its own bundle               |

## Development and contribution

1. Install NPM package dependencies by using: `npm install`. If you use NPM v7.x.x, which can be checked by executing
   `npm -v`, execute: `npm install --legacy-peer-deps`.
1. Run `npm start` to watch for code changes. On every change:
    - the widget will be bundled;
    - the bundle will be included in a `dist` folder in the root directory of the project;
    - the bundle will be included in the `deployment` and `widgets` folder of the Mendix test project.

Run `npm test` for the unit tests. They cover the layer between Mendix and vis-timeline - the data source mapping, the
options, the data set diff, the marker sync and the commands - by feeding the pure functions stand-ins for the Mendix
client values from `src/utils/testUtils.ts`. That is where the bugs live: an id read from the wrong place, a field that
is not cleared, an action that fires when it should not. Anything that needs a real timeline is not covered, so a change
to the React component still wants a look in a running app.

Source layout:

-   `src/VisTimeline.xml` - the property surface; `typings/VisTimelineProps.d.ts` is generated from it.
-   `src/components/VisTimelineComponent.tsx` - the React wrapper that owns the vis-timeline instance.
-   `src/utils/data.ts` - Mendix data sources to vis-timeline items, groups, markers and hidden dates.
-   `src/utils/options.ts` - properties to vis-timeline options.
-   `src/utils/sync.ts` - pushing only what changed into the vis-timeline data sets and markers.
-   `src/utils/actions.ts` - running Mendix actions and mirroring the selection back.
-   `src/utils/commands.ts` - the `Command` attribute.
-   `src/utils/values.ts` - attribute reading, id normalisation and JSON helpers.
-   `src/utils/vis.ts` - the two exports of the standalone build that its type declarations omit.
-   `src/utils/testUtils.ts` - Mendix client value stand-ins for the tests.
