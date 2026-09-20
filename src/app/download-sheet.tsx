import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { chapterTextCount, descendants, fullyPrepared, type OfflineVoice } from '../offline/model';
import * as downloads from '../offline/runtime';
import { INK } from './controls';
import { Icon } from './icon';

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
  const busy = (id: string) => !!task && ['preparing', 'downloading', 'queued', 'waiting'].includes(task.state) && task.chapters.includes(id) && !task.failed.includes(id);
  const eligible = chapters.filter((c) => (c.prepared === false || chapterTextCount(c) > 0) && (manage ? (progress.get(c.id)?.count ?? 0) > 0 : !progress.get(c.id)?.complete && !busy(c.id)));
  const eligibleIds = new Set(eligible.map((c) => c.id));
  const chosen = [...selected].filter((id) => eligibleIds.has(id));
  const toggle = (ids: string[]) => setSelected((was) => {
    const next = new Set(was); const remove = ids.every((id) => next.has(id));
    ids.forEach((id) => { if (remove) next.delete(id); else next.add(id); }); return next;
  });
  const visible = chapters.filter((chapter) => {
    if (chapter.prepared !== false && !chapterTextCount(chapter) && !chapters.some((c) => c.parent === chapter.id)) return false;
    let parent = chapter.parent;
    while (parent) { if (collapsed.has(parent)) return false; parent = chapters.find((c) => c.id === parent)?.parent ?? null; }
    return true;
  });
  const full = chapters.filter((c) => c.prepared === false || chapterTextCount(c) > 0).length;
  const completed = [...progress.values()].filter((p) => p.complete).length;
  const whole = !!plan && fullyPrepared(plan) && full > 0 && completed === full;
  const state = downloads.indexingState(document);
  const otherVoices = downloads.savedVoices(document).filter((v) => !downloads.sameVoice(v, choice) && downloads.occupied(document, v) > 0);
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
      whole ? 'Whole document downloaded' : `${completed} chapters downloaded`}</Text> : null}
    {task && task.chapters.length > 0 && !manage && !(task.state === 'done' && !task.failed.length && whole) ? <View style={styles.top}>
      <Text style={[styles.secondary, { flex: 1 }]}>{task.state === 'done' ? task.failed.length ? `${task.failed.length} chapters failed` : 'Selected chapters downloaded' :
        ({ preparing: 'Preparing selected chapter…', downloading: 'Downloading…', queued: 'Queued', waiting: 'No network connection, waiting to reconnect', paused: 'Paused',
          blocked: 'Needs attention', interrupted: 'Interrupted · continues when available' }[task.state])}{task.error ? `\n${task.error}` : ''}</Text>
      {task.state !== 'done' || task.failed.length ? <Pressable accessibilityRole="button" onPress={() => downloads.toggleTask(task)}>
        <Text style={styles.link}>{['preparing', 'downloading', 'queued', 'waiting'].includes(task.state) ? 'Pause' : task.failed.length ? 'Retry failed' : 'Continue'}</Text>
      </Pressable> : null}
    </View> : null}
    <FlatList data={visible} style={styles.list} keyExtractor={(c) => c.id} initialNumToRender={14}
      ListEmptyComponent={plan ? <Text style={styles.secondary}>No readable text in this document.</Text> : null}
      renderItem={({ item }) => {
        const children = chapters.some((c) => c.parent === item.id);
        const group = descendants(chapters, item.id);
        const ids = group.map((c) => c.id).filter((id) => eligibleIds.has(id));
        const done = group.length > 0 && group.every((c) => progress.get(c.id)?.complete);
        const picked = ids.length > 0 && ids.every((id) => selected.has(id));
        const count = progress.get(item.id)?.count ?? 0;
        return <View style={[styles.row, { paddingLeft: 4 + Math.min(item.depth, 4) * 15 }]}>
          {children ? <Pressable accessibilityRole="button" accessibilityLabel={`${collapsed.has(item.id) ? 'Expand' : 'Collapse'} ${item.title}`}
            onPress={() => setCollapsed((was) => { const next = new Set(was); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} style={styles.collapse}>
            <Icon name={collapsed.has(item.id) ? 'next' : 'down'} color={INK.quiet} size={18} />
          </Pressable> : null}
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.title || 'Untitled chapter'}${done ? ', downloaded' : ''}`}
            accessibilityState={{ checked: picked, disabled: !ids.length }} disabled={!ids.length} onPress={() => toggle(ids)} style={styles.chapter}>
            <View style={{ flex: 1 }}><Text style={[styles.title, children && { fontWeight: '600' }]} numberOfLines={2}>{item.title || 'Untitled chapter'}</Text>
              {!done && (busy(item.id) || count || task?.failed.includes(item.id)) ? <Text style={styles.secondary}>
                {task?.failed.includes(item.id) ? 'Failed · ' : ''}{item.prepared === false ? 'Waiting for preparation' : `${count} / ${chapterTextCount(item)}`}
              </Text> : null}</View>
            {done && !manage ? <View style={styles.downloaded}><Icon name="check" color={INK.reading} size={19} /><Text style={styles.small}>Downloaded</Text></View> :
              <View style={[styles.circle, picked && styles.checked]}>{picked ? <Icon name="check" color={INK.page} size={17} /> : null}</View>}
          </Pressable>
        </View>;
      }} />
    {otherVoices.length ? <View style={styles.other}>{otherVoices.map((v) => <Pressable key={`${v.provider}/${v.voice}`} accessibilityRole="button"
      onPress={() => { setSelected(new Set()); if (manage) setManagedVoice(v); else onVoice?.(v); }}><Text style={styles.link}>{manage ? 'Manage' : 'Use downloaded voice'} · {v.label}</Text></Pressable>)}</View> : null}
    <View style={styles.footer}>
      <Pressable accessibilityRole="button" onPress={() => { setSelected(new Set()); setManage(!manage); setManagedVoice(null); }}><Text style={styles.link}>{manage ? 'Back to downloads' : 'Manage downloads'}</Text></Pressable>
      {!manage ? <Text style={styles.small}>Generating audio may incur speech service charges.</Text> : null}
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
  secondary: { color: INK.quiet, fontSize: 13 }, small: { color: INK.quiet, fontSize: 11 }, error: { color: INK.text, fontSize: 13 },
  preparing: { padding: 20, gap: 14, alignItems: 'center' }, list: { height: 330, flexGrow: 0, flexShrink: 1 },
  row: { minHeight: 62, flexDirection: 'row', borderBottomColor: INK.line, borderBottomWidth: StyleSheet.hairlineWidth },
  chapter: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12, paddingVertical: 12 }, title: { color: INK.text, fontSize: 16 },
  collapse: { width: 30, alignItems: 'center', justifyContent: 'center' }, circle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: INK.quiet, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: INK.reading, borderColor: INK.reading }, downloaded: { alignItems: 'center', gap: 3 },
  footer: { gap: 6 }, button: { backgroundColor: INK.text, borderRadius: 24, alignItems: 'center', paddingVertical: 15 }, buttonText: { color: INK.page, fontWeight: '600', fontSize: 16 }, other: { gap: 4 },
});
