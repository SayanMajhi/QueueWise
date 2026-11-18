# QueueWise Power BI Desktop

Open [QueueWise.pbip](QueueWise.pbip) in Power BI Desktop on Windows. Keep the adjacent report and semantic model folders together. The project includes four report pages, Import queries, relationships, and DAX measures. Opening, refreshing, and rendering the MySQL-backed project in Desktop remain unverified. Start with the [step-by-step setup](../../docs/powerbi-step-by-step.md).

## Open and refresh the project

1. Start MySQL 8.4, apply the migrations, and use QueueWise to record queue activity. Set up the read-only reporting login in steps 1–2 below.
2. Install Oracle MySQL Connector/NET on the Windows machine running Power BI Desktop. Then open `QueueWise.pbip`. The stored connection points to `127.0.0.1:3307` and database `queuewise`. If your setup differs, change `QueueWiseServer` and `QueueWiseDatabase` in **Transform data → Manage Parameters**. [Microsoft MySQL connector prerequisites](https://learn.microsoft.com/power-query/connectors/mysqldatabase)
3. Select **Home → Refresh**. Authenticate as `queuewise_bi` and approve the four read-only view queries if prompted. Compare the report values with the SQL checks in this guide, then save locally to keep the refreshed report.

## Connect in Import mode or rebuild manually

1. Start MySQL 8.4 and run the QueueWise migrations. Add services and record queue activity through the website.
2. Run [the reporting reader setup](../../database/reporting/reader.sql) as the database owner. This creates a dedicated `queuewise_bi` account and grants it read access to the seven reporting views in the selected database. With Compose, open the MySQL client using the configured root password when prompted.

   ```sh
   docker compose exec db sh -c 'mysql --user=root --password --database="$MYSQL_DATABASE"'
   ```

   At the MySQL prompt, run `source /queuewise/database/reporting/reader.sql`. Save the generated password privately on first setup. To rotate the password, run `ALTER USER 'queuewise_bi'@'%' IDENTIFIED BY RANDOM PASSWORD;` and update the Power BI credentials. Enter the reporting account in Power BI's database authentication prompt. The views contain no student accounts, credentials, or staff logins. [MySQL-generated passwords](https://dev.mysql.com/doc/refman/8.4/en/password-management.html)
3. Install Oracle MySQL Connector/NET on Windows. In Power BI Desktop, choose **Home → Transform data**. In Power Query, create two required Text parameters using **Manage Parameters**. Name them `QueueWiseServer` and `QueueWiseDatabase`. The default local Compose values are `127.0.0.1:3307` and `queuewise`. If connecting to another host, use its actual hostname, port, database, and TLS configuration. [MySQL connector](https://learn.microsoft.com/power-query/connectors/mysqldatabase) · [Manage Parameters](https://learn.microsoft.com/power-query/power-query-query-parameters)
4. Choose **New Source → Blank Query** and name the query `QueueWiseSources`. Paste [queries.pq](queries.pq) into its **Advanced Editor**. If **Enable load** is available for this helper, leave it disabled. Create four more blank queries, keep their load enabled, and paste the corresponding expression into each query's **Advanced Editor**.

   | Query name | Advanced Editor expression | MySQL view |
   |---|---|---|
   | `Services` | `QueueWiseSources[Services]` | `vw_services` |
   | `Counters` | `QueueWiseSources[Counters]` | `vw_counters` |
   | `Tokens` | `QueueWiseSources[Tokens]` | `vw_token_lifecycle` |
   | `CounterDays` | `QueueWiseSources[CounterDays]` | `vw_counter_performance` |

5. Apply the queries with **Close & Apply**. Approve the native-query prompts for the four named reporting views if Desktop shows them. Each fact query has one row per grain below. Query types assign whole numbers to keys and counts, dates to campus calendar keys, and decimal numbers to durations. The token query also creates the service-duration bands from `handling_seconds` and preserves missing durations as blanks.

## Build the semantic model

In **Modeling → New table**, paste the `Calendar` definition in [model.dax](model.dax). Its range covers full calendar years containing the earliest and latest source dates, including counter-only dates. Set `Calendar[Date]` and `Calendar[Week Start]` to the Date data type and mark `Calendar` as the date table with `Calendar[Date]` as the unique column. Disable **Auto date/time** for the current file and use the plain date field in each visual. [Power BI date tables](https://learn.microsoft.com/power-bi/transform-model/desktop-date-tables)

| Table | Grain | Date used in report |
|---|---|---|
| `Services` | One row per service | — |
| `Counters` | One row per counter, with its service key | — |
| `Calendar` | One row per calendar day | Local Asia/Kolkata date |
| `Tokens` | One row per issued token, regardless of current status | `queue_date`, local issuance date |
| `CounterDays` | One row per counter and date with staffed time or completions | `work_date`, local working date |

In Model view, replace any auto-detected relationships with these relationships. Use active one-to-many cardinality and **Single** filter direction in every case, from the left column to the right. A service filter reaches the counter fact through the counter dimension. [Create and manage relationships](https://learn.microsoft.com/power-bi/transform-model/desktop-create-and-manage-relationships)

| One side | Many side |
|---|---|
| `Calendar[Date]` | `Tokens[queue_date]` |
| `Calendar[Date]` | `CounterDays[work_date]` |
| `Services[service_id]` | `Tokens[service_id]` |
| `Services[service_id]` | `Counters[service_id]` |
| `Counters[counter_id]` | `CounterDays[counter_id]` |

Create the two calculated label columns from [model.dax](model.dax) after creating the relationships. `Service Label` and `Counter Label` disambiguate duplicate display names. Sort `Calendar[Weekday]` by `Calendar[Weekday Number]` and `Tokens[handling_band]` by `Tokens[handling_band_order]` using **Column tools → Sort by column**. Set `Tokens[arrival_hour]` to **Don't summarize**. Use the separate **New measure** command for each definition in [measures.dax](measures.dax). Format completion and utilization as percentages, counts as whole numbers, and times as decimal minutes or hours with two decimal places. Hide IDs, source seconds, and sort-key columns from report view after creating the measures.

### Metric definitions

- **Tokens issued and completed.** Operations Overview, Service Performance, and Demand Trends use the campus-local issuance cohort. A token issued late Monday and completed early Tuesday belongs to Monday on these pages. Completion rate divides completed tokens by issued tokens in the selected cohort.
- **Wait.** Time from issuance to first call. Called, in-service, completed, skipped, and no-show tokens contribute when their call time exists. Never-called tokens have blank wait. P90 is calculated on individual wait samples, so a service-wide P90 uses its full cohort of observations.
- **Service duration.** Time from service start to completion. Ongoing or unfinished service contributes a blank duration. The duration bands are `[0, 2)`, `[2, 4)`, `[4, 6)`, and `[6, ∞)` minutes.
- **Counter workload.** Throughput and average handling use completions on each local working date. Utilization divides busy seconds by staffed seconds across the selection. The SQL source splits staffing at local midnight and includes only time spent in service overlapping staffed time. Open intervals are clipped to query time. Draining time remains staffed while current work finishes. Called-but-waiting time contributes no busy seconds.
- **Empty data.** Counts display zero. Wait and duration measures are blank when they have no observations. Completion rate is blank without issued tokens and utilization is blank without staffed time. A measured zero-second wait remains a valid sample.

The SQL summary views support checks by service, date, and arrival hour. The report uses the token-level fact for flexible cohorts and percentiles and the counter-day fact for ratios across dates.

## Build the report pages

On each page add a **Between** slicer bound to `Calendar[Date]` and a service slicer bound to `Services[Service Label]`. Sync those two slicers across pages if you want a single date and service selection. Name the date slicer **Issued date** on the token pages and **Working date** on Counter Efficiency. Keep the counter slicer local to Counter Efficiency. On the four pages, place filters at the top, then cards, then comparison visuals. Set clear axis units and enable table totals for verification.

### 1. Operations Overview

| Visual | Fields |
|---|---|
| Cards | `[Tokens Issued]`, `[Tokens Completed]`, `[Average Wait Minutes]`, `[Average Service Minutes]`, `[Completion Rate]` |
| Line chart · Daily queue volume | X `Calendar[Date]`, Y `[Tokens Issued]` |
| Service comparison table | `Services[Service Label]`, `[Tokens Issued]`, `[Tokens Completed]`, `[Completion Rate]`, `[Average Wait Minutes]` |

### 2. Service Performance

| Visual | Fields |
|---|---|
| Cards | `[Average Wait Minutes]`, `[P90 Wait Minutes]`, `[Average Service Minutes]` |
| Clustered bar · Typical and long waits | Axis `Services[Service Label]`, values `[Average Wait Minutes]` and `[P90 Wait Minutes]`, tooltip `[Wait Samples]` |
| Clustered column · Service duration distribution | X `Tokens[handling_band]`, Y `[Handling Samples]`, legend `Services[Service Label]`. Exclude the blank band in this visual. |
| Column · Peak arrival hours | X `Tokens[arrival_hour]`, Y `[Tokens Issued]`, tooltip `[Average Wait Minutes]`. Use a categorical axis and sort by hour. |

### 3. Counter Efficiency

| Visual | Fields |
|---|---|
| Counter slicer | `Counters[Counter Label]` |
| Cards | `[Counter Completed Tokens]`, `[Counter Utilization]`, `[Counter Average Handling Minutes]` |
| Bar · Completed tokens by counter | Axis `Counters[Counter Label]`, value `[Counter Completed Tokens]` |
| Clustered bar · Staffed hours and time in service | Axis `Counters[Counter Label]`, values `[Staffed Hours]` and `[Busy Hours]` |
| Counter performance table | `Counters[Counter Label]`, `[Counter Completed Tokens]`, `[Counter Utilization]`, `[Counter Average Handling Minutes]` |

### 4. Demand Trends

| Visual | Fields |
|---|---|
| Line · Daily demand | X `Calendar[Date]`, Y `[Tokens Issued]` |
| Line · Weekly demand | X `Calendar[Week Start]`, Y `[Tokens Issued]`. Weeks start on Monday. |
| Column · Hourly arrivals | X `Tokens[arrival_hour]`, Y `[Tokens Issued]`. Use a categorical axis and sort by hour. |
| Column · Demand by weekday | X `Calendar[Weekday]`, Y `[Tokens Issued]`. Use Monday-first sort. |
| Line · Historical wait trend | X `Calendar[Date]`, Y `[Average Wait Minutes]` and `[P90 Wait Minutes]`, tooltip `[Wait Samples]` |

### Optional campus service map

Add this page when verified campus coordinates are available. If each service maps to one site, join a verified site list to `Services` by its service code. Use decimal latitude and longitude fields in Azure Maps, `Services[Service Label]` as the legend or tooltip, and `[Tokens Issued]` as the size with `[Average Wait Minutes]` in the tooltip. If services operate at multiple sites, first capture the actual site for each token or use a map of locations without token-level metrics. [Azure Maps field setup](https://learn.microsoft.com/azure/azure-maps/power-bi-visual-get-started)

## Check the model against SQL

Refresh the report and clear its date and service filters. The **Tokens Issued** and **Tokens Completed** cards should match this query against the same database:

```sh
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u "$MYSQL_USER" "$MYSQL_DATABASE" -e "SELECT COUNT(*) AS tokens_issued, COUNT(completed_at) AS tokens_completed FROM vw_token_lifecycle;"'
```

For a date selection, filter the SQL view by `queue_date` using the same inclusive campus dates. Compare counts first, then wait minutes and service minutes after a refresh. [eta_accuracy.sql](../validation/eta_accuracy.sql) checks the error between saved issuance estimates and actual first-call delays.

## Refresh and distribution

Power BI Desktop Import loads a snapshot. Use **Home → Refresh** after queue activity or after changing data-source parameters. Compare SQL parity from the same quiet data interval, since open counters and active service can grow between refresh and comparison. The MySQL connector supports Import. DirectQuery, on connectors that support it, sends queries to the source when visuals are used. [MySQL connector capabilities](https://learn.microsoft.com/power-query/connectors/mysqldatabase) · [Import and DirectQuery behavior](https://learn.microsoft.com/power-bi/connect-data/desktop-use-directquery)

Save the local Desktop report for evaluation. Sharing through the Power BI service depends on workspace, license, and capacity. A service refresh needs an accessible MySQL connection. A private or local database may need an on-premises gateway with Oracle MySQL Connector/NET installed. When an authorized published report exists, set `VITE_POWER_BI_URL` in QueueWise to link to it from Operations. Users still need permission to open the report. [Sharing requirements](https://learn.microsoft.com/power-bi/collaborate-share/service-share-dashboards) · [Gateway connection requirements](https://learn.microsoft.com/power-bi/connect-data/service-gateway-data-sources)
