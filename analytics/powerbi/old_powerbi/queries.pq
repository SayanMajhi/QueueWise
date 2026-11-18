let
    View = (name as text) as table => MySQL.Database(QueueWiseServer, QueueWiseDatabase, [Query = "SELECT * FROM " & name]),
    Services = Table.TransformColumnTypes(View("vw_services"), {
        {"service_id", Int64.Type}, {"service_code", type text}, {"service_name", type text}
    }),
    Counters = Table.TransformColumnTypes(View("vw_counters"), {
        {"counter_id", Int64.Type}, {"service_id", Int64.Type},
        {"counter_code", type text}, {"counter_name", type text}
    }),
    TokenColumns = Table.SelectColumns(View("vw_token_lifecycle"), {
        "token_id", "service_id", "counter_id", "queue_date", "completion_date", "arrival_hour",
        "status", "wait_seconds", "handling_seconds", "estimate_seconds", "estimate_basis"
    }),
    TokenTypes = Table.TransformColumnTypes(TokenColumns, {
        {"token_id", type text}, {"service_id", Int64.Type}, {"counter_id", Int64.Type},
        {"queue_date", type date}, {"completion_date", type date}, {"arrival_hour", Int64.Type},
        {"status", type text}, {"wait_seconds", type number}, {"handling_seconds", type number},
        {"estimate_seconds", Int64.Type}, {"estimate_basis", type text}
    }),
    TokenBandOrder = Table.AddColumn(TokenTypes, "handling_band_order", each
        if [handling_seconds] = null then null
        else if [handling_seconds] < 120 then 1
        else if [handling_seconds] < 240 then 2
        else if [handling_seconds] < 360 then 3
        else 4, Int64.Type),
    BandLabels = {"Under 2 min", "2–<4 min", "4–<6 min", "6 min or more"},
    Tokens = Table.AddColumn(TokenBandOrder, "handling_band", each
        if [handling_band_order] = null then null else BandLabels{[handling_band_order] - 1}, type text),
    CounterDays = Table.TransformColumnTypes(View("vw_counter_performance"), {
        {"counter_id", Int64.Type}, {"service_id", Int64.Type}, {"work_date", type date},
        {"staffed_seconds", type number}, {"busy_seconds", type number},
        {"completed_tokens", Int64.Type}, {"handling_seconds", type number}
    })
in
    [Services = Services, Counters = Counters, Tokens = Tokens, CounterDays = CounterDays]
