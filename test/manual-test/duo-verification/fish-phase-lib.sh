#!/bin/bash
# Strict shared helpers for the Fish public-sentinel native phase. Sourced by
# the phase script and by fish-phase-hostchecks.sh, which exercises the fatal
# paths against fake trees and fake Apple tools. No side effects on source.
# Every function RETURNS nonzero on its fatal condition; the caller decides to
# exit. No function creates, removes or erases anything.

# The attempt directory must already exist (the launcher creates it exactly
# once), be owned by this user, and be mode 0700.
phase_require_attempt_dir() { # ATTEMPT_DIR
  local a=$1
  [ -n "$a" ] || return 1
  [ -d "$a" ] || return 1
  [ "$(stat -f '%u' "$a")" = "$(id -u)" ] || return 1
  [ "$(stat -f '%Lp' "$a")" = "700" ] || return 1
}

# Binds the single fresh result bundle of this run: exactly one result-*.xcresult
# under P, equal to the path the runner's Artifacts line printed, with an
# Info.plist newer than the phase-start stamp (rejects zero, multiple, stale or
# mismatched results). Echoes the bound path on success.
phase_bind_result() { # PROBE_DIR INVOCATION_LOG STAMP -> RESULT_PATH
  local p=$1 inv=$2 stamp=$3
  local -a results=("$p"/result-*.xcresult)
  [ "${#results[@]}" -eq 1 ] || return 1
  [ -d "${results[0]}" ] || return 1
  local parsed
  parsed=$(sed -nE 's/^Artifacts: .* \(result: ([^,]+), log: ([^)]+)\)$/\1/p' "$inv" | tail -1)
  [ -n "$parsed" ] || return 1
  [ "$parsed" = "${results[0]}" ] || return 1
  # bash -nt compares whole seconds; a fresh result from the same second must
  # still pass while anything older than the phase-start stamp must fail.
  [ "$(stat -f '%m' "${results[0]}/Info.plist")" -ge "$(stat -f '%m' "$stamp")" ] || return 1
  printf '%s\n' "${results[0]}"
}

# Binds the single fresh test log the runner's Artifacts line printed.
phase_bind_test_log() { # INVOCATION_LOG -> TEST_LOG_PATH
  local inv=$1
  local parsed
  parsed=$(sed -nE 's/^Artifacts: .* \(result: ([^,]+), log: ([^)]+)\)$/\2/p' "$inv" | tail -1)
  [ -n "$parsed" ] && [ -f "$parsed" ] && printf '%s\n' "$parsed"
}

# Asserts the installed app bundle identity: explicit nonempty canonical path
# bound to this simulator's UDID, named OpenReader.app, and each expected plist
# value asserted separately (never an OR of grep lines).
phase_assert_plist_identity() { # APP_BUNDLE UDID
  local bundle=$1 udid=$2 plist
  [ -n "$bundle" ] || return 1
  case "$bundle" in
    *"/$udid/"*) : ;;
    *) return 1 ;;
  esac
  [ "${bundle##*/}" = "OpenReader.app" ] || return 1
  plist="$bundle/Info.plist"
  [ -f "$plist" ] || return 1
  [ "$(plutil -extract CFBundleShortVersionString raw -o - -- "$plist")" = "1.0.4" ] || return 1
  [ "$(plutil -extract CFBundleVersion raw -o - -- "$plist")" = "30" ] || return 1
  [ "$(plutil -extract RCTMetroPort raw -o - -- "$plist")" = "8437" ] || return 1
}

# Asserts the owned Metro receipt by exact PID plus start/command line, the
# port's listening PID, and the process's own cwd via lsof (macOS ps has no
# reliable cwd field).
phase_assert_metro() { # PID PORT WORKTREE
  local pid=$1 port=$2 worktree=$3
  [ -n "$pid" ] && [ -n "$port" ] && [ -n "$worktree" ] || return 1
  ps -p "$pid" -o lstart=,command= 2>/dev/null | grep -q "expo start --port $port" || return 1
  local listen_pid
  listen_pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)
  [ "$listen_pid" = "$pid" ] || return 1
  lsof -a -p "$pid" -d cwd 2>/dev/null | grep -qF "$worktree" || return 1
}

# Runs one export command: requires exit 0 AND a nonempty stdout artifact;
# appends the failure into the error log and returns nonzero otherwise.
phase_run_export() { # OUT_FILE ERR_FILE COMMAND...
  local out=$1 err=$2
  shift 2
  if ! "$@" > "$out" 2> "$err"; then
    printf 'EXPORT-FAILED: %s\n' "$*" >> "$err"
    return 1
  fi
  [ -s "$out" ] || { printf 'EXPORT-EMPTY: %s\n' "$*" >> "$err"; return 1; }
}

# Records a HOLD (never a pass) with its reason; also echoed to stderr.
phase_write_hold() { # ATTEMPT_DIR REASON...
  local a=$1
  shift
  printf 'HOLD: %s\n' "$*" | tee "$a/hold-record.txt" >&2
}
