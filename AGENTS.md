# Project instructions for agents

## UI fixes

- When a screenshot shows a layout problem, identify the responsible component and inspect the styles that actually apply, including Material UI defaults, nested selectors, theme overrides, and style injection order.
- For styling shared by multiple Material UI menus, use a shared theme override or shared component rule. Check every affected menu, including View and Account.
- Verify visual changes in the relevant theme and interaction state when UI inspection is authorized. Lint and build checks do not prove that spacing or layout changed. If UI inspection is not authorized, say explicitly that the visual result is unverified.
- Treat a follow-up screenshot showing the same defect as evidence that the previous fix failed. Recheck the rendered or computed style before adding another override.

## Code and workflow

- Keep Go function signatures on one line. Keep function bodies readable rather than compressing them.
- Add tests only for a concrete behavior or regression risk; remove redundant test cases.
- Do not start or stop the backend process or use browser UI automation unless the user asks. The user runs and visually verifies the app.
