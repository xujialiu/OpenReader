import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { chapterTextCount, descendants, fullyPrepared, type Chapter, type DownloadTask, type OfflineVoice, type TaskState } from '../offline/model';
import * as downloads from '../offline/runtime';
import { INK, useAccent, useBorders } from './controls';
import { DownloadRing } from './download-ring';
import { listedInManage, marker, readingChapter, type Marker } from './download-rows';
import { DRAWER, DrawerList, DrawerRow, DrawerRowText, type DrawerAction } from './drawer';
import { Icon } from './icon';
import { useSweep } from './use-sweep';
import { TEXT } from './text-styles';

/**
 * The download's state, on its own line above the list for when its rows are
 * out of sight, with what went wrong. Paused has no words: Resume all, at the
 * end of the same line, already says it (#56).
 */
const STATE_LINE: Partial<Record<TaskState, string>> = {
  preparing: 'Preparing selected chapter…', downloading: 'Downloading…', queued: 'Queued', waiting: 'No network connection, waiting to reconnect',
  blocked: 'Needs attention', interrupted: 'Interrupted · continues when available',
};
const stateLine = (task: DownloadTask) => task.state === 'done' ? task.failed.length ? `${task.failed.length} chapters failed` : 'Selected chapters downloaded' : STATE_LINE[task.state];

/**
 * **Download**, and **Manage**, two pages of a Document's actions drawer
 * (#117), laid out as Contents is.
 *
 * The chapters are the drawer's plain list (`DrawerList`, `DrawerRow`): each
 * title in full, set in by its level, the chapter being read marked as Contents
 * marks it, and the list opened at it (#88). Each row keeps its own controls at
 * its right, in one column so they line up: the selection circle, the check of
 * a chapter saved, the ring of one being written, and a volume's arrow before
 * them. Two fingers over the list select the rows under them (#57, ADR 0045).
 *
 * Over the list: the voice, the count, and the download's state with Pause all
 * or Resume all at its end. Under it, fixed whatever the list is scrolled to:
 * the other voices with saved audio, and Download selected, or on Manage,
 * Delete all saved audio and Delete selected. Select all is the drawer's header
 * action, handed up through `onSelectAll`, because only this knows the rows.
 *
 * `manage` is which page this is. Manage lists only what has audio to delete
 * (#37), and is reached from Download's count line, since it manages what the
 * count counts.
 *
 * @param section The spine item the reading is in, as the Contents is given it,
 * or null when there is none: the row it names is marked, and the list opens at
 * it (#88).
 */
export function DownloadContent({ document, title, voice, section, manage, onManage, onSelectAll, onVoice, onStart }: {
  document: string; title: string; voice: OfflineVoice; section: number | null;
  manage: boolean;
  /** Go to Manage (`true`), or back to Download. */
  onManage(open: boolean): void;
  /** The header's Select all / Deselect all, or null when this page is gone. */
  onSelectAll: Dispatch<SetStateAction<DrawerAction | null>>;
  onVoice?(voice: OfflineVoice): void; onStart?(): void;
}) {
  downloads.useDownloads();
  const borders = useBorders();
  const accent = useAccent();
  const link = [styles.link, { color: accent.reading }];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [managedVoice, setManagedVoice] = useState<OfflineVoice | null>(null);
  // Going to Manage and back starts a fresh selection, in the download's own voice.
  const [page, setPage] = useState(manage);
  if (page !== manage) {
    setPage(manage);
    setSelected(new Set());
    setManagedVoice(null);
  }
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
  const { byId, parents } = useMemo(() => ({
    byId: new Map(chapters.map((c) => [c.id, c])), parents: new Set(chapters.map((c) => c.parent)),
  }), [chapters]);
  const unfolded = (chapter: Chapter) => {
    for (let parent = chapter.parent; parent; parent = byId.get(parent)?.parent ?? null) if (collapsed.has(parent)) return false;
    return true;
  };
  // What Download lists; Manage lists fewer (#37).
  const rows = chapters.filter((c) => (textual(c) || parents.has(c.id)) && unfolded(c));
  const visible = listed ? chapters.filter((c) => listed.has(c.id) && unfolded(c)) : rows;
  // Two fingers over the list select the rows under them (#57).
  const sweep = useSweep({ shown: visible, chapters, collapsed, choosable: eligibleIds, selected }, setSelected);
  // Found among Download's rows even in Manage, which marks it only if it
  // lists it: its nearest listed row would be another chapter.
  const here = readingChapter(rows, section);
  const hereIndex = here === null ? -1 : visible.findIndex((c) => c.id === here);

  // The header's Select all, whose press always reads the rows as they are now.
  const everything = useRef<() => void>(() => {});
  useEffect(() => { everything.current = () => toggle(eligible.map((c) => c.id)); });
  const pressAll = useCallback(() => everything.current(), []);
  const allLabel = eligible.length && chosen.length === eligible.length ? 'Deselect all' : 'Select all';
  const noneEligible = !eligible.length;
  useEffect(() => { onSelectAll({ label: allLabel, onPress: pressAll, disabled: noneEligible }); }, [allLabel, noneEligible, pressAll, onSelectAll]);
  useEffect(() => () => onSelectAll(null), [onSelectAll]);

  const full = chapters.filter(textual).length;
  const completed = [...progress.values()].filter((p) => p.complete).length;
  const whole = !!plan && fullyPrepared(plan) && full > 0 && completed === full;
  const state = downloads.indexingState(document);
  const otherVoices = downloads.savedVoices(document).filter((v) => !downloads.sameVoice(v, choice) && downloads.occupied(document, v) > 0);
  // Nothing saved for any voice and nothing under way: there is nothing to manage, so Manage is not offered (#37).
  const manageable = downloads.occupied(document) > 0 || downloads.downloadTasks(document).some((t) => t.state !== 'done');
  const status = task && task.chapters.length > 0 && !manage && !(task.state === 'done' && !task.failed.length && whole) ? task : null;
  const act = () => {
    try {
      if (manage) Alert.alert('Delete downloaded audio?', 'The document and reading position will be kept.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => {
          void downloads.deleteDownloaded(document, choice, chosen).then(()=>setSelected(new Set()),e=>Alert.alert('Could not delete audio',String(e)));
        } },
      ]);
      // The Provider is asked about first (#109): "Don't Allow" starts nothing and keeps the selection.
      else void downloads.startDownload(document, choice, chosen).then((started) => {
        if (!started) return;
        onStart?.();
        setSelected(new Set());
      }, (e) => Alert.alert('Download could not start', String(e)));
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
          setSelected(new Set()); onManage(false); downloads.requestPlan(document, title);
        }, (e) => Alert.alert('Could not delete audio', String(e)));
      } },
    ]);

  const chapterRow = (item: Chapter) => {
    const children = chapters.some((c) => c.parent === item.id);
    const group = descendants(chapters, item.id);
    const ids = group.map((c) => c.id).filter((id) => eligibleIds.has(id));
    const done = group.length > 0 && group.every((c) => progress.get(c.id)?.complete);
    const picked = ids.length > 0 && ids.every((id) => selected.has(id));
    const count = progress.get(item.id)?.count ?? 0;
    const failed = !!task?.failed.includes(item.id);
    const mark = children ? null : markers.get(item.id);
    // Marked as Contents marks the row being read (#88), on both pages.
    const current = item.id === here;
    // The accent a step further on the marked row, which is a step off the drawer (`accent.ts`).
    const ink = current ? accent.onMark : accent.reading;
    const name = item.title || 'Untitled chapter';
    const label = `${name}${current ? ', being read' : ''}`;
    const folded = collapsed.has(item.id);
    const arrow = children ? <Pressable accessibilityRole="button" accessibilityLabel={`${folded ? 'Expand' : 'Collapse'} ${item.title}`} hitSlop={8}
      onPress={() => setCollapsed((was) => { const next = new Set(was); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}
      style={styles.arrow}>
      <Icon name={folded ? 'next' : 'down'} color={INK.quiet} size={20} strokeWidth={2} />
    </Pressable> : null;
    const words = <>
      <DrawerRowText emphasized={current || children} style={current && { color: ink }}>{name}</DrawerRowText>
      {!done && (count || failed) ? <Text style={styles.count}>{failed ? 'Failed · ' : ''}{count} / {chapterTextCount(item)}</Text> : null}
    </>;
    if (mark?.kind === 'ring' && task) {
      return <DrawerRow level={item.depth} marked={current} accessibilityLabel={label}
        accessory={<>{arrow}<DownloadRing colour={ink} fraction={mark.fraction} spinning={mark.spinning} halted={mark.halted} onPress={() => downloads.toggleChapter(task, item.id)} /></>}>
        {words}
      </DrawerRow>;
    }
    const box = done && !manage ? <Icon name="check" color={ink} size={22} />
      : ids.length || !children ? <View style={[styles.circle, { borderColor: picked ? ink : borders.quiet }, picked && { backgroundColor: ink }]}>
        {picked ? <Icon name="check" color={INK.page} size={17} /> : null}
      </View> : <View style={styles.column} />;
    return <DrawerRow level={item.depth} marked={current} onPress={() => toggle(ids)} disabled={!ids.length}
      accessibilityRole="checkbox" accessibilityLabel={`${label}${done ? ', downloaded' : ''}`} accessibilityState={{ checked: picked, disabled: !ids.length }}
      accessory={<>{arrow}{box}</>}>
      {words}
    </DrawerRow>;
  };

  const { ref: sweepRef, ...sweepList } = sweep.list;
  return <View style={styles.page}>
    <View style={styles.lines}>
      <Text style={styles.voice} numberOfLines={2}>Voice · {choice.label || 'Choose a voice in the player'}</Text>
      {downloads.downloadError() ? <Text style={styles.error}>{downloads.downloadError()}</Text> : null}
      {plan && !progressReady ? <Text style={styles.secondary}>Checking saved downloads…</Text> : null}
      {plan ? <View style={styles.line}>
        <Text style={[styles.secondary, styles.grow]}>{manage ? `${downloads.formatBytes(downloads.occupied(document, choice))} saved` : `${completed} chapters downloaded`}</Text>
        {!manage && manageable ? <Pressable accessibilityRole="button" onPress={() => onManage(true)} hitSlop={8} style={styles.manage}>
          <Text style={link}>Manage downloads</Text><Icon name="next" color={accent.reading} size={16} strokeWidth={2} />
        </Pressable> : null}
      </View> : null}
      {status ? <View style={styles.line}>
        <Text style={[styles.secondary, styles.grow]}>{stateLine(status)}{status.error ? `\n${status.error}` : ''}</Text>
        {status.state === 'done' ? status.failed.length ? <Pressable accessibilityRole="button" hitSlop={8} onPress={() => downloads.toggleTask(status)}>
          <Text style={link}>Retry failed</Text>
        </Pressable> : null : <Pressable accessibilityRole="button" hitSlop={8} onPress={() => downloads.toggleTask(status)}>
          <Text style={link}>{downloads.goesOn(status) ? 'Pause all' : 'Resume all'}</Text>
        </Pressable>}
      </View> : null}
    </View>
    {!plan ? <View style={styles.preparing}>
      {state?.state !== 'failed' ? <ActivityIndicator /> : null}
      <Text style={styles.secondary}>{state?.error ?? 'Loading contents…'}</Text>
      {state?.state === 'failed' ? <Pressable onPress={() => downloads.requestPlan(document, title)}><Text style={link}>Try again</Text></Pressable> : null}
    </View> : <GestureDetector gesture={sweep.gesture}>
      <DrawerList {...sweepList} listRef={sweepRef} data={visible} openAt={hereIndex > 0 ? hereIndex : null} style={styles.list}
        keyExtractor={(c) => c.id} renderItem={({ item }) => chapterRow(item)}
        ListEmptyComponent={!manage ? <Text style={[styles.secondary, styles.empty]}>No readable text in this document.</Text> : null} />
    </GestureDetector>}
    {otherVoices.map((v) => <DrawerRow key={`${v.provider}/${v.voice}`}
      onPress={() => { setSelected(new Set()); if (manage) setManagedVoice(v); else onVoice?.(v); }}>
      <DrawerRowText style={{ color: accent.reading }}>{manage ? 'Manage' : 'Use downloaded voice'} · {v.label}</DrawerRowText>
    </DrawerRow>)}
    {manage && downloads.occupied(document) > 0 ? <DrawerRow onPress={deleteEverything}>
      <DrawerRowText style={styles.destructive}>Delete all saved audio</DrawerRowText>
    </DrawerRow> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={manage ? `Delete selected (${chosen.length})` : `Download selected (${chosen.length})`}
      disabled={!progressReady || !downloads.downloadsReady() || !chosen.length || !choice.voice || !!downloads.downloadError()} onPress={act}
      style={[styles.button, (!chosen.length || !choice.voice) && styles.unready]}>
      <Text style={styles.buttonText}>{manage ? 'Delete selected' : 'Download selected'} ({chosen.length})</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  // The whole drawer under the header, so the button stays at its bottom whatever the list holds.
  page: { flex: 1 },
  lines: { gap: 4, paddingBottom: 8, paddingLeft: DRAWER.row.textInset, paddingRight: DRAWER.row.inset },
  line: { alignItems: 'center', flexDirection: 'row', gap: 16 },
  grow: { flex: 1 },
  voice: { ...TEXT.subhead, color: INK.text },
  secondary: { ...TEXT.footnote, color: INK.quiet },
  error: { ...TEXT.footnote, color: INK.text },
  link: { ...TEXT.subhead },
  manage: { alignItems: 'center', flexDirection: 'row', gap: 2 },
  preparing: { alignItems: 'center', flex: 1, gap: 14, padding: 20 },
  // Fills what the lines and the button leave it, so the button is at the drawer's bottom.
  list: { flexGrow: 1 },
  empty: { paddingLeft: DRAWER.row.textInset, paddingTop: 12 },
  count: { ...TEXT.footnote, color: INK.quiet },
  arrow: { alignItems: 'center', height: 44, justifyContent: 'center', width: 24 },
  circle: { alignItems: 'center', borderRadius: 12, borderWidth: 1.5, height: 24, justifyContent: 'center', width: 24 },
  column: { width: 24 },
  destructive: { color: INK.attention },
  button: {
    alignItems: 'center', backgroundColor: INK.text, borderRadius: 24, marginHorizontal: DRAWER.row.inset, marginTop: 12,
    paddingVertical: 15,
  },
  unready: { opacity: 0.35 },
  buttonText: { ...TEXT.headline, color: INK.page },
});
