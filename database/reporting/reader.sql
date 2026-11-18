-- Run as an administrator with the QueueWise database selected.
-- Save the generated password privately when creating the dedicated account.
CREATE USER IF NOT EXISTS 'queuewise_bi'@'%' IDENTIFIED BY RANDOM PASSWORD;

GRANT SELECT ON vw_services TO 'queuewise_bi'@'%';
GRANT SELECT ON vw_counters TO 'queuewise_bi'@'%';
GRANT SELECT ON vw_token_lifecycle TO 'queuewise_bi'@'%';
GRANT SELECT ON vw_service_wait_times TO 'queuewise_bi'@'%';
GRANT SELECT ON vw_counter_performance TO 'queuewise_bi'@'%';
GRANT SELECT ON vw_hourly_queue_demand TO 'queuewise_bi'@'%';
GRANT SELECT ON vw_daily_service_summary TO 'queuewise_bi'@'%';
