import { registerRootComponent } from 'expo';

// Debug Mode's record, set up before the app's own modules run (ADR 0054).
import './src/debug/launch';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
