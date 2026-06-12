## Pause / Resume Trade-offs

### Pause Handling for In-Flight Jobs:

One challenge with the pause feature is that a sequence can be paused while a worker is already processing an email. Checking the sequence status only once at the beginning of the job is not sufficient because the sequence may be paused after the worker has started but before the email is sent.

I considered validating the sequence status only immediately before calling `send()`, but by that point the worker may have already consumed mailbox quota through `checkAndIncrement()`. This would prevent the email from being sent while still reducing the mailbox's available quota.

To balance correctness and simplicity, I chose to validate the sequence status twice: once before claiming quota and again immediately before sending the email. This introduces an extra database query, but it minimizes the race window while also avoiding unnecessary quota consumption for sequences that have been paused during processing.


### Cancelling Delayed Jobs During Pause:

The pause implementation currently scans delayed BullMQ jobs and removes those belonging to the target sequence. I considered paginating the delayed-job set to avoid the hardcoded `5000` limit, but pagination becomes tricky when jobs are removed during iteration because the underlying collection changes size. A naive offset-based approach can skip jobs, while repeatedly reading from the first page can revisit the same jobs.

Given the assignment scope, I kept the implementation simple and accepted the limitation. In a production system I would redesign this flow to avoid scanning the delayed queue, for example by maintaining a direct mapping between sequences and queued jobs or by using a queue-side indexing strategy.

### Resume Scheduling Behavior::

The existing `scheduleSequence()` implementation treats `delay_days` as an offset from the initial scheduling time. While implementing `resumeSequence()`, I noticed that the assignment comments describe a different behavior where remaining steps should be re-scheduled from the resume time and cascade based on their delays.

To stay aligned with the expectations of the assessment, I followed the behavior described in the `resumeSequence()` comments and scheduled remaining steps using cumulative delays from the time of resume, even though this differs slightly from the original scheduling logic.


## Quota / Rate Limiting Trade-offs

### Mailbox Rate Limit Accounting:
I chose to count send attempts against mailbox quotas rather than only successful deliveries. The rate limit check happens before the SMTP call, so failed sends still consume quota.

This keeps the rate limiter simple and prevents repeated retries from bypassing mailbox limits during periods of SMTP instability. The tradeoff is that some quota may be consumed by emails that ultimately fail to send. Suppose SMTP is down for 30 minutes, job will retry 100 times without decreasing single mailbox limit, and when STMP goes up it will suddenly fire those 100 request :)

If the requirement is to count only successful deliveries, the quota increment should happen after a successful SMTP response instead of before the send attempt.


## Reliability Trade-offs

### Worker Retry Strategy:

I decided to rely on BullMQ's built-in retry mechanism instead of adding a custom recovery job for now. Failed send attempts are returned to `pending` so BullMQ can retry them, and an email is only marked as `failed` once all retry attempts are exhausted.

One limitation of this approach is that the system still stores `processing` state in MySQL. If the worker process is terminated unexpectedly (for example, a container crash, host restart, or `SIGKILL`) after updating the row to `processing`, BullMQ can recover the job but the database row remain stuck. In a production system I would handle this by adding a lease/recovery mechanism or by removing the `processing` status from `scheduled_emails` entirely and letting BullMQ be the single source of truth for job execution state.

### Email Delivery vs Database Consistency:

There is still a small failure window between a successful SMTP send and the subsequent database update. If the email is accepted by the provider but the worker crashes before persisting the `sent` status, the job may be retried and the recipient could receive the email more than once.

In a production system I would address this with idempotency mechanisms such as provider message IDs, deduplication keys, or an outbox-style workflow. I did not implement those protections here because they add significant complexity and were outside the scope of the assignment.

### Mailbox Quota Refresh Strategy

I initially implemented the quota dashboard using polling because it was the simplest approach. After revisiting the design, I realized polling would continue fetching data at a fixed interval even when quota values had not changed.

I switched to SSE so updates are pushed only when quota data changes. My first attempt still relied on a server-side interval because the worker and API run as separate processes, which meant an in-memory EventEmitter could not be used for cross-process communication. To make the updates truly event-driven, I used Redis Pub/Sub. The worker publishes a quota update event after incrementing counters, and connected SSE clients receive fresh data only when a change occurs, avoiding the continuous polling behavior.

## What I Would Change With Another Day

- Add a lease/recovery mechanism for emails stuck in `processing`.
- Make rate-limit checks atomic using Redis Lua scripts or transactions.
- Improve pause handling by maintaining a direct mapping between sequences and queued jobs instead of scanning delayed jobs.
- Add idempotency protections around email delivery.

