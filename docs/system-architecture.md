# QueueWise system architecture

```mermaid
flowchart LR
    subgraph Web["QueueWise website"]
        Browser["React browser app"] -->|"Same-origin JSON API and session cookie"| API["Express API"]
    end
    API -->|"Transactions and queries"| DB[("MySQL operational tables")]
    DB --> Views["Reporting views"]
    subgraph Academic["Standalone academic BI deliverable"]
        BI["Power BI Desktop"]
    end
    Views -->|"Read-only import on refresh"| BI
```

Docker Compose runs MySQL, a migration job, and the application. The application serves the built frontend and API from the same origin. In development, Vite serves the frontend and proxies API requests to Express. The browser never connects directly to MySQL. Power BI reads reporting views through a separate database reader.

## Role workflows

```mermaid
flowchart TD
    Login["Sign in and start session"] --> Admin["Admin configures service and counter"]
    Admin --> Assign["Assign staff"]
    Login --> Staff["Staff sees assigned counter"]
    Assign --> Staff
    Staff --> Open["Open counter"]
    Login --> Student["Student selects service"]
    Student --> Wait["Issue token and display position"]
    Wait --> Cancel["Cancel while waiting"]
    Open --> Call["Call oldest waiting token"]
    Wait --> Call
    Call --> Start["Start service"]
    Call --> Exception["Skip with reason or record no-show"]
    Start --> Complete["Complete service"]
    Complete --> History["Student history and admin totals"]
    Cancel --> History
    Exception --> History
```

## Operational data relationships

```mermaid
erDiagram
    USERS ||--o{ AUTH_SESSIONS : signs_in
    USERS ||--o| STAFF_ASSIGNMENTS : holds
    USERS ||--o| STAFF_ASSIGNMENT_GUARDS : locks
    COUNTERS ||--o{ STAFF_ASSIGNMENTS : receives
    SERVICES ||--o{ COUNTERS : has
    SERVICES ||--o{ QUEUE_SESSIONS : has
    QUEUE_SESSIONS ||--o{ TOKENS : numbers
    USERS ||--o{ TOKENS : requests
    COUNTERS o|--o{ TOKENS : handles
    COUNTERS ||--o{ COUNTER_AVAILABILITY : tracks
    TOKENS ||--o{ TOKEN_EVENTS : records
    USERS ||--o{ TOKEN_EVENTS : performs
```

The [MySQL migrations](../database/migrations) define constraints and derived views. Composite foreign keys keep the counter and queue session on the token's service. Generated unique keys enforce one active token per student and service and one active token per counter.

| Component | Responsibility |
|---|---|
| [Frontend](../frontend/src) | Role navigation, queue polling, forms and action feedback. |
| [Express API](../backend/src) | Resolve sessions, enforce roles and assignments, validate requests, and apply transitions. |
| [Queue transactions](../backend/src/queue.js) | Serialize writes on the service row. Commit a token change and its event together. |
| [Reporting views](../database/migrations/003_reporting.sql) | Produce campus-local date buckets and calculate elapsed wait, handling and staffed time. |
| [Power BI project](../analytics/powerbi/QueueWise-Manual.pbix) | Import and summarize lifecycle and counter data in two report pages. |

Operational timestamps are UTC. The queue date and report day buckets use campus time (UTC+05:30). The reporting import is a snapshot that changes on refresh.
