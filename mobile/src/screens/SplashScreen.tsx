import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

export function SplashScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.brand}>NOVA</Text>
      <Text style={styles.sub}>Human OS</Text>
      <ActivityIndicator size="large" color="#8B5CF6" style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#09090B',
  },
  brand: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 6,
    marginBottom: 6,
  },
  sub: {
    fontSize: 13,
    color: '#A1A1AA',
    letterSpacing: 2,
    marginBottom: 28,
  },
  spinner: { marginTop: 4 },
});
