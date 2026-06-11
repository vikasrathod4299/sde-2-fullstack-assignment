## General 

### 1. Missing setup-db.ts file -- done

* **File / line:** `backend/package.json`
* **Severity:** High
* **What's wrong:**

  * The `setup:db` script references `scripts/setup-db.ts`, but the file does not exist.
* **Why it's a bug (when does it manifest?):**

  * Running `npm run setup:db` fails, preventing database setup.
* **Fix:**

  * Added `scripts/setup-db.ts` to run schema migrations, seed data, and schedule the test sequence.
* **How I verified:**

  * Running `npm run setup:db` initially failed with a file-not-found error. After adding the script, the command completed successfully.

---

### 2. Sequence status lifecycle is incomplete --done

* **File / line:** `backend/src/sequences/routes.ts`, `backend/src/worker/processor.ts`
* **Severity:** Medium
* **What's wrong:**
  Sequence status is not managed consistently throughout its lifecycle.
* **Why it's a bug (when does it manifest?):**
  The schedule endpoint does not explicitly transition a sequence to `active`, and completed sequences never transition to `completed` after all emails finish processing.
* **Fix:**
  Set the sequence to `active` when scheduling starts, and mark it as `completed` when no `pending` or `processing` emails remain.
* **How I verified:**
  No code path updates a sequence to `completed`, and scheduling does not update the sequence status to `active`.

---

### 3. Error in scheduleSequence loop skips first step for every prospect --done
- **File / line:** `backend/src/sequences/scheduler.ts:43`
- **Severity:** Critical
- **What's wrong:** The loop index starts at `1` instead of `0`:
    ```ts
    for (let i = 1; i <= steps.length; i++) {
          const step = steps[i];
    ```
- **Why it's a bug (when does it manifest?):**
    JavaScript arrays are 0-indexed. With 3 steps, steps[0] (step_order=1, delay_days=0) is never accessed, and steps[3] is undefined   causing a TypeError. The error is silently caught and counted as skipped.
- **Fix:** Change to 0-based loop: `for (let i = 0; i < steps.length; i++)` or use for (const step of steps).
- **How I verified:** Ran scheduleSequence, observed only 2 scheduled emails per prospect instead of 3; confirmed steps[3] is undefined in `console.log()`

---

### 4. Authentication middleware exposes optional `userId` after authentication --done

* **File / line:** `backend/src/auth/middleware.ts`
* **Severity:** Medium
* **What's wrong:**
  `AuthedRequest` defines `userId` as optional (`userId?: number`) even though `requireAuth` guarantees a valid `userId` before calling `next()`.
* **Why it's a bug (when does it manifest?):**
  All authenticated routes must use `req.userId!` or perform unnecessary checks. This weakens type safety and can hide real authentication issues.
* **Fix:**
  Make authenticated requests expose a required user ID:
  ```ts
  export interface AuthedRequest extends Request {
    userId: number;
  }
  ...
  const payload = jwt.verify(token, env.jwtSecret) as { sub: number };
  ```
* **How I verified:**
   Typescript throwing userId as potentially undefined in `pool.execute`.

---

### 5. Missing prospect management endpoints --done

* **File / line:** `backend/src/sequences/routes.ts`
* **Severity:** Low
* **What's wrong:**
  API endpoints for creating and listing prospects by sequence were not implemented.
* **Why it's a bug (when does it manifest?):**
  Users cannot manage prospects for a sequence through the API, making it impossible to fully use or test sequence scheduling functionality from the frontend.
* **Fix:**
  Add endpoints to:

  * List prospects for a sequence
  * Create a prospect for a sequence

  Ensure ownership checks are performed before accessing or modifying sequence data.
* **How I verified:**
  The functionality was required by the application flow, but the corresponding API routes were missing.


## Worker issues

### 1. Duplicate email send due to race condition - done
-  **File / line:** `backend/src/worker/processor.ts` (initial SELECT + status update)
- **Severity:** Critical
- **What's wrong:**
  The worker reads a scheduled email with status `pending` and later updates it to `processing` in a separate query.
- **Why it's a bug (when does it manifest?):**
  Multiple BullMQ workers can read the same record before either updates it. Both workers will continue processing and send the same email, resulting in duplicate deliveries.
- **Fix:**
  Use an atomic state transition:
  ```sql
  const [result]UPDATE scheduled_emails
  SET status = 'processing',
      attempts = attempts + 1
  WHERE id = ?
    AND status = 'pending';
  ```
  ```ts
  if (result.affectedRows === 0) {
    return;
  }
  ```
  Check `affectedRows` and continue only if exactly one row was updated.
- **How I verified:**
  The code performs a `SELECT` followed by a separate `UPDATE`, creating a race window where multiple workers can claim the same email.

---

### 2. Success log written before email is actually sent - done

* **File / line:** `backend/src/worke/processor.ts` (before `send()`)
* **Severity:** High
* **What's wrong:**
  A `send_logs` entry with status `sent` is inserted before the SMTP provider is called.
* **Why it's a bug (when does it manifest?):**
  If the SMTP request fails, the system records a successful send even though the email was never delivered.
* **Fix:**
  Move the success log insertion after:

  1. `send()` completes successfully.
  2. The scheduled email status is updated to `sent`.
* **How I verified:**
  The success log insertion occurs before entering the `try` block that performs the email delivery.

---

### 3. missing failure log entry - done

* **File / line:** `backend/src/worker/processor.ts` (`catch` block)
* **Severity:** Medium
* **What's wrong:**
  Failed deliveries update the scheduled email status to `failed` but do not create a corresponding log entry.
* **Why it's a bug (when does it manifest?):**
  Operational troubleshooting becomes difficult because send failures are not recorded in `send_logs`.
* **Fix:**
  Insert a failure log entry inside the catch block:

  ```ts
  await pool.execute(
    'insert into send_logs (...) values (?, ?, ?, ?)',
    [row.id, row.mailbox_id, 'failed', message],
  );
  ```
* **How I verified:**
  The catch block updates the scheduled email record but never inserts a failure log.

---

### 4.Scheduled email can remain stuck in processing state -- partially done

* **File / line:** `backend/src/worker/processor.ts`
* **Severity:** High
* **What's wrong:**
  The email status is updated to `processing` before multiple operations that may throw unexpected errors.
* **Why it's a bug (when does it manifest?):**
  If the worker crashes, is terminated, or encounters an unhandled exception after setting the status to `processing`, the record may remain stuck and future executions may skip it because its status is no longer `pending`.
* **Fix:**

  * Configure BullMQ retries (`attempts` and `backoff`).
  * Reset the email status back to `pending` for retryable failures.
  * Mark the email as `failed` only after BullMQ retries are exhausted.
  * Ensure retries are idempotent to avoid duplicate sends.
  * Note: Since `processing` state is persisted in the database, terminal worker crashes like process kill, container crash can still leave records stuck in `processing` without an additional lease or recovery mechanism.
* **How I verified:**
  The code transitions to `processing` before rate-limit checks and SMTP execution, but there is no mechanism to recover records left in `processing` after a terminal worker failure.
---

### 5. If the sequence has been paused. In-flight jobs respect the pause immediately --done

* **File / line:** `backend/src/workers/processSendJob.ts`
- **Severity:** High
- **What's wrong:**
  `sequence_status` is fetched from the database but never validated before sending.
- **Why it's a bug (when does it manifest?):**
  Emails may continue to be sent even when a sequence has been paused.
- **Fix:**
  Validate sequence status before sending:
  ```ts
  if (row.sequence_status !== 'active') {
    // Insert send_logs
    return;
  }
  ```
- **How I verified:**
  `sequence_status` is selected into the result object but is never referenced later in the function.

---

### 6. Rate limit quota consumed even when delivery fails - Not fixed (Check decision.md for more info)

* **File / line:** `backend/src/worker/processor.ts` (`checkAndIncrement()`)
* **Severity:** Low
* **What's wrong:**
  Mailbox rate-limit counters are incremented before the email is successfully sent.
* **Why it's a bug (when does it manifest?):**
  SMTP failures still consume quota, reducing the number of emails available for actual successful deliveries.
* **Fix:**
  Clarify intended behavior:

  * If quotas represent attempts, current implementation is acceptable.
  * If quotas represent successful sends, increment counters only after successful delivery.
* **How I verified:**
  `checkAndIncrement()` executes before the SMTP operation.

---

### 7. Duplicate mail delivery or database state can diverge from actual email delivery  - Not fixed (Check decision.md for more info)

* **File / line:** `backend/src/workers/processSendJob.ts` 
* **Severity:** Medium
* **What's wrong:**
  Email delivery and database updates are not coordinated as a single atomic operation.
* **Why it's a bug (when does it manifest?):**
  An email may be successfully delivered, but a database failure occurring immediately afterward can leave the record in a non-sent state. **Retrying the job may send the same email again.**
* **Fix:**
  Introduce idempotency mechanisms:

  * Store provider message IDs.
  * Use deduplication keys.
  * Make retries idempotent.
* **How I verified:**
  The SMTP send operation and status update are independent operations with no transactional guarantees.

---

## Sequence route

### 1. schedule end point is not idempotent --done
- **File / line:** `backend/src/sequences/routes.ts` (POST /:id/schedule)
- **Severity:** High
- **What's wrong:**
    Calling scheduleSequence() multiple times creates new scheduled_emails rows every time.
- **Why it's a bug (when does it manifest?):**
    A user can accidentally click "Schedule" twice, refresh and retry, or multiple requests can hit the endpoint concurrently.
    Each invocation inserts another set of scheduled emails for the same prospects and steps.
- **Fix:**
    Add uniqueness protection:
      `UNIQUE(sequence_id, step_id, prospect_id)`
- **How I verified:**
    scheduleSequence() blindly inserts records without checking for existing rows.

---

### 2. Pause can miss delayed Jobs - not fixed (Checkout DECISION.md for more info)
- File / line: backend/src/sequences/scheduler.ts
- Severity: Medium
- **What's wrong:**
    cancelDelayedJobs() only checks:
    - sendQueue.getDelayed(0, 5000)
- **Why it's a bug (when does it manifest?):**
    - If more than 5000 delayed jobs exist:
    - first 5000 removed
    remaining jobs still execute
- **Fix:**
    Paginate through all delayed jobs.
- **How I verified:**
    Hardcoded limit:
    - getDelayed(0, 5000)

---

### 3. N+1 database query pattern during pause --done

* **File / line:** `backend/src/sequences/scheduler.ts`
* **Severity:** Medium
* **What's wrong:**

  * While pausing a sequence, the code iterates through delayed BullMQ jobs and executes the following query for each job:

    ```sql
    SELECT sequence_id
    FROM scheduled_emails
    WHERE id = ?
    ```
* **Why it's a bug (when does it manifest?):**

  * This creates an N+1 query pattern. For large sequences with hundreds or thousands of scheduled emails, pausing the sequence results in the same number of database queries, causing unnecessary database load and increased latency.
* **Fix:**

  * Fetch all relevant scheduled email IDs and sequence mappings in a single query before the loop.
  * Store the results in a `Map` or `Set` and perform lookups in memory instead of querying the database for every job.
* **How I verified:**

  * The database query is executed inside the iteration over delayed BullMQ jobs, resulting in one query per job.

---

### 4. scheduled email endpoint leaks data across users --done

* **File / line:** `backend/src/scheduled-emails/routes.ts` (`GET /:id`)
* **Severity:** High
* **What's wrong:**
  * The endpoint retrieves a scheduled email record by ID without verifying that it belongs to the authenticated user.
* **Why it's a bug (when does it manifest?):**
  * An authenticated user can access another user's scheduled email by guessing or enumerating IDs:
* **Fix:**
  * Verify ownership by joining through the sequence and user relationship:
  * Ensure the query includes:
    ```sql
    WHERE scheduled_emails.id = ?
      AND sequences.user_id = ?
    ```
  * Use `req.userId` from the authentication middleware for authorization checks.
* **How I verified:**
  * The endpoint query filters only by:
    ```sql
    WHERE id = ?
    ```
---

### 5. sequence scheduling always uses the first available mailbox --done

* **File / line:** `backend/src/sequences/scheduler.ts` (`pickMailboxForSequence`)
* **Severity:** Medium
* **What's wrong:**
  `pickMailboxForSequence()` always selects the first mailbox (`ORDER BY m.id ASC LIMIT 1`) for a user, even when multiple mailboxes are available.
* **Why it's a bug (when does it manifest?):**
  User can't get to decide which mailbox to choose OR in other case all scheduled emails are routed through the same mailbox, causing uneven quota usage and increasing the likelihood of hitting mailbox limits while other mailboxes remain unused.
* **Fix:**
  Allow the scheduler to accept an optional `mailboxId` when scheduling a sequence. If a mailbox is not explicitly provided, a mailbox selection strategy round-robin can be applied to distribute load across available mailboxes.
* **How I verified:**
  `pickMailboxForSequence()` always returns the first mailbox found for the sequence owner and does not consider any mailbox selection criteria.

## Rate limiter

### Rate limiter check and Increment is not atomic --done

* **File / line:** `backend/src/mailboxes/rateLimiter.ts` (`checkAndIncrement`)
* **Severity:** High
* **What's wrong:**
  The limit check and counter increment are performed as separate Redis operations.
* **Why it's a bug (when does it manifest?):**
  Multiple workers can read the same counter value simultaneously, all pass the limit check, and then increment the counters. This can allow mailbox limits to be exceeded under concurrent load.
* **Fix:**
  Perform the check-and-increment operation atomically using Redis transaction (`MULTI/EXEC`).
* **How I verified:**
  `GET` is used to read the counters and the limit validation occurs before separate `INCR` operations are executed.

### Rate limit validation allows one extra send --done

* **File / line:** `backend/src/mailboxes/rateLimiter.ts` (`checkAndIncrement`)
* **Severity:** Medium
* **What's wrong:**
  The rate-limit check uses `>` instead of `>=`.
* **Why it's a bug (when does it manifest?):**
  When the counter is exactly equal to the configured limit, the request is still allowed and the counter is incremented beyond the limit.
* **Fix:**
  ```ts
  if (dailyCount >= mailbox.daily_limit)
  if (hourlyCount >= mailbox.hourly_limit)
  ```
* **How I verified:**
  With a limit of `100`, a counter value of `100` still passes the validation and is incremented to `101`.
