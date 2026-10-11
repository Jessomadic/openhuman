Reminders and scheduled jobs in OpenHuman's own scheduler (the `cron` tool). This creates work that runs *later*; it cannot read the user's live calendar or meetings. Those come from a connected calendar integration (`tool_search`).

1. **Ground the time.** Pass the user's phrase to `resolve_time` with their timezone (`current_time` gives it). Never hand-compute timestamps.
2. **Confirm.** Propose the exact local time or cadence and get an explicit yes before creating anything.
3. **Create** with `cron` `action:"add"`. `schedule` is a JSON **object**, never a string:
   - one-shot: `{"kind":"at","at":"<rfc3339 from resolve_time>"}` with `delete_after_run: true`
   - recurring: `{"kind":"cron","expr":"<5-field cron>","tz":null}`, e.g. `"0 9 * * *"` daily 9 AM, `"*/30 * * * *"` every 30 min
   - an agent job sets `job_type:"agent"` and a `prompt` that tells the future run exactly what to deliver, plus `delivery: {"mode":"proactive","best_effort":true}`
4. **Manage** with `cron` `action:"list"`, `"update"`, `"remove"`, `"run"` (run now) and `"runs"` (history).

A finite repetition ("5 times") is a recurring job whose prompt says when to stop; explain how to pause or remove it. Report the new job id and that it is listed under Settings → Cron Jobs. If a call fails, name the failed action and the next step.
