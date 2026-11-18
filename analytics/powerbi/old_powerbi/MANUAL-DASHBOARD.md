# Build the QueueWise dashboard in your loaded Power BI file

The project includes the editable [QueueWise.pbip](QueueWise.pbip) report with four pages. If that project does not open correctly, these instructions build an overview in the blank Power BI Desktop file where you already loaded the four MySQL views. Save that file before starting.

## 1. Check the loaded tables

The Data pane should contain `vw_services`, `vw_counters`, `vw_token_lifecycle`, and `vw_counter_performance`. These exact names are used in the formulas below. If Power BI added a suffix, rename the table in the Data pane or use its actual name in each formula.

The website writes queue activity to MySQL. Power BI imports a snapshot, so choose **Home > Refresh** after website activity to see the updated data. QueueWise's database can be empty until services and tokens are created.

## 2. Create relationships

Open **Model view**. In **Manage relationships**, review relationships detected by Power BI. Create these relationships if missing. Use **One to many (1:*)**, single direction from left to right, and mark each active.

| One side | Many side |
| --- | --- |
| `vw_services[service_id]` | `vw_token_lifecycle[service_id]` |
| `vw_services[service_id]` | `vw_counters[service_id]` |
| `vw_counters[counter_id]` | `vw_counter_performance[counter_id]` |

If Power BI already created a conflicting relationship, edit or remove that relationship in the current report so the filter paths match the table. The ID columns must have matching data types on both sides. This model makes a service filter reach tokens and counters. Date filters on the token table apply to token visuals; they do not filter counter-day data without a shared calendar.

## 3. Create measures

In Report view, right-click `vw_token_lifecycle` in the Data pane and select **New measure**. Copy the first formula from [manual-dashboard-measures.dax](manual-dashboard-measures.dax), excluding its comment, into the formula bar and press Enter. Repeat for each measure. Paste **one measure at a time**. The counter measures can also be created in `vw_counter_performance`.

If you already created `Tokens Issued` or `Tokens Completed`, keep those existing measures instead of creating duplicates. In Measure tools, format `Completion Rate` and `Counter Utilization` as percentages. Format wait and service measures as decimal numbers with two decimal places.

## 4. Create the overview page

Rename the first report page **Operations Overview**. Select a blank area before adding each visual.

| Visual | Add these fields |
| --- | --- |
| Card | `[Tokens Issued]` |
| Card | `[Tokens Completed]` |
| Card | `[Completion Rate]` |
| Card | `[Average Wait Minutes]` |
| Card | `[Average Service Minutes]` |
| Slicer | `vw_services[service_name]` |
| Slicer | `vw_token_lifecycle[queue_date]` |
| Line chart | X-axis `vw_token_lifecycle[queue_date]`; Y-axis `[Tokens Issued]` |
| Bar chart | Y-axis `vw_services[service_name]`; X-axis `[Tokens Issued]` |

Use the plain date field in the chart rather than Power BI's date hierarchy. Put the two slicers above the cards and the charts below them. In the Format pane, add clear titles such as **Daily queue volume** and **Tokens by service**.

## 5. Create the counter page

Add a page named **Counter Efficiency**. Add a service slicer using `vw_services[service_name]`, a working-date slicer using `vw_counter_performance[work_date]`, and a bar chart with `vw_counters[counter_name]` on the category axis and `[Counter Completed Tokens]` as the value. Add cards for `[Counter Completed Tokens]` and `[Counter Utilization]`.

The counter page's working-date slicer filters counter-day data. Token pages use the token issuance date. These can differ for a visit crossing midnight.

## 6. Save and refresh

Select **File > Save as**, choose the project folder, and save the report as `QueueWise-Manual.pbix`. Select **Home > Refresh** after new queue activity and adjust the date slicer to include that activity. Counts display zero for an empty selection. Wait and utilization measures can be blank when there are no measurements.

To add an online report link to QueueWise, publish from Power BI Desktop to an authorized workspace, set `VITE_POWER_BI_URL` in the project's `.env` file to the published report URL, and run `docker compose up -d --build --wait`. The website opens the report through a link. Refreshing the online report from local MySQL requires a reachable source and typically a standard on-premises data gateway with Connector/NET installed.

The included `.pbip` and this manual setup have not been rendered and refreshed in Power BI Desktop in this environment. If something differs on your screen, capture the exact error or field names before changing the model.
