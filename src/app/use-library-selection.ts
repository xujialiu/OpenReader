import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { asDocumentId } from '../core/document';
import { folderAt, selectionPlan, targetKey, type LibraryTarget } from '../core/folders';
import type { ScreenProps } from './routes';
import { useShell } from './routes';

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Selection is page-local; submitted work survives blur, but its completion cannot restore an old selection. */
export function useLibrarySelection(navigation: Pick<ScreenProps<'Library'>['navigation'], 'addListener'>, rows: readonly LibraryTarget[], remove: (id: string) => Promise<void>) {
  const { library } = useShell();
  const [active, setActive] = useState(false);
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const locked = useRef(false);
  const generation = useRef(0);
  const latest = useRef(library);
  useLayoutEffect(() => { latest.current = library; }, [library]);
  const selected = rows.filter((row) => keys.has(targetKey(row)));
  const clear = useCallback(() => {
    generation.current++;
    setActive(false); setKeys(new Set()); setMoving(false); setConfirming(false);
  }, []);
  useEffect(() => navigation.addListener('blur', clear), [navigation, clear]);
  useEffect(() => () => { generation.current++; }, []);

  const begin = () => {
    if (locked.current || library.folders.getSnapshot().busy) return;
    generation.current++;
    setKeys(new Set()); setActive(true);
  };
  const toggle = (target: LibraryTarget) => {
    if (locked.current || moving || confirming) return;
    setKeys((was) => {
      const next = new Set(was); const key = targetKey(target);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const selectAll = () => {
    if (locked.current || moving || confirming) return;
    setKeys(selected.length === rows.length ? new Set() : new Set(rows.map(targetKey)));
  };
  const label = (target: LibraryTarget) => target.kind === 'folder'
    ? folderAt(library.folderSnapshot.tree, target.id).name
    : library.entries.find((entry) => entry.id === target.id)?.title ?? target.id;

  const deleteSelected = () => {
    if (locked.current || !selected.length || confirming) return;
    const token = generation.current;
    const batch = selected.map((target) => ({ ...target }));
    const names = batch.map(label);
    const snapshot = library.folders.getSnapshot().tree;
    const documentIds = library.entries.map((entry) => entry.id);
    let plan: ReturnType<typeof selectionPlan>;
    try { plan = selectionPlan(snapshot, batch, documentIds); }
    catch (error) { library.report(describe(error)); return; }
    setConfirming(true);
    Alert.alert('Delete selected entries?',
      `This will delete ${plan.documents.size} document${plan.documents.size === 1 ? '' : 's'} and ${plan.folders.size} folder${plan.folders.size === 1 ? '' : 's'}. ` +
      'Reading and downloads for these documents will stop, and their downloaded audio will be deleted. The original files are kept. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel', onPress: () => setConfirming(false) },
        { text: 'Delete', style: 'destructive', onPress: () => {
          if (token !== generation.current || locked.current) return;
          setConfirming(false);
          const now = latest.current;
          try {
            const currentPlan = selectionPlan(now.folders.getSnapshot().tree, batch, now.entries.map((entry) => entry.id));
            if (now.folders.getSnapshot().tree !== snapshot || currentPlan.documents.size !== plan.documents.size ||
                [...currentPlan.documents].some((id) => !plan.documents.has(id))) {
              throw new Error('The selected contents changed. Review them and confirm deletion again.');
            }
          } catch (error) { now.report(describe(error)); return; }
          locked.current = true; setWorking(true);
          let completed = 0;
          void now.folders.deleteEntries(batch, now.entries.map((entry) => entry.id), async (id) => {
            const document = asDocumentId(id);
            if (!document || !latest.current.current(document)) throw new Error('That document is no longer in the Library.');
            await remove(id);
          }, (target) => {
            completed++;
            if (token === generation.current) setKeys((was) => { const next = new Set(was); next.delete(targetKey(target)); return next; });
          }).then(() => {
            if (token === generation.current) clear();
          }).catch((error: unknown) => {
            now.report(`Deletion stopped at “${names[completed]}”. ${describe(error)} ` +
              `Completed: ${names.slice(0, completed).join(', ') || 'none'}. Not attempted: ${names.slice(completed + 1).join(', ') || 'none'}. ` +
              'The failed entry may already have lost some contents or downloaded audio. Remaining entries have been kept.');
          }).finally(() => { locked.current = false; setWorking(false); });
        } },
      ]);
  };
  return {
    active, selected, moving, working, confirming, begin, toggle, selectAll, deleteSelected,
    cancel: () => { if (!locked.current) clear(); },
    openMove: () => { if (!locked.current && selected.length) setMoving(true); },
    closeMove: () => setMoving(false),
    moved: clear,
  };
}
