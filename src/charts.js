// Plotly chart helpers — imports els for purge/placeholder operations.
/* global Plotly */
import { els } from './dom.js';

export function CALM_LAYOUT(title) {
  return {
    title: { text: title, font: { color: 'rgba(231,246,246,.95)', size: 14 } },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: 'rgba(231,246,246,.9)' },
    margin: { l: 55, r: 22, t: 45, b: 55 },
    xaxis: {
      gridcolor: 'rgba(255,255,255,.08)',
      zerolinecolor: 'rgba(255,255,255,.08)',
      tickcolor: 'rgba(255,255,255,.25)',
      rangeslider: { visible: true, bgcolor: 'rgba(255,255,255,.04)', bordercolor: 'rgba(255,255,255,.10)' },
    },
    yaxis: {
      gridcolor: 'rgba(255,255,255,.08)',
      zerolinecolor: 'rgba(255,255,255,.08)',
      tickcolor: 'rgba(255,255,255,.25)',
    },
    legend: { bgcolor: 'rgba(0,0,0,0)' }
  };
}

export const plotConfig = {
  responsive: true,
  displayModeBar: true,
  modeBarButtonsToRemove: ['autoScale2d']
};

const ALL_PLOTS = () => [
  els.plotOverview, els.plotLeak, els.plotPressure, els.plotFlow,
  els.plotSnore, els.plotRespRate, els.plotTidalVolume, els.plotEvents, els.plotExplore
];

export function purgePlots() {
  ALL_PLOTS().forEach(p => Plotly.purge(p));
}

export function placeholderPlots() {
  const data = [{
    x: [0, 1, 2, 3], y: [0, 1, 0.4, 0.8], type: 'scatter', mode: 'lines', hoverinfo: 'skip',
    line: { color: 'rgba(97,212,195,.55)', width: 3 }
  }];
  const hidden = { xaxis: { visible: false }, yaxis: { visible: false } };
  Plotly.newPlot(els.plotOverview,    data, { ...CALM_LAYOUT('Upload a ZIP to see your report'), ...hidden }, plotConfig);
  Plotly.newPlot(els.plotLeak,        data, { ...CALM_LAYOUT('Leaks'),             ...hidden }, plotConfig);
  Plotly.newPlot(els.plotPressure,    data, { ...CALM_LAYOUT('Pressure'),          ...hidden }, plotConfig);
  Plotly.newPlot(els.plotFlow,        data, { ...CALM_LAYOUT('Flow'),              ...hidden }, plotConfig);
  Plotly.newPlot(els.plotSnore,       data, { ...CALM_LAYOUT('Snore'),             ...hidden }, plotConfig);
  Plotly.newPlot(els.plotRespRate,    data, { ...CALM_LAYOUT('Respiratory Rate'),  ...hidden }, plotConfig);
  Plotly.newPlot(els.plotTidalVolume, data, { ...CALM_LAYOUT('Tidal Volume'),      ...hidden }, plotConfig);
  Plotly.newPlot(els.plotEvents,      data, { ...CALM_LAYOUT('Events'),            ...hidden }, plotConfig);
  Plotly.newPlot(els.plotExplore,     data, { ...CALM_LAYOUT('Explore'),           ...hidden }, plotConfig);
}

export function resizePlots() {
  ALL_PLOTS().forEach(p => { if (p) Plotly.Plots.resize(p); });
}
