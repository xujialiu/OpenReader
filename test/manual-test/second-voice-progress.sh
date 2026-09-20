#!/bin/bash
set -euo pipefail
if [[ $# != 2 ]]; then
  echo 'Usage: second-voice-progress.sh SIMULATOR_UDID NEW_OUTPUT_DIR' >&2
  exit 2
fi

simulator=$1
output=$2
source_dir=$(cd "$(dirname "$0")" && pwd)
output=$(mkdir -p "$output" && cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }

bundle=top.xujialiu.openreader
short_key=1b419b65884cca44dbc521c2a19cd6ab0d880c303d408bd9429c7499af4a949c
new_voice_id=en/11111111111111111111111111111111
new_voice_key=b92a74d4b2379a510f4566915168f6289f3b596cc0dfd6ad93365ee2696c1872

app_data=$(xcrun simctl get_app_container "$simulator" "$bundle" data)
offline="$app_data/Documents/offline-narration-v2"
db="$offline/catalog.sqlite"
backup="$output/original-offline-narration-v2"
settings_backup="$output/original-settings.json"
library_backup="$output/original-library.json"
synthetic="$output/synthetic-offline-narration-v2"
[[ ! -e "$backup" && ! -e "$synthetic" ]] || { echo 'Use a new artifact directory; existing backups must not be overwritten.' >&2; exit 2; }

restore() {
  local code=$?
  trap - EXIT
  xcrun simctl terminate "$simulator" "$bundle" >/dev/null 2>&1 || true
  if [[ -e "$synthetic" ]]; then echo 'Restore stopped: synthetic artifact path already exists; backups are retained.' >&2; exit 1; fi
  if [[ -d "$offline" ]] && ! mv "$offline" "$synthetic"; then
    echo 'Restore failed to move the test store; app is stopped and backups are retained.' >&2; exit 1
  fi
  if ! { mkdir -p "$offline" && cp -a "$backup/." "$offline/" &&
    cp "$settings_backup" "$app_data/Documents/settings.json" &&
    cp "$library_backup" "$app_data/Documents/library.json"; }; then
    echo 'Restore failed; app is stopped and backups are retained. Do not claim a passed delivery.' >&2; exit 1
  fi
  printf 'Artifacts: %s\n' "$output"
  exit "$code"
}

xcrun simctl terminate "$simulator" "$bundle" >/dev/null 2>&1 || true
mkdir -p "$backup"
cp -a "$offline/." "$backup/"
cp "$app_data/Documents/settings.json" "$settings_backup"
cp "$app_data/Documents/library.json" "$library_backup"
trap restore EXIT

IFS='|' read -r base_voice clip_key payload_name <<< "$(sqlite3 "$db" "select c.voice,c.key,c.path from clips c join memberships m on m.document=c.document and m.clip_key=c.key where c.document='$short_key' and m.chapter='nav.1' and c.state='ready' order by m.ordinal limit 1")"
[[ "$base_voice" =~ ^[a-f0-9]{64}$ && "$clip_key" =~ ^[a-f0-9]{64}$ ]] || { echo 'The short fixture needs one retained second-chapter clip' >&2; exit 1; }
[[ "$payload_name" == "$clip_key.audio" || "$payload_name" == "$clip_key.m4a" ]] || { echo 'Unexpected fixture audio filename' >&2; exit 1; }

mkdir -p "$offline/$short_key/$new_voice_key"
cp "$offline/$short_key/$base_voice/$payload_name" "$offline/$short_key/$new_voice_key/$payload_name"
cp "$offline/$short_key/$base_voice/$clip_key.json" "$offline/$short_key/$new_voice_key/$clip_key.json"
sqlite3 "$db" <<SQL
BEGIN IMMEDIATE;
INSERT INTO voices(document,key,provider,voice_id,label)
  VALUES('$short_key','$new_voice_key','fish','$new_voice_id','Synthetic second voice');
INSERT INTO clips(document,voice,key,path,size,metadata,state)
  SELECT document,'$new_voice_key',key,path,size,json_set(metadata,'$.voice','$new_voice_key'),'ready'
  FROM clips WHERE document='$short_key' AND voice='$base_voice' AND key='$clip_key';
COMMIT;
SQL

xcrun simctl launch "$simulator" "$bundle" >/dev/null
ruby "$source_dir/ios/project.rb" "$output" "$bundle" NO second SecondVoiceProbe.swift
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" test > "$output/test.log" 2>&1
if [[ -d "$output/result.xcresult" ]]; then
  xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments"
fi
