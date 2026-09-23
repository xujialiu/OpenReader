import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { chapterTextCount, descendants, fullyPrepared, type Chapter, type DownloadTask, type OfflineVoice, type TaskState } from '../offline/model';
import * as downloads from '../offline/runtime';
import { INK } from './controls';
import { DownloadRing } from './download-ring';
import { listedInManage, marker, type Marker } from './download-rows';
import { Icon } from './icon';

/**
 * The line above the list: the download's state, for when its rows are out of
 * sight, and what went wrong. Paused is not among them, because Resume all
 * below the list already says it (#56).
 */
const STATE_LINE: Partial<Record<TaskState, string>> = {
  preparing: 'Preparing selected chapter…', downloading: 'Downloading…', queued: 'Queued', waiting: 'No network connection, waiting to reconnect',
  blocked: 'Needs attention', interrupted: 'Interrupted · continues when available',
};
const stateLine = (task: DownloadTask) => task.state === 'done' ? task.failed.length ? `${task.failed.length} chapters failed` : 'Selected chapters downloaded' : STATE_LINE[task.state];

export function DownloadContent({ document, title, voice, onVoice, onStart }: {
  document: string; title: string; voice: OfflineVoice; onVoice?(voice: OfflineVoice): void; onStart?(): void;
}) {
  downloads.useDownloads();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [manage, setManage] = useState(false);
  const [managedVoice, setManagedVoice] = useState<OfflineVoice | null>(null);
  const choice = manage && managedVoice ? managedVoice : voice;
  useEffect(() => { downloads.requestPlan(document, title); }, [document, title]);
  const plan = downloads.planOf(document);
  const task = downloads.downloadTasks(document).find((t) => downloads.sameVoice(t.voice, choice));
  const chapters = useMemo(() => plan?.chapters ?? [], [plan]);
  useEffect(()=>{
    const selectedVoice={provider:choice.provider,voice:choice.voice,label:choice.label};
    if(plan)downloads.requestProgress(document,selectedVoice);
    return ()=>downloads.releaseProgress(document,selectedVoice);
  },[document,choice.provider,choice.voice,choice.label,plan]);
  const progress=downloads.chapterProgress(document,choice);
  const progressReady=!!plan && progress.size===chapters.length;
  const textual = (c: Chapter) => c.prepared === false || chapterTextCount(c) > 0;
  const markers = new Map<string, Marker | null>(chapters.map((c) => [c.id, marker(c, progress.get(c.id), task, manage)]));
  const eligible = chapters.filter((c) => textual(c) && markers.get(c.id)?.kind === 'checkbox');
  const eligibleIds = new Set(eligible.map((c) => c.id));
  const chosen = [...selected].filter((id) => eligibleIds.has(id));
  const toggle = (ids: string[]) => setSelected((was) => {
    const next = new Set(was); const remove = ids.every((id) => next.has(id));
    ids.forEach((id) => { if (remove) next.delete(id); else next.add(id); }); return next;
  });
  const listed = manage ? listedInManage(chapters, markers) : null;
  const visible = chapters.filter((chapter) => {
    if (listed ? !listed.has(chapter.id) : !textual(chapter) && !chapters.some((c) => c.parent === chapter.id)) return false;
    let parent = chapter.parent;
    while (parent) { if (collapsed.has(parent)) return false; parent = chapters.find((c) => c.id === parent)?.parent ?? null; }
    return true;
  });
  const full = chapters.filter(textual).length;
  const completed = [...progress.values()].filter((p) => p.complete).length;
  const whole = !!plan && fullyPrepared(plan) && full > 0 && completed === full;
  const state = downloads.indexingState(document);
  const otherVoices = downloads.savedVoices(document).filter((v) => !downloads.sameVoice(v, choice) && downloads.occupied(document, v) > 0);
  // Nothing saved for any voice and nothing under way: there is nothing to manage, so the link is not offered (#37).
  const manageable = manage || downloads.occupied(document) > 0 || downloads.downloadTasks(document).some((t) => t.state !== 'done');
  const act = () => {
    try {
      if (manage) Alert.alert('Delete downloaded audio?', 'The document and reading position will be kept.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => {
          void downloads.deleteDownloaded(document, choice, chosen).then(()=>setSelected(new Set()),e=>Alert.alert('Could not delete audio',String(e)));
        } },
      ]);
      else { onStart?.(); downloads.enqueue(document, choice, chosen); setSelected(new Set()); }
    } catch (e) { Alert.alert('Download could not start', String(e)); }
  };
  /**
   * Everything saved for this Document, whatever voice or bracket setting it
   * was saved under (ADR 0028).
   *
   * The per-chapter delete above can only reach audio the current settings can
   * name. Change a bracket setting and the saved audio re-keys with it, so it
   * stops appearing in this list while `occupied()` — which sums the inventory
   * by voice and never looks at the text — keeps counting it. That leaves
   * megabytes saved against no chapters downloaded and no way to act on it,
   * which is what this is for.
   *
   * The plan is asked for again afterwards because `removeDownloads` drops it
   * along with the audio, and the effect that first requested it is keyed on the
   * document rather than on this.
   */
  const deleteEverything = () => Alert.alert('Delete all saved audio?',
    `Everything saved for this document will be deleted, freeing ${downloads.formatBytes(downloads.occupied(document))}. The document and reading position will be kept.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        void downloads.removeDownloads(document).then(() => {
          setSelected(new Set()); setManage(false); setManagedVoice(null); downloads.requestPlan(document, title);
        }, (e) => Alert.alert('Could not delete audio', String(e)));
      } },
    ]);
  return <View style={styles.content}>
    <View style={styles.top}><Text style={styles.voice} numberOfLines={2}>Voice · {choice.label || 'Choose a voice in the player'}</Text>
      <Pressable accessibilityRole="button" onPress={() => toggle(eligible.map((c) => c.id))} disabled={!eligible.length}>
        <Text style={[styles.link, !eligible.length && { color: INK.quiet }]}>{eligible.length && chosen.length === eligible.length ? 'Deselect all' : 'Select all'}</Text>
      </Pressable></View>
    {!plan ? <View style={styles.preparing}>
      {state?.state !== 'failed' ? <ActivityIndicator /> : null}
      <Text style={styles.secondary}>{state?.error ?? 'Loading contents…'}</Text>
      {state?.state === 'failed' ? <Pressable onPress={() => downloads.requestPlan(document, title)}><Text style={styles.link}>Try again</Text></Pressable> : null}
    </View> : null}
    {downloads.downloadError() ? <Text style={styles.error}>{downloads.downloadError()}</Text> : null}
    {plan && !progressReady ? <Text style={styles.secondary}>Checking saved downloads…</Text> : null}
    {plan ? <Text style={styles.secondary}>{manage ? `${downloads.formatBytes(downloads.occupied(document, choice))} saved` :
      `${completed} chapters downloaded`}</Text> : null}
    {task && task.chapters.length > 0 && !manage && task.state !== 'paused' && !(task.state === 'done' && !task.failed.length && whole) ? <View style={styles.top}>
      <Text style={[styles.secondary, { flex: 1 }]}>{stateLine(task)}{task.error ? `\n${task.error}` : ''}</Text>
      {task.state === 'done' && task.failed.length ? <Pressable accessibilityRole="button" onPress={() => downloads.toggleTask(task)}>
        <Text style={styles.link}>Retry failed</Text>
      </Pressable> : null}
    </View> : null}
    <FlatList data={visible} style={styles.list} keyExtractor={(c) => c.id} initialNumToRender={14}
      ListEmptyComponent={plan && !manage ? <Text style={styles.secondary}>No readable text in this document.</Text> : null}
      renderItem={({ item }) => {
        const children = chapters.some((c) => c.parent === item.id);
        const group = descendants(chapters, item.id);
        const ids = group.map((c) => c.id).filter((id) => eligibleIds.has(id));
        const done = group.length > 0 && group.every((c) => progress.get(c.id)?.complete);
        const picked = ids.length > 0 && ids.every((id) => selected.has(id));
        const count = progress.get(item.id)?.count ?? 0;
        const failed = !!task?.failed.includes(item.id);
        const mark = children ? null : markers.get(item.id);
        const name = <Text style={[styles.title, children && { fontWeight: '600' }]} numberOfLines={2}>{item.title || 'Untitled chapter'}</Text>;
        return <View style={[styles.row, { paddingLeft: 4 + Math.min(item.depth, 4) * 15 }]}>
          {children ? <Pressable accessibilityRole="button" accessibilityLabel={`${collapsed.has(item.id) ? 'Expand' : 'Collapse'} ${item.title}`}
            onPress={() => setCollapsed((was) => { const next = new Set(was); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} style={styles.collapse}>
            <Icon name={collapsed.has(item.id) ? 'next' : 'down'} color={INK.quiet} size={18} />
          </Pressable> : null}
          {mark?.kind === 'ring' && task ? <View style={styles.chapter}><View style={{ flex: 1 }}>{name}</View>
            <DownloadRing fraction={mark.fraction} spinning={mark.spinning} halted={mark.halted} onPress={() => downloads.toggleChapter(task, item.id)} />
          </View> :
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.title || 'Untitled chapter'}${done ? ', downloaded' : ''}`}
            accessibilityState={{ checked: picked, disabled: !ids.length }} disabled={!ids.length} onPress={() => toggle(ids)} style={styles.chapter}>
            <View style={{ flex: 1 }}>{name}
              {!done && (count || failed) ? <Text style={styles.secondary}>{failed ? 'Failed · ' : ''}{count} / {chapterTextCount(item)}</Text> : null}</View>
            {done && !manage ? <Icon name="check" color={INK.reading} size={22} /> :
              ids.length || !children ? <View style={[styles.circle, picked && styles.checked]}>{picked ? <Icon name="check" color={INK.page} size={17} /> : null}</View> : null}
          </Pressable>}
        </View>;
      }} />
    {otherVoices.length ? <View style={styles.other}>{otherVoices.map((v) => <Pressable key={`${v.provider}/${v.voice}`} accessibilityRole="button"
      onPress={() => { setSelected(new Set()); if (manage) setManagedVoice(v); else onVoice?.(v); }}><Text style={styles.link}>{manage ? 'Manage' : 'Use downloaded voice'} · {v.label}</Text></Pressable>)}</View> : null}
    <View style={styles.footer}>
      {manageable ? <View style={styles.top}>
        <Pressable accessibilityRole="button" onPress={() => { setSelected(new Set()); setManage(!manage); setManagedVoice(null); }}><Text style={styles.link}>{manage ? 'Back to downloads' : 'Manage downloads'}</Text></Pressable>
        {manage ? downloads.occupied(document) > 0 ? <Pressable accessibilityRole="button" onPress={deleteEverything}>
          <Text style={[styles.link, { color: INK.attention }]}>Delete all saved audio</Text>
        </Pressable> : null :
        // Where Manage downloads offers Delete all saved audio: the whole download, where a ring is one chapter (#56).
        task && task.state !== 'done' ? <Pressable accessibilityRole="button" onPress={() => downloads.toggleTask(task)}>
          <Text style={styles.link}>{downloads.goesOn(task) ? 'Pause all' : 'Resume all'}</Text>
        </Pressable> : null}
      </View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={manage ? `Delete selected (${chosen.length})` : `Download selected (${chosen.length})`}
        disabled={!progressReady || !downloads.downloadsReady() || !chosen.length || !choice.voice || !!downloads.downloadError()} onPress={act}
        style={[styles.button, (!chosen.length || !choice.voice) && { opacity: 0.35 }]}>
        <Text style={styles.buttonText}>{manage ? 'Delete selected' : 'Download selected'} ({chosen.length})</Text>
      </Pressable>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 12, flexShrink: 1 }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  voice: { color: INK.text, fontSize: 15, flex: 1 }, link: { color: INK.reading, fontSize: 14, paddingVertical: 8 },
  secondary: { color: INK.quiet, fontSize: 13 }, error: { color: INK.text, fontSize: 13 },
  preparing: { padding: 20, gap: 14, alignItems: 'center' }, list: { height: 330, flexGrow: 0, flexShrink: 1 },
  row: { minHeight: 62, flexDirection: 'row', borderBottomColor: INK.line, borderBottomWidth: StyleSheet.hairlineWidth },
  chapter: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12, paddingVertical: 12 }, title: { color: INK.text, fontSize: 16 },
  collapse: { width: 30, alignItems: 'center', justifyContent: 'center' }, circle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: INK.quiet, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: INK.reading, borderColor: INK.reading },
  footer: { gap: 6 }, button: { backgroundColor: INK.text, borderRadius: 24, alignItems: 'center', paddingVertical: 15 }, buttonText: { color: INK.page, fontWeight: '600', fontSize: 16 }, other: { gap: 4 },
});
