-- Compare the ETA saved at issuance with elapsed seconds to the first call.
-- Demo seeds contain synthetic estimates for validating this report's calculations.
WITH issued_tokens AS (
    SELECT service.code AS service_code,
           service.name AS service_name,
           token.id AS token_id,
           token.estimate_basis,
           token.estimate_seconds,
           TIMESTAMPDIFF(MICROSECOND, token.issued_at, token.called_at) * 0.000001 AS actual_wait_seconds
    FROM services AS service
    LEFT JOIN tokens AS token ON token.service_id = service.id
), rolled_up AS (
    SELECT service_code,
           MAX(service_name) AS service_name,
           GROUPING(service_code) AS campus_total,
           COALESCE(estimate_basis, 'TOTAL') AS basis_label,
           count(token_id) AS issued_tokens,
           count(estimate_seconds) AS estimated_tokens,
           count(actual_wait_seconds) AS called_tokens,
           COUNT(CASE WHEN estimate_seconds IS NOT NULL AND actual_wait_seconds IS NOT NULL THEN 1 END) AS comparable_tokens,
           avg(abs(estimate_seconds - actual_wait_seconds)) AS mean_absolute_error_seconds,
           avg(estimate_seconds - actual_wait_seconds) AS signed_bias_seconds
    FROM issued_tokens
    GROUP BY service_code, estimate_basis WITH ROLLUP
    HAVING GROUPING(estimate_basis) = 1 OR count(token_id) > 0
), evaluation AS (
    SELECT * FROM rolled_up
    UNION ALL
    SELECT NULL, NULL, 1, 'TOTAL', 0, 0, 0, 0, NULL, NULL
    WHERE NOT EXISTS (SELECT 1 FROM rolled_up)
)
SELECT service_code,
       CASE WHEN campus_total = 1 THEN 'All services' ELSE service_name END AS service_name,
       basis_label AS estimate_basis,
       issued_tokens,
       estimated_tokens,
       called_tokens,
       comparable_tokens,
       round(100.0 * estimated_tokens / nullif(issued_tokens, 0), 2) AS estimate_coverage_percent,
       round(100.0 * comparable_tokens / nullif(issued_tokens, 0), 2) AS comparable_coverage_percent,
       round(mean_absolute_error_seconds, 2) AS mean_absolute_error_seconds,
       round(signed_bias_seconds, 2) AS signed_bias_seconds
FROM evaluation
ORDER BY campus_total, service_code, (basis_label = 'TOTAL'), basis_label;
