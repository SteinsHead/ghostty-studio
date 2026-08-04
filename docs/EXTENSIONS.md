# Declarative extension packs

> Experimental design. Extension installation is not available in the current app.

Ghostty Studio extensions are strict JSON data, not executable plugins. The
main WebView never imports third-party JavaScript or HTML, and extension packs
cannot access files, the network, processes, or Tauri IPC.

## Supported contributions

- `schema.metadata`: labels, categories, aliases, control hints, choices, and risk level.
- `presets`: named setting-value maps that always produce a reviewable draft.
- `migrations.declarative`: key renames and finite value mappings.
- `preview.declarative`: safe visual-preview metadata (reserved for a later phase).
- `core.override`: core metadata replacement, accepted only for explicitly trusted,
  integrity-pinned packs.

Unknown JSON fields are rejected. A manifest is limited to 512 KiB and 1,000
contributions. IDs and versions are validated, requested capabilities are
allowlisted, and host/Ghostty compatibility uses semantic version requirements.

## Example

```json
{
  "manifestVersion": 1,
  "id": "dev.example.workflow",
  "name": "Example workflow metadata",
  "version": "1.2.0",
  "hostApi": "^1.0",
  "ghostty": ">=1.3",
  "capabilities": ["schema.metadata", "presets"],
  "contributes": {
    "settings": [
      {
        "key": "example-mode",
        "category": "Example",
        "kind": "select",
        "choices": ["a", "b"],
        "risk": "normal"
      }
    ],
    "presets": [
      {
        "id": "dev.example.fast",
        "name": "Fast",
        "values": { "example-mode": ["a"] }
      }
    ]
  }
}
```

Installation, trust, and signing UI will be added only after the config graph
and restore flows are complete. Until then this format is a validated core API,
not a promise to execute downloaded content.
