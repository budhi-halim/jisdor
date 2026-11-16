# JISDOR

USD/IDR reference-rate dashboard: https://budhi-halim.github.io/jisdor/

## Features

- Latest published JISDOR observation and day-over-day change, with the actual publication date.
- Responsive daily-rate chart, pointer/touch tooltip and keyboard navigation.
- Inclusive start/end month selection. Both fields default to the previous calendar month in Asia/Jakarta.
- Previous month, last three completed months, year-to-date and current-month presets.
- Selected-period daily arithmetic mean, separate monthly means and a sortable, paginated daily table.
- Persistent warning whenever the selection includes the unfinished current month, plus warnings for absent months and outdated/fallback data.
- XLSX download with Summary, Daily Rates and Monthly Averages sheets. Rates are numeric cells; dates are Excel dates; the summary average is an Excel formula.

## Calculation

The selected-period average is the arithmetic mean of every published daily JISDOR observation in the inclusive month range. It is **not** an unweighted average of monthly averages. Weekends, holidays and dates without observations are excluded rather than treated as zero or filled forward. The displayed mean is rounded to two decimals; calculations and exports retain the underlying precision.

This dashboard average is distinct from BI's own transaction-volume-weighted calculation of each day's JISDOR. This is also not the separate buy/sell *Kurs Transaksi BI* series.

## Data

Primary source: https://www.bi.go.id/biwebservice/wskursbi.asmx/getSubKursJisdor3

Official publication: https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/Default.aspx

The retained historical seed begins on 20 May 2013 and was obtained from the BI-derived series at https://github.com/risan/reksadana-id/blob/main/data/macro/usd-idr.csv. The updater re-reads at least 95 days from BI, replaces revised official values, and catches up from the last observation after longer interruptions. If BI is unavailable, the mirror can add missing dates but cannot overwrite existing official values. Failed refreshes retain the last snapshot and are visibly labelled. Publication-date visibility is intentional: a successful page deployment is not a guarantee that BI has published a new rate.

## Deployment and verification

`.github/workflows/site.yml` refreshes, validates and deploys `docs/` on every push, on manual runs and on a schedule. Scheduled refreshes are 15:45 and 18:30 WIB on weekdays, plus Saturday at 10:00 WIB. GitHub may delay scheduled runs. No API key or paid hosting service is needed.

`.github/workflows/verify.yml` runs after successful deployment and checks the real browser UI at desktop, tablet, narrow-mobile and landscape sizes, default month selection, monthly/multi-month means, incomplete-month warnings, invalid input, sorting, pagination, a real XLSX download, numeric/date cells and the public Pages URL. Screenshots and machine-readable results are retained as the `jisdor-qa` Actions artifact for seven days.

Pages publishes `docs/`. For a new fork, enable Pages in repository Settings and select GitHub Actions as the publishing source.

## Local development

Serve `docs/` with an HTTP server, rather than opening the HTML using `file://`. Core logic and workbook integrity checks run with `node scripts/test.mjs`. Browser checks require Playwright; CI installs its pinned test-only version automatically. The deployed website itself has no JavaScript package dependencies.

## Source and affiliation

Independent data viewer, not affiliated with Bank Indonesia. Published reference rates are attributed to Bank Indonesia. Consult the official publication for corrections and critical decisions.
