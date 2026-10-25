# LastPing ping action

Report a GitHub Actions job's start and its outcome to a [LastPing](https://lastping.dev) monitor. LastPing raises an incident when a run fails, hangs past its expected duration, or never runs at all, and tells you on email, Slack, Discord, Telegram, Microsoft Teams and more.

The action is plain Node with no dependencies, so it works the same on Ubuntu, macOS and Windows runners whether or not `curl` is installed. A ping that cannot be delivered logs a warning and never fails your job, unless you ask it to.

> **Have admin rights on the repository?** LastPing's [`workflow_run` webhook setup](https://lastping.dev/monitor/github-actions/) is the recommended option: one signed webhook in the repository settings, no YAML changes, and it reports the name of the step that failed. Use this action when you cannot add a webhook, or when you want one monitor for one specific job.

## Setup in 3 steps

1. In [LastPing](https://lastping.dev), create a monitor for the job and copy its ping URL (`https://ping.lastping.dev/<monitor-id>`).
2. In your repository, add it as a secret: **Settings → Secrets and variables → Actions → New repository secret**, named `LASTPING_PING_URL`.
3. Add two steps to the job: one at the start, and one at the end with `if: always()` so it runs whatever happened.

```yaml
jobs:
  nightly:
    runs-on: ubuntu-latest
    steps:
      - uses: lastping-dev/ping-action@v1
        with:
          ping-url: ${{ secrets.LASTPING_PING_URL }}
          status: start

      # ... the job's steps ...

      - uses: lastping-dev/ping-action@v1
        if: always()
        with:
          ping-url: ${{ secrets.LASTPING_PING_URL }}
          status: ${{ job.status }}
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `ping-url` | (required) | The monitor's ping URL. Keep it in a secret: anyone with it can ping your monitor. The action masks it in the log and never prints it. |
| `status` | `success` | `start`, `success`, `failure`, `cancelled`, `log`, or an exit code `0`-`255`. Pass `${{ job.status }}` in the final step. |
| `body` | empty | Text stored with the ping, for example a failure message. Cut to 10,000 bytes, the most LastPing stores. |
| `run-id` | `<run id>-<run attempt>` | Sent as `?rid=`. It pairs a start with its finish, so LastPing records the run's duration. |
| `on-cancelled` | `fail` | What a cancelled job sends: `fail` alerts, `log` attaches a note without changing the monitor's state, `skip` sends nothing. |
| `fail-on-error` | `false` | Fail the step when the ping cannot be delivered after retries. |

## What each status sends

The action uses LastPing's [ping API](https://lastping.dev/monitor/). Every request is a `POST`, with the body if there is one.

| `status` | URL | Meaning in LastPing |
| --- | --- | --- |
| `start` | `<ping-url>/start` | Run started; arms overrun detection |
| `success` | `<ping-url>` | Success |
| `failure` | `<ping-url>/fail` | Failure; alerts immediately |
| `cancelled` | `<ping-url>/fail` (see `on-cancelled`) | Failure, with the body `GitHub Actions job cancelled` unless you set one |
| `log` | `<ping-url>/log` | A note on the monitor; no state change |
| `0`-`255` | `<ping-url>/<code>` | `0` is success, anything else a failure |
| `skipped` | nothing | |

A cancelled job counts as a failure by default because the work did not finish. If cancelling is routine for the job (for example with `concurrency: cancel-in-progress`), use `on-cancelled: skip` or `log`.

Each ping is tried up to 3 times with a 10-second timeout per attempt. Server errors, timeouts, `408` and `429` are retried; other `4xx` answers are not.

## Examples

### Attach the reason to a failure

```yaml
      - name: Tests
        shell: bash
        run: make test 2>&1 | tee test.log

      - name: Last lines of the log
        id: tail
        if: failure()
        shell: bash
        run: |
          {
            echo 'text<<EOF'
            tail -n 40 test.log
            echo EOF
          } >> "$GITHUB_OUTPUT"

      - uses: lastping-dev/ping-action@v1
        if: always()
        with:
          ping-url: ${{ secrets.LASTPING_PING_URL }}
          status: ${{ job.status }}
          body: ${{ steps.tail.outputs.text }}
```

### A scheduled workflow

A schedule that silently stops (GitHub disables scheduled workflows in public repositories after 60 days without activity) sends no ping at all, and LastPing alerts on the missing run.

```yaml
on:
  schedule:
    - cron: '0 3 * * *'

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: lastping-dev/ping-action@v1
        with:
          ping-url: ${{ secrets.LASTPING_PING_URL }}
          status: start
      - run: ./backup.sh
      - uses: lastping-dev/ping-action@v1
        if: always()
        with:
          ping-url: ${{ secrets.LASTPING_PING_URL }}
          status: ${{ job.status }}
```

### A matrix

Matrix jobs share a run id, so give each leg its own `run-id` (and, usually, its own monitor):

```yaml
      - uses: lastping-dev/ping-action@v1
        with:
          ping-url: ${{ secrets.LASTPING_PING_URL }}
          status: start
          run-id: ${{ github.run_id }}-${{ github.run_attempt }}-${{ strategy.job-index }}
```

Use the same `run-id` in the final step.

### Make a ping failure fail the job

```yaml
      - uses: lastping-dev/ping-action@v1
        with:
          ping-url: ${{ secrets.LASTPING_PING_URL }}
          status: start
          fail-on-error: true
```

## License

[MIT](LICENSE)
