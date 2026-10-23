/**
 * The Library's pages on the native stack (#317): `Library` for the root and
 * one `Folder` page per Folder, so the phone draws the slide in, the back arrow
 * and the back swipe. Pure, so it is tested without a navigator.
 */
import type { FolderId, FolderTree } from '../core/folders';

type Route = { key?: string; name: string; params?: object };
export type LibraryRoute = { name: 'Library' } | { name: 'Folder'; params: { id: FolderId } };

/** The Folder a Library page shows: `null` for the root, `undefined` for a page that is not the Library's. */
export function routeFolder(route: Route): FolderId | null | undefined {
  if (route.name === 'Library') return null;
  if (route.name !== 'Folder') return undefined;
  const id = (route.params as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' ? id : undefined;
}

/** The pages from the Library down to `folder`; the root alone when it no longer exists. */
export function folderRoutes(tree: FolderTree, folder: FolderId | null): LibraryRoute[] {
  const path: FolderId[] = [];
  const seen = new Set<FolderId>();
  for (let id = folder; id !== null && !seen.has(id); ) {
    const found = tree.folders.find((one) => one.id === id);
    if (!found) return [{ name: 'Library' }];
    seen.add(id);
    path.unshift(id);
    id = found.parent;
  }
  return [{ name: 'Library' }, ...path.map((id): LibraryRoute => ({ name: 'Folder', params: { id } }))];
}

/**
 * A Folder page's title and its back button's: the Folder's name, and the name
 * of the page behind it. Both from the tree, because the back button otherwise
 * takes the page behind's own title, which iOS has not set on a page put under
 * it by `reconcileFolderStack` and never shown; it then reads `Back`.
 */
export function folderPageNames(tree: FolderTree, folder: FolderId): { title: string; backTitle: string } {
  const found = tree.folders.find((one) => one.id === folder);
  const parent = found?.parent == null ? undefined : tree.folders.find((one) => one.id === found.parent);
  return { title: found?.name ?? '', backTitle: parent?.name ?? 'Library' };
}

/**
 * `null` while the stack's Library pages are the path to the deepest of them;
 * otherwise the routes it should hold. That Folder deleted returns to the root,
 * as the Library did before (design 0069); moved, its new path is built. Pages
 * that stay keep their keys, so they stay mounted, and every page after the
 * Library pages (a Reader opened inside the Folder) is kept.
 *
 * Only a drawer left open over a page that was pushed after it can change a
 * Folder whose page is open; this keeps that from leaving a page for a Folder
 * that is not there, or a back swipe to a Folder it is no longer in.
 */
export function reconcileFolderStack<R extends Route>(routes: readonly R[], tree: FolderTree): (R | LibraryRoute)[] | null {
  let end = 0;
  while (end < routes.length && routeFolder(routes[end]) !== undefined) end++;
  const pages = routes.slice(0, end);
  const top = pages.length ? routeFolder(pages[pages.length - 1]) ?? null : null;
  const wanted = folderRoutes(tree, top);
  const same = wanted.length === pages.length && wanted.every((route, i) => routeFolder(route) === routeFolder(pages[i]));
  if (same) return null;
  const kept = wanted.map((route) => pages.find((page) => page.name === route.name && routeFolder(page) === routeFolder(route)) ?? route);
  return [...kept, ...routes.slice(end)];
}
