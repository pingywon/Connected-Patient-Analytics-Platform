# CalmCPAP

CalmCPAP is a lightweight browser tool for exploring CPAP SD-card ZIP exports without turning the whole experience into a wrestling match with folders, EDF files, and mystery numbers. Open the app, drop in a ZIP, and let the graphs do their thing. If you just want to kick the tires, there is a built-in demo night ready to go..

<p align="center">
  <img src="assets/calmcpap-overview.png" alt="CalmCPAP overview tab with synthetic demo data" width="48%" />
  <img src="assets/calmcpap-pressure.png" alt="CalmCPAP pressure tab with synthetic demo data" width="48%" />
</p>
<p align="center">
  <img src="assets/calmcpap-compare.png" alt="CalmCPAP compare tab with synthetic demo data" width="48%" />
  <img src="assets/calmcpap-events.png" alt="CalmCPAP events tab with synthetic demo data" width="48%" />
</p>

The screenshots above use the built-in synthetic demo data, so the README stays friendly and nobody's real sleep gets volunteered for documentation duty.

## What It Does

- Loads CPAP ZIP exports directly in the browser.
- Shows machine identification, calendar-based session picking, and quick nightly stats.
- Charts leak, pressure, flow, snore, respiratory rate, tidal volume, EPR, annotations, and comparison overlays.
- Includes raw and explore views for nights when you want to do a little data archaeology.
- Ships as a single-file app in `index.html`.

## Quick Start

1. Open `index.html` in a browser.
2. Drop in a CPAP ZIP export, or click `Load demo` for the built-in sample night.
3. Hop through the tabs and pretend the fake patient had a very eventful evening.

## Notes

- This project runs locally in the browser. No backend, no account, no surprise cloud detour.
- The demo data is intentionally a little dramatic so the charts are interesting to look at.
- This is not medical advice, and it is definitely not a substitute for a clinician.

## Screenshot Refresh

If the UI changes and the README gallery needs a refresh:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\capture-marketing-screenshots.ps1
```
