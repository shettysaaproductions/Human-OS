import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

export function SplashScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#8B5CF6" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    // Hard-coded dark background — never white, even before ThemeContext loads
    backgroundColor: '#09090B',
  }
});
