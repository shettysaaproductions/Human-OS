import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';

export function SplashScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>⬡</Text>
      <Text style={styles.title}>HumanOS</Text>
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
  logo: {
    fontSize: 52,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
    marginBottom: 40,
  },
  spinner: {
    marginTop: 8,
  },
});

