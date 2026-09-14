import { registerRootComponent } from 'expo';
import React from 'react';

import App from './App';
import { ErrorBoundary } from './src/components/ErrorBoundary';

function RootApp() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(RootApp);
