import { OpenReader } from './src/app';

/**
 * The reader, which is the whole app (`src/app/`).
 *
 * What was here until now was a screen saying nothing was built yet, so that a
 * launch that worked could be told apart from one that did not — ADR 0018 exists
 * because iOS 27 kills the process before any JavaScript runs and reports it only
 * as a crash log. That screen said it would go when the reader arrived, and the
 * property it was protecting is kept: `src/app/reader-screen.tsx` renders
 * something at every stage, including before a document has been picked.
 */
export default function App() {
  return <OpenReader />;
}
