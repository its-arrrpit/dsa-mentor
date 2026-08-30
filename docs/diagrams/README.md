Diagrams and export instructions

Files in this folder:
- `*.mmd` : Mermaid source files (context, dfd_level1, dfd_level2_search, sequence_search, class, activity, usecase)
- `*.puml`: PlantUML source files (alternatives / compatible with plantuml)

Quick export commands

1) Mermaid CLI (install `@mermaid-js/mermaid-cli` via npm)

```bash
npm install -g @mermaid-js/mermaid-cli
mmdc -i context.mmd -o context.png -w 1920 -H 1080
mmdc -i dfd_level1.mmd -o dfd_level1.png -w 1920 -H 1080
mmdc -i dfd_level2_search.mmd -o dfd_level2_search.png -w 1920 -H 1080
mmdc -i sequence_search.mmd -o sequence_search.png -w 1920 -H 1080
```

To export SVG, change output filename to `.svg`.

2) PlantUML (requires Java)

```bash
# Install plantuml (or use docker/online)
# Example using plantuml jar:
# java -jar plantuml.jar context.puml -tpng -o ./
# or
plantuml -tpng context.puml
plantuml -tsvg context.puml
```

Notes
- If `mmdc` renders diagram layout poorly, open the `.mmd` file in VS Code with a Mermaid preview extension and tweak layout.
- Files are intentionally plain text so you can edit labels/legend or add coloring before export.