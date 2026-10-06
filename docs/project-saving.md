# Host Project Save

The native **File → Save Project** menu invokes the Host command `project.save`,
which delegates to `runtime.projectSave()`. The menu definition lives in
`cmd/app/src/core/menu.js`. Standard native menus are retained. The menu item is
disabled until filesystem/plugin bootstrap and UI/layout initialization complete.

**All keyboard bindings belong to `gams.json` `ui.keys`.** The Host installs no
Save accelerator or key listener. Ordinary `activeView.save` / `activeView.saveAs`
bindings remain independent from the Host's `project.save` command. For example,
a Project can retain Cmd/Ctrl+S for its active View and opt into a separate shortcut:

```json
[
  { "key": "mod+s", "call": ["activeView.save"], "allowInput": true },
  { "key": "mod+alt+s", "call": ["project.save"], "allowInput": true }
]
```

This is an illustrative `ui.keys` array, not a Host default or a config migration.
Projects may choose another shortcut or assign `mod+s` to `project.save` explicitly.
Configured and menu-triggered Project Save requests share one in-flight operation.

The Host command creates one primary-position progress toast through the Toast
UI Service's `progressStart` / `progressUpdate` API. It reports each hook, config
writing and publication, then converts the same toast to `progressSuccess`
("Project saved", three seconds) or `progressError` (persistent failure details).
Repeated menu/shortcut requests share one operation and toast. An external Project
must supply a Toast UI Service supporting these progress methods; missing or
malformed service APIs fail loudly rather than silently omitting feedback.

Save stages are also logged with the `[project.save]` console prefix, including
hook IDs, config writing/publication and completion. Failures use `console.error`;
config contents are not logged. The UI command returns `{ err }` after showing
an operation error, avoiding a duplicate global unhandled-rejection toast.

## Register persistence hooks

A JS plugin registers an optional `methods.projectSave` through
`runtime.register`. A View using `/util/view-plugin.js` can implement
`projectSave()` or supply a custom `projectSave` in the methods argument:

```js
async projectSave() {
    // View/plugin decides what to save and what belongs in Project Config.
    runtime.config.ui.views["view-example"].config = this.exportConfig()
    return { ok: true }
}
```

Existing `.save` and `.saveAs` commands are unchanged and are **not** broadcast.
A View without `projectSave()` has a no-op binding. Native WASM exports are not
automatically enumerated; a JS adapter can register a hook that invokes them.

Hooks present at the beginning of a save run sequentially in runtime registration
order. Unregistering before a save removes participation; registrations made
during an operation participate next time. Replacing an already registered ID
retains its position until it is unregistered and registered again.

Each hook must await its work and may mutate `runtime.config`. Resolving without
a result or with a successful result is allowed. Throwing or returning `{ err }`
stops the save before config publication. Hooks must not swallow errors or call
`runtime.projectSave()` recursively. Concurrent external callers share the same
in-flight operation; after success or failure a later call starts a new operation.
`runtime.projectSave(onProgress)` optionally accepts an awaited callback receiving
`{ message, progress }`, with progress from 0 to 1 based on completed hooks plus
config write/publication steps (not byte or time estimates). Only the caller that
starts an operation supplies its progress callback. Direct runtime calls retain
reject-on-failure behavior and console logging without requiring UI feedback.

## Config publication

After all hooks succeed, the Host serializes the **current** `runtime.config` as
pretty JSON with a trailing newline. It writes a uniquely named sibling
`.gams.json.<uuid>.tmp` through `fs/fs::write-text`, then replaces `gams.json`
through `fs/fs::rename`. Both paths are relative to the active native Project
root, not the Unit installation directory. The filesystem Unit is required.

A hook or serialization failure causes no config write. A failed temporary write
or rename leaves the existing config untouched; interrupted/failed saves may leave
an unused temporary file. This is not a transaction across hooks: earlier file
writes and in-memory config mutations are not rolled back. It does not implement
external-edit conflict detection or crash-durable filesystem synchronization.

The Host does **not** snapshot layout or individual View state itself. The layout
UI Service must register its own persistence hook to update config before saving;
until then, geometry changes are not saved just by serializing the initial config.
Save As, Project switching, and copying Project files are outside this slice.

## Verification

```sh
nix develop --command node --test test/*.test.mjs
```

`test/project-save.test.mjs` covers registration, ordering, config updates,
unregistration, failure/retry, concurrent-save coalescing, temporary publication,
View bindings and the native-menu adapter with mocked Tauri/filesystem APIs.
Real Project-configured shortcut dispatch and filesystem replacement still need
desktop smoke testing with an externally supplied Project.
