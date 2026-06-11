# AI_USAGE.md

## Tools Used

I used:

* ChatGPT (web) for code review, design discussions, edge-case analysis, and documentation.
* OpenCode with DeepSeek V4 for implementation suggestions, refactoring ideas, and validating alternative approaches.

I primarily used AI as a pair-programming and review tool rather than generating complete features end-to-end. Most suggestions were validated against the existing codebase and assignment requirements before being applied.

---

## Prompts That Worked Well

### Prompt 1

**What I asked:**

> I updated the worker to claim emails using `UPDATE ... WHERE status = 'pending'`. Review this change and check whether it fully resolves the race condition.

**What I got:**

This was one of the more useful discussions. The AI pointed out that adding `WHERE status = 'pending'` alone was not enough. Even though the update became conditional, I was not checking the update result (`affectedRows`) afterward.

That means two workers could still read the same row, both attempt to claim it, and the second worker would continue processing even if its update matched zero rows.

The discussion helped me realize that the claim is only safe if the worker verifies it actually acquired ownership of the row before continuing.

### Prompt 2

**What I asked:**

> Given this sequence scheduler implementation, how would you implement resume functionality while preserving step ordering and delays for each prospect?

**What I got:**

AI helped break the problem into smaller steps (grouping pending emails by prospect, ordering by step order, recalculating delays, and re-enqueuing jobs). I still adjusted the final implementation to align with the assignment comments and existing code structure.

---

## When AI Was Wrong

### 1. Delayed Job Pagination

AI suggested paginating delayed jobs using an offset:

```ts
let start = 0;

while (true) {
  const jobs = await sendQueue.getDelayed(
    start,
    start + batchSize - 1,
  );

  if (jobs.length === 0) {
    break;
  }

  // process jobs

  start += batchSize;
}
```

This looked reasonable at first, but the implementation removes jobs while iterating. As jobs are removed, the delayed-job collection shrinks and the next offset can skip jobs that shift into earlier positions.

I caught this by walking through an example where 500 jobs were removed from a batch of 1000 and noticing that incrementing the offset would skip part of the remaining queue.

---

### 2. Moving Status Updates To `worker.on('completed')`

AI suggested moving the `scheduled_emails.status = 'sent'` update into a BullMQ `worker.on('completed')` handler.

After reviewing the flow, I realized this introduces a failure scenario:

1. SMTP send succeeds.
2. Database update fails.
3. Job throws before completion.
4. `worker.on('completed')` never runs.

This would leave the email stuck in `processing` even though the email was successfully delivered.

I caught this by checking the success and failure paths of the worker and verifying when BullMQ emits completion events.

