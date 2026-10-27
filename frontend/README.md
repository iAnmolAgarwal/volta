# VOLTA frontend

The web app for the HackSphere 3.0 smart energy microgrid. It uses Vite, React 19, TypeScript, Three.js, Tailwind 4 and shadcn/ui (Recharts).

```bash
npm install
npm run dev      # http://127.0.0.1:5173/ (proxies /api to the AppSail API)
npm run build    # dist/, deployable to Catalyst Slate (framework react-vite)
```

- **Design tokens:** `src/styles/tokens.css`. Every screen uses them.
- **shadcn variables:** `src/index.css` maps them to the tokens.
- **Screen specs, rubrics and review notes:** `../design-notes/`.

## Credits

- Visual design based on **[Sylva](https://github.com/MengTo/sylva)** by MengTo. Our code is our own: the palette, type scale, layout and motion follow Sylva, and the power-grid scene replaces its moss landscape.
- [Lexend](https://www.lexend.com/), SIL Open Font License 1.1, via `@fontsource-variable/lexend`.
- [Three.js](https://threejs.org/), MIT.
- [shadcn/ui](https://ui.shadcn.com/), MIT. The chart structure follows its "Area Chart - Interactive" example.
