import { registerRootComponent } from 'expo';

// Debug Mode's record, set up before the app's own modules run (ADR 0054).
import './src/debug/launch';
// Before Reanimated loads, which warns in development when Reduce Motion is on (#341).
import './src/app/reduced-motion-warning';
import { App } from './src/app';

registerRootComponent(App);
