# JISDOR

Independent USD/IDR JISDOR dashboard using Bank Indonesia's published reference rates.

## Features
- Latest published daily USD/IDR rate and interactive historical chart.
- Monthly average over an inclusive, selectable start/end month range (previous month by default).
- Individual monthly means, observations, range minimum/maximum, and daily published records.
- Clear warning for selections including an unfinished current month.
- XLSX download: summary, individual daily rates and monthly averages, numeric rates, true Excel dates, basic Excel formatting and formula-backed overall average.
- Responsive desktop and mobile interface. No accounts, paid services, or build tools.

## Data and accuracy
JISDOR is Bank Indonesia's USD/IDR reference rate, not the *Kurs Transaksi BI* buy/sell quotation. The selected-period average is the **arithmetic mean of the daily JISDOR values actually published** on dates falling within the inclusive month range. Weekends, BI holidays and unpublished dates are not treated as zero and are not filled forward. An unfinished month is explicitly identified; its average will change as observations arrive.

The committed historical seed was read from the JISDOR series in [risan/reksadana-id](https://github.com/risan/reksadana-id/blob/main/data/macro/usd-idr.csv), itself sourced from BI, with the last observed BI page rate applied when available. The refresh workflow retrieves 90 days from BI's official [getSubKursJisdor3 service](https://www.bi.go.id/biwebservice/wskursbi.asmx?op=getSubKursJisdor3) and merges by date so revisions replace old data; if BI is temporarily unavailable it attempts the third-party historical mirror as a fallback. The site displays the newest **observation date**, not an assumption that today's rate exists.

Data is updated on weekdays by GitHub Actions shortly after BI's current scheduled publication time of 15:15 WIB. GitHub scheduling may be delayed. Use the date/status indicator to judge freshness. This is an independent viewer and not an official Bank Indonesia service.

## Deploy
1. Open **Settings → Pages** in the repository.
2. Under **Build and deployment**, select **GitHub Actions** as Source. This one-time step is required for new Pages sites; a default workflow token cannot enable Pages.
3. Open **Actions → JISDOR • update & publish → Run workflow** to publish immediately. Subsequent data refreshes and deployments are automatic.

Site URL: https://budhi-halim.github.io/jisdor/

## Files
- `docs/index.html`, `docs/styles.css`, `docs/app.js`: self-contained website.
- `docs/xlsx.js`: dependency-free XLSX writer.
- `docs/data/jisdor.json`: typed daily historical data (ISO date and number).
- `scripts/update.mjs`: BI source sync and fallback.
- `scripts/test.mjs`: basic checks for dataset integrity and calculations.
- `.github/workflows/site.yml`: schedule, refresh, tests, Pages deployment.

## Local view
Open `docs/index.html` with a local HTTP server; fetch-based data won't load reliably from the `file://` scheme. For example, in the repository root with Node installed: `npx --yes http-server docs`. No install is needed for GitHub Pages.

## License and source
Source rates © Bank Indonesia / credited dataset compilers. The website is not affiliated with BI. Source link: https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/default.aspx.
