---
name: pulse-diagnosis
description: Diagnose a Windows PC with the Pulse Bridge MCP tools (crashes, blue screens, sudden restarts, slowness, failing disks, high CPU or memory). Use when the user asks why their PC crashed, restarted, froze or is slow, or asks for a health check or report of this PC.
---

# Diagnosing a Windows PC with Pulse Bridge

Pulse Bridge exposes read-only tools over PulseService, the Pulse
diagnostics service running on this PC. Nothing you call changes Windows.

## 0. Check the connection first

Call `bridge_status`.

- `servicePipeConnected: false` → PulseService is not running. Tell the user
  to open Pulse or start the "PulseService" Windows service, then stop.
- `pulseCompatibility: "untested"` → this Pulse version is newer than the
  bridge was tested with. Continue, but mention that some fields may be
  missing.
- `redactPersonalData: true` → names, IPs, SIDs and serials appear as
  `[user]`, `[computer]`, `[ip]`, `[serial]`. Never try to guess them.

## 1. What happened: the timeline

Start from events, not metrics.

1. `timeline_search` with `severity: ["critical", "error"]` and a `from`
   covering the period the user describes (default: last 24 hours).
2. Group what you find:
   - **Blue screen / sudden restart**: Kernel-Power 41, BugCheck 1001,
     WHEA-Logger. Report the stop code and what Pulse says usually causes it.
   - **App crash**: Application Error 1000 and Windows Error Reporting 1001
     for the same process.
   - **Service crash**: Service Control Manager 7031 / 7034.
   - **Disk**: disk, Ntfs, stornvme, storahci providers.
   - **Updates**: WindowsUpdateClient failures.
3. Read the event's plain-language summary first. Ask for raw XML
   (`includeRaw: true`) only when the summary is not enough.

The Security log is only readable if PulseService runs with access to it;
an `ACCESS_DENIED` error there is expected, not a failure.

## 2. Why: system state

Pick only the tools the events point to:

- Crashes, freezes or heat → `system_cpu`, `system_gpu` (temperatures,
  every GPU), `system_memory` (commit close to the limit means paging).
- Disk errors or slowness → `system_storage`: check `diskHealth` for
  `failurePredicted`, `nvmeCriticalWarning`, `mediaErrors`,
  `wearPercentUsed` near or above 100, `availableSparePercent` below its
  threshold, and volumes above 90% full.
- Slowness now → `process_list` sorted by `cpu` or `memory`, then
  `process_details` for a suspicious process (publisher, path, parent).
- Network problems → `system_network`.

## 3. Answer

- Lead with the most likely cause in one or two plain sentences.
- Then the evidence: event time, source and ID, and the metric values.
- Then what to check or do next, safest first. Never suggest registry
  cleaners, "optimizers" or disabling security features.
- Say clearly when the data does not show a cause.

## 4. Reports

`report_export` writes a file (json, csv, html, pdf, markdown) and returns
its path, not its content. Report files are **not** masked; tell the user
before they share one.
