(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const numberFormat = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signedFormat = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
  const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const state = { rows: [], all: [], data: null, from: '', to: '', preset: 'previous', chart: '6M', page: 0, pageSize: 15, newestFirst: true, valid: false };
  const todayParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const todayField = (name) => todayParts.find((part) => part.type === name).value;
  const today = `${todayField('year')}-${todayField('month')}-${todayField('day')}`;
  const currentMonth = today.slice(0, 7);

  const formatRate = (value) => Number.isFinite(value) ? numberFormat.format(value) : '—';
  const formatDate = (date, options) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));
  const formatMonth = (month) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  const shortMonth = (month) => `${MONTHS_SHORT[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  const monthShift = (month, offset) => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7); };
  const change = (value) => (value > 0 ? '↑ ' : value < 0 ? '↓ ' : '') + formatRate(Math.abs(value));
  const mean = (rows) => rows.length ? rows.reduce((sum, row) => sum + row.rate, 0) / rows.length : NaN;
  const inRange = (row) => row.date.slice(0, 7) >= state.from && row.date.slice(0, 7) <= state.to;
  const monthSeries = (from, to) => { const result = []; for (let m = from; m <= to && result.length < 250; m = monthShift(m, 1)) result.push(m); return result; };
  const previousMonth = monthShift(currentMonth, -1);

  const chosenRows = () => state.rows.filter(inRange);
  function setLoading(isLoading) { $('loadingBanner').classList.toggle('hidden', !isLoading); }
  function showError(message) { $('errorText').textContent = message; $('errorBanner').classList.remove('hidden'); setLoading(false); }
  function hideError() { $('errorBanner').classList.add('hidden'); }
  let toastTimer;
  function toast(message) { const el = $('toast'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 3900); }

  function normalize(input) {
    if (!input || input.schema !== 1 || !Array.isArray(input.rows)) throw new Error('Invalid data format.');
    const byDate = new Map();
    for (const item of input.rows) {
      if (!Array.isArray(item) || item.length !== 2) continue;
      const [date, rate] = item;
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(rate) && rate > 1000 && rate < 100000) {
        byDate.set(date, rate);
      }
    }
    const rows = [...byDate].sort((a, b) => a[0].localeCompare(b[0])).map(([date, rate]) => ({ date, rate }));
    if (rows.length < 100) throw new Error('Historical data is missing or incomplete.');
    return rows.map((row, index) => ({ ...row, delta: index ? row.rate - rows[index - 1].rate : null }));
  }

  async function load() {
    setLoading(true);
    hideError();
    try {
      const response = await fetch(`./data/jisdor.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Data request returned HTTP ${response.status}.`);
      const input = await response.json();
      state.rows = normalize(input);
      state.data = input;
      setLoading(false);
      $('exportButton').disabled = false;
      $('tableExportButton').disabled = false;
      showLatest();
      render();
      const latest = state.rows.at(-1).date;
      $('dataFooter').textContent = `Latest BI observation: ${formatDate(latest)}`;
      const elapsedDays = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / 86400000);
      if (elapsedDays > 5) toast(`The latest stored rate is ${formatDate(latest)}. Verify the official BI publication for newer dates.`);
    } catch (error) {
      showError(`Unable to load JISDOR records: ${error.message}`);
      $('rateTable').innerHTML = '<tr><td colspan="4" class="table-empty">Historical data is unavailable.</td></tr>';
    }
  }

  function showLatest() {
    const last = state.rows.at(-1);
    $('latestValue').textContent = formatRate(last.rate);
    $('latestDate').textContent = formatDate(last.date);
    if (last.delta === null) return;
    $('dayChange').textContent = change(last.delta);
    const pct = last.delta / (last.rate - last.delta) * 100;
    $('dayChangePercentage').textContent = `${pct > 0 ? '+' : ''}${numberFormat.format(pct)}%`;
    $('dayChangePercentage').className = `change-pill ${last.delta > 0 ? 'up' : last.delta < 0 ? 'down' : 'neutral'}`;
  }

  function applyPreset(key) {
    state.preset = key;
    if (key === 'previous') state.from = state.to = previousMonth;
    else if (key === '3months') { state.from = monthShift(currentMonth, -3); state.to = previousMonth; }
    else if (key === 'year') { state.from = `${today.slice(0, 4)}-01`; state.to = currentMonth; }
    else if (key === 'current') state.from = state.to = currentMonth;
    $('fromMonth').value = state.from;
    $('toMonth').value = state.to;
    updatePresets();
    state.page = 0;
    state.chart = 'range';
    render();
  }

  function updatePresets() {
    document.querySelectorAll('.preset').forEach((button) => {
      const active = button.dataset.preset === state.preset;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function isValidRange() {
    const valid = /^\d{4}-\d{2}$/.test(state.from) && /^\d{4}-\d{2}$/.test(state.to) && state.from >= '2013-05' && state.from <= state.to && state.to <= currentMonth;
    state.valid = valid;
    $('rangeError').classList.toggle('hidden', valid);
    if (!valid) $('rangeError').textContent = 'Select a valid period: start month must precede end month, and future months are not available.';
    $('exportButton').disabled = !valid || !state.rows.length;
    $('tableExportButton').disabled = !valid || !state.rows.length;
    return valid;
  }

  function render() {
    if (!state.rows.length) return;
    if (!isValidRange()) {
      $('avgValue').textContent = '—';
      $('avgCount').textContent = '— observations';
      $('rangeLabel').textContent = 'Invalid date range';
      $('rateTable').innerHTML = '<tr><td colspan="4" class="table-empty">Select a valid month range.</td></tr>';
      $('monthList').innerHTML = '<p class="empty-copy">Select a valid month range.</p>';
      $('periodWarning').classList.add('hidden');
      $('missingWarning').classList.add('hidden');
      return;
    }
    const selected = chosenRows();
    const average = mean(selected);
    const months = monthSeries(state.from, state.to);
    $('avgValue').textContent = formatRate(average);
    $('avgPeriodLabel').textContent = state.from === state.to ? shortMonth(state.from) : `${shortMonth(state.from)} – ${shortMonth(state.to)}`;
    $('avgCount').textContent = `${integerFormat.format(selected.length)} observations`;
    $('rangeLabel').textContent = state.from === state.to ? formatMonth(state.from) : `${shortMonth(state.from)} – ${shortMonth(state.to)}`;
    $('rangeSubLabel').textContent = `${months.length} ${months.length === 1 ? 'month' : 'months'} · ${integerFormat.format(selected.length)} published rates`;
    $('breakdownAverage').textContent = formatRate(average);
    $('breakdownObs').textContent = `${integerFormat.format(selected.length)} published rates`;
    $('periodWarning').classList.toggle('hidden', state.to < currentMonth);
    if (state.to >= currentMonth) {
      const lastCurrent = state.rows.filter((row) => row.date.startsWith(currentMonth)).at(-1)?.date;
      $('periodWarningDetail').textContent = `The current month is not complete. ${lastCurrent ? 'Latest recorded rate: ' + formatDate(lastCurrent) + '. ' : 'No rates are recorded for the current month yet. '}The period average will change as further dates are published.`;
    }
    const missing = months.filter((m) => !selected.some((row) => row.date.startsWith(m)));
    $('missingWarning').classList.toggle('hidden', missing.length === 0);
    if (missing.length) $('missingWarningDetail').textContent = `No published observations found for: ${missing.map(shortMonth).join(', ')}. These months are excluded from the arithmetic mean.`;
    renderMonthly(selected, months);
    renderTable(selected);
    renderChart();
  }

  function renderMonthly(selected, months) {
    const groups = months.map((month) => {
      const values = selected.filter((row) => row.date.startsWith(month));
      return { month, values, average: mean(values) };
    }).reverse();
    const withRates = groups.filter((group) => Number.isFinite(group.average));
    const low = Math.min(...withRates.map((group) => group.average));
    const high = Math.max(...withRates.map((group) => group.average));
    $('monthList').innerHTML = groups.map((group) => {
      const width = Number.isFinite(group.average) ? 35 + (high === low ? 42 : ((group.average - low) / (high - low)) * 57) : 0;
      return `<div class="month-row"><div class="month-row-head"><span class="month-name">${shortMonth(group.month)}</span><span class="month-mean">${formatRate(group.average)}</span></div><div class="month-sub"><span>${group.values.length} published days</span><span>${group.month === currentMonth ? 'In progress' : 'Monthly mean'}</span></div><div class="month-track"><span style="width:${width.toFixed(1)}%"></span></div></div>`;
    }).join('') || '<p class="empty-copy">No monthly data available.</p>';
  }

  function renderTable(rows) {
    const ordered = [...rows].sort((a, b) => state.newestFirst ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
    const totalPages = Math.max(1, Math.ceil(ordered.length / state.pageSize));
    state.page = Math.max(0, Math.min(state.page, totalPages - 1));
    const start = state.page * state.pageSize;
    const displayed = ordered.slice(start, start + state.pageSize);
    $('rateTable').innerHTML = displayed.length ? displayed.map((row) => {
      const css = row.delta > 0 ? 'daily-up' : row.delta < 0 ? 'daily-down' : 'daily-flat';
      const delta = row.delta === null ? '—' : `${row.delta > 0 ? '+' : row.delta < 0 ? '−' : ''}${formatRate(Math.abs(row.delta))}`;
      return `<tr><td>${formatDate(row.date)}</td><td><span class="pair-badge">USD / IDR</span></td><td class="align-right"><span class="rate-text">${formatRate(row.rate)}</span></td><td class="align-right ${css}">${delta}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="table-empty">No published rates in the selected period.</td></tr>';
    $('tableCount').textContent = `${integerFormat.format(ordered.length)} records`;
    $('tableDescription').textContent = `${shortMonth(state.from)} – ${shortMonth(state.to)} · Published trading days only`;
    $('paginationLabel').textContent = ordered.length ? `Showing ${start + 1}–${Math.min(start + state.pageSize, ordered.length)} of ${integerFormat.format(ordered.length)}` : '0 records';
    $('prevPage').disabled = state.page === 0;
    $('nextPage').disabled = state.page >= totalPages - 1;
    $('sortIndicator').textContent = state.newestFirst ? '↓' : '↑';
  }

  function chartRows() {
    const all = state.rows;
    if (state.chart === 'range') return all.filter(inRange);
    const end = all.at(-1).date;
    const threshold = new Date(`${end}T12:00:00Z`);
    const days = { '1M': 30, '3M': 91, '6M': 183, '1Y': 365 }[state.chart] || 183;
    threshold.setUTCDate(threshold.getUTCDate() - days);
    const minDate = threshold.toISOString().slice(0, 10);
    return all.filter((row) => row.date >= minDate);
  }

  function svgNode(tag, attrs, textContent) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([name, value]) => el.setAttribute(name, String(value)));
    if (textContent !== undefined) el.textContent = textContent;
    return el;
  }

  function renderChart() {
    document.querySelectorAll('.chart-period').forEach((button) => button.classList.toggle('active', button.dataset.chart === state.chart));
    const svg = $('trendChart');
    svg.replaceChildren();
    const points = chartRows();
    const tooltip = $('chartTooltip');
    tooltip.classList.add('hidden');
    if (!points.length) {
      svg.append(svgNode('text', { x: 400, y: 145, 'text-anchor': 'middle', fill: '#97a4b7', 'font-size': 15 }, 'No published observations for this period.'));
      $('chartDateSpan').textContent = 'No observations';
      return;
    }
    const W = 800, H = 310, left = 12, right = 64, top = 24, bottom = 40;
    const min = Math.min(...points.map((row) => row.rate));
    const max = Math.max(...points.map((row) => row.rate));
    const spread = Math.max(max - min, 40), low = min - spread * .17, high = max + spread * .17;
    const x = (i) => left + (i / Math.max(points.length - 1, 1)) * (W - left - right);
    const y = (rate) => top + (high - rate) / (high - low) * (H - top - bottom);
    const coords = points.map((row, i) => [x(i), y(row.rate)]);
    const line = coords.map(([xx, yy], i) => `${i ? 'L' : 'M'}${xx.toFixed(2)},${yy.toFixed(2)}`).join(' ');
    const defs = svgNode('defs'), gradient = svgNode('linearGradient', { id: 'chartGradient', x1: '0', x2: '0', y1: '0', y2: '1' });
    gradient.append(svgNode('stop', { offset: '0%', 'stop-color': '#457cf1', 'stop-opacity': '.18' }), svgNode('stop', { offset: '100%', 'stop-color': '#457cf1', 'stop-opacity': '.006' }));
    defs.append(gradient); svg.append(defs);
    for (let tick = 0; tick <= 4; tick++) {
      const value = low + (high - low) * tick / 4, yy = y(value);
      svg.append(svgNode('line', { x1: left, x2: W - right, y1: yy, y2: yy, class: 'grid-line' }));
      svg.append(svgNode('text', { x: W - right + 13, y: yy + 4, class: 'axis-label' }, integerFormat.format(value)));
    }
    for (let tick = 0; tick <= 4; tick++) {
      const index = Math.round((points.length - 1) * tick / 4);
      const row = points[index];
      const xLabel = points.length <= 65 ? row.date.slice(8, 10) + ' ' + MONTHS_SHORT[Number(row.date.slice(5, 7)) - 1] : shortMonth(row.date.slice(0, 7));
      svg.append(svgNode('text', { x: x(index), y: H - 13, 'text-anchor': tick === 0 ? 'start' : tick === 4 ? 'end' : 'middle', class: 'axis-label' }, xLabel));
    }
    const area = `${line} L${x(points.length - 1).toFixed(2)},${(H - bottom).toFixed(2)} L${left},${(H - bottom).toFixed(2)} Z`;
    svg.append(svgNode('path', { d: area, class: 'area-path' }), svgNode('path', { d: line, class: 'line-path' }));
    const focusLine = svgNode('line', { class: 'focus-line', y1: top, y2: H - bottom, visibility: 'hidden' });
    const focusDot = svgNode('circle', { class: 'focus-point', r: 5, visibility: 'hidden' });
    svg.append(focusLine, focusDot);
    const overlay = svgNode('rect', { x: left, y: top, width: W - left - right, height: H - top - bottom, fill: 'transparent', 'pointer-events': 'all' });
    svg.append(overlay);
    const nearest = (event) => {
      const bounds = svg.getBoundingClientRect();
      const px = Math.max(left, Math.min(W - right, ((event.clientX - bounds.left) / bounds.width) * W));
      return Math.min(points.length - 1, Math.max(0, Math.round((px - left) / (W - left - right) * (points.length - 1))));
    };
    overlay.addEventListener('pointermove', (event) => {
      const i = nearest(event);
      const row = points[i], [xx, yy] = coords[i];
      for (const [attr, value] of [['x1', xx], ['x2', xx], ['visibility', 'visible']]) focusLine.setAttribute(attr, value);
      focusDot.setAttribute('cx', xx); focusDot.setAttribute('cy', yy); focusDot.setAttribute('visibility', 'visible');
      tooltip.replaceChildren(svgNode('span', {}, formatDate(row.date)), svgNode('b', {}, `Rp ${formatRate(row.rate)}`));
      tooltip.classList.remove('hidden');
      const available = $('chartBody')?.clientWidth || svg.clientWidth;
      const leftPx = Math.max(71, Math.min(available - 72, xx / W * svg.clientWidth));
      tooltip.style.left = `${leftPx}px`;
      tooltip.style.top = `${Math.max(50, yy / H * svg.clientHeight - 9)}px`;
    });
    overlay.addEventListener('pointerleave', () => { focusLine.setAttribute('visibility', 'hidden'); focusDot.setAttribute('visibility', 'hidden'); tooltip.classList.add('hidden'); });
    $('chartDateSpan').textContent = `${formatDate(points[0].date)} — ${formatDate(points.at(-1).date)}`;
  }

  function exportWorkbook() {
    if (!state.valid || !state.rows.length) return;
    const selected = chosenRows();
    if (!selected.length) return toast('The selected period has no published rates to export.');
    if (typeof window.JisdorXlsx?.download !== 'function') return toast('XLSX export could not be initialized.');
    const months = monthSeries(state.from, state.to);
    const monthly = months.map((month) => { const rows = selected.filter((row) => row.date.startsWith(month)); return { month, count: rows.length, average: mean(rows), min: rows.length ? Math.min(...rows.map((r) => r.rate)) : null, max: rows.length ? Math.max(...rows.map((r) => r.rate)) : null }; });
    window.JisdorXlsx.download({
      from: state.from, to: state.to,
      daily: [...selected].reverse(),
      monthly,
      average: mean(selected),
      latest: state.rows.at(-1).date,
      incomplete: state.to >= currentMonth,
    });
    toast(`Exported ${selected.length} daily rates as numeric Excel cells.`);
  }

  function setup() {
    $('todayLabel').textContent = formatDate(today, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    $('fromMonth').max = currentMonth;
    $('toMonth').max = currentMonth;
    document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
    for (const [id, name] of [['fromMonth', 'from'], ['toMonth', 'to']]) {
      $(id).addEventListener('change', (event) => { state[name] = event.target.value; state.preset = 'custom'; updatePresets(); state.page = 0; state.chart = 'range'; render(); });
    }
    document.querySelectorAll('.chart-period').forEach((button) => button.addEventListener('click', () => { state.chart = button.dataset.chart; renderChart(); }));
    $('prevPage').addEventListener('click', () => { state.page--; renderTable(chosenRows()); });
    $('nextPage').addEventListener('click', () => { state.page++; renderTable(chosenRows()); });
    $('sortDateButton').addEventListener('click', () => { state.newestFirst = !state.newestFirst; state.page = 0; renderTable(chosenRows()); });
    $('exportButton').addEventListener('click', exportWorkbook);
    $('tableExportButton').addEventListener('click', exportWorkbook);
    $('retryButton').addEventListener('click', load);
    document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => { document.querySelectorAll('.nav-link').forEach((x) => x.classList.remove('active')); link.classList.add('active'); }));
    state.from = state.to = previousMonth;
    $('fromMonth').value = previousMonth;
    $('toMonth').value = previousMonth;
    updatePresets();
    load();
  }

  document.addEventListener('DOMContentLoaded', setup);
})();
