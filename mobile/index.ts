import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import React from 'react';

import App from './App';
import { ErrorBoundary } from './src/components/ErrorBoundary';

// Use React.createElement (no JSX) so this file stays as .ts
// (package.json main field points to index.ts — Metro requires this exact name)
function RootApp() {
  return React.createElement(ErrorBoundary, null, React.createElement(App));
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App).
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
registerRootComponent(RootApp);
