## VisTimeline

Mendix pluggable widget around [vis-timeline](https://github.com/visjs/vis-timeline) 8.5.4.

The goal of this widget is full coverage: everything demonstrated on the
[vis-timeline examples page](https://visjs.github.io/vis-timeline/examples/timeline/) can be
configured from Studio Pro, without writing JavaScript.

## Features

- **Items** from any data source, with per item start/end, group, subgroup, type (box, point, range,
  background), class name, inline style, alignment, tooltip, order value, selectability and
  editability.
- **Groups** with nesting through a self reference set, tree levels, visibility, expand state,
  ordering, subgroups and subgroup visibility.
- **Templates**: item content, the visible frame of a range item, the group label and the tooltip can
  each be built from any Mendix widgets, rendered through React portals into the elements
  vis-timeline owns.
- **Markers**: the current time bar plus a data source of draggable custom time bars, each with its
  own tooltip and CSS class.
- **Time axis**: visible window, min/max limits, fixed scale and step, custom moment.js label
  formats, week scale, locale and locale label overrides, a fixed time zone offset, hidden periods
  and rolling mode.
- **Interaction**: selection (single, multi, per group, sequential) with a two way bound attribute,
  move and zoom limits, zoom key, horizontal and vertical scrolling, click to use and clustering.
- **Editing**: add, remove, drag in time, drag between groups, group add/remove/reorder, snapping to
  nice values or to a fixed number of minutes, and manipulation callbacks that hand the change to a
  microflow.
- **Events**: click, double click, context menu, item hover in/out, external drop, selection change,
  window change, initial draw, marker move, and the full set of item and group manipulation events.
- **Escape hatches**: a `Command` attribute for the imperative API, extra options as JSON, data
  attributes, and an XSS protection switch for HTML content.

## Usage

1. Place the widget on a page inside a data view.
2. Under **Items**, pick the data source and map at least **Item ID** and **Start**.
3. Optionally add a **Groups** data source and map **Group ID**; point **Item Group ID** at the same
   value so items land in the right row.
4. Configure the rest from the property tabs. Studio Pro hides the properties that do not apply to
   the choices you made and reports the combinations that cannot work.

### Identifiers

All ids (items, groups, subgroups, markers) are normalised to strings, so an Integer group id and a
String item group id still match each other. Ids are also reported back to microflows as strings.

### Controlling the timeline from a microflow

Write one of these values into the attribute bound to **Command** (Advanced → Control). The widget
runs it and clears the attribute again, so the same command can be used twice in a row.

| Command | Effect |
| --- | --- |
| `fit` | Move the window so all items fit |
| `redraw` | Force a redraw |
| `zoomIn` / `zoomOut` | Zoom by 50%, or by `zoomIn:0.2` |
| `moveLeft` / `moveRight` | Move by 20% of the window, or by `moveLeft:0.5` |
| `toggleRollingMode` | Turn rolling mode on or off |
| `focus:<id>` | Centre on one item, or several with `focus:1,2,3` |
| `focusSelection` | Centre on the current selection |
| `moveTo:<ISO date>` | Centre on a moment in time |
| `setWindow:<ISO start>\|<ISO end>` | Set both bounds at once |

**Selected item IDs** is two way: the widget writes the comma separated selection into it, and
writing to it from a microflow changes the selection.

### Editing behaviour

vis-timeline expects an answer while the user is still dragging, which a Mendix action cannot give.
The three **Editing → Behaviour** properties decide what happens in the meantime:

- *On add*: discard the drawn item and let the action create it through the data source (default), or
  keep it on screen and call the action.
- *On move*: keep the new position and call the action (default), or revert and let the action move
  it through the data source.
- *On remove*: keep the item until the action deletes it through the data source (default), or remove
  it immediately and call the action.

*On update* always cancels the inline edit and calls the action, so the item can be edited on a page
or in a microflow.

Reordering groups by dragging needs **Group order** set to *Order value*. The widget swaps the two
order values and calls **On group order swap** with both new values, so they can be persisted.

### Templates

Set **Content type** (or **Group content type**, **Tooltip type**) to *Custom* and drop any widgets
into the drop zone that appears. They are rendered per row with the row's object in context, so
data views, images, progress bars and buttons all work. Plain HTML in an attribute works too, but
only when **Disable XSS protection** is on - and only for content you fully control.

### Fitting the window

**Fit to items** decides when the window is moved to contain all items: never, on first load
(default) or on every data change. The fit waits for a layout pass, because vis-timeline derives the
window from the *rendered* width of the items. When some of those items sit in a collapsed nested
group vis-timeline cannot measure them and refuses to fit at all, so the widget falls back to the
plain date range of the data plus a small margin.

### Extra options

Anything not exposed as a property can be passed as JSON through **Advanced → Extra options (JSON)**.
It is deep merged into the options after everything else, so a single nested value can be overridden
without losing its siblings:

```json
{ "orientation": { "axis": "top" }, "margin": { "item": { "vertical": 2 } } }
```

JSON cannot carry functions. The options that only accept a function are covered by dedicated
properties instead: snapping (**Snap to minutes**), item ordering (**Order value**), group ordering
(**Group order**), subgroup ordering (**Subgroup order field**) and the manipulation callbacks.

### Drag and drop onto the timeline

vis-timeline only reports a drop when the dragged element carries JSON with a `content` field:

```js
event.dataTransfer.setData("text", JSON.stringify({ content: "New task", target: "item" }));
```

The raw JSON is handed to **On drop** together with the time and group it was dropped on.

## Examples page coverage

| Example | Configured with |
| --- | --- |
| Basic demo, Data serialization, External data | Items data source |
| Custom snapping | Apply snapping, Snap to minutes |
| Individual editable items (+ override) | Item editability attributes, Timeline settings override items |
| itemsAlwaysDraggable | Items always draggable, Ranges always resizable |
| Manipulation callbacks, Update data on event | On add / update / move / moving / remove + Behaviour |
| Editable groups, Group example, Groups ordering | Groups data source, Order value, Group order, group editing |
| Nested groups (2 and 3 levels) | Nested groups association, Tree level, Show nested groups |
| Subgroups, Subgroup visibility | Item Subgroup ID, Subgroups data source, Stack subgroups |
| Visible groups, Vertical items hide | Group visible, Maximum height, Vertical scroll |
| Animate window, navigation menu | Window start/end, Command, Animate window changes |
| Click to use, Limit move and zoom | Click to use, Minimum/Maximum date, zoom interval |
| Select items, Sequential selection, Item selectability | Selection group, Selectable per item |
| Event listeners | Events tab |
| Background areas (+ with groups), Point items | Type attribute, Default item type |
| Dynamic content, HTML data, Templates, React components | Custom content widgets |
| Tooltips, Tooltip template, onUpdateTime tooltip | Item tooltip group, Tooltip while dragging |
| Item ordering, Range overflow | Order value, Limit size |
| Markers, Marker events, Editable markers, Current time | Markers group, On marker moving/moved |
| A lot of grouped data, performance, Stress performance | Only changed rows are pushed to vis, clustering |
| Clustering | Cluster items and its sub properties |
| Custom label format, Show day scale with calendar week | Minor/Major label formats, Show week scale |
| Localization, Custom localization, Time zone, RTL | Localization group, Right to left |
| Data attributes (all) | Data attributes |
| Drag & drop | On drop |
| Hiding periods | Hidden periods data source |
| Horizontal/Vertical/Bi-directional scroll, Invert | Move and zoom group |
| Loading screen | Show loading overlay, On initial draw complete |
| Rolling mode | Rolling mode, Rolling mode offset |
| Custom styling, Grid styling, Item class names, Week styling | Class name and Style attributes plus your own CSS |
| Orientation | Axis orientation, Item orientation |
| Peer/Standalone/require.js builds | Not applicable, the widget ships its own bundle |

## Development and contribution

1. Install NPM package dependencies by using: `npm install`. If you use NPM v7.x.x, which can be
   checked by executing `npm -v`, execute: `npm install --legacy-peer-deps`.
1. Run `npm start` to watch for code changes. On every change:
    - the widget will be bundled;
    - the bundle will be included in a `dist` folder in the root directory of the project;
    - the bundle will be included in the `deployment` and `widgets` folder of the Mendix test project.

Source layout:

- `src/VisTimeline.xml` - the property surface; `typings/VisTimelineProps.d.ts` is generated from it.
- `src/components/VisTimelineComponent.tsx` - the React wrapper that owns the vis-timeline instance.
- `src/utils/data.ts` - Mendix data sources to vis-timeline items, groups, markers and hidden dates.
- `src/utils/options.ts` - properties to vis-timeline options.
- `src/utils/commands.ts` - the `Command` attribute.
- `src/utils/values.ts` - attribute reading, id normalisation and JSON helpers.
- `src/utils/vis.ts` - the two exports of the standalone build that its type declarations omit.
