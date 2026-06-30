import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function SplashScreen() {
  return (
    <View style={styles.container}>
      <Text style={{ color: '#fff' }}>HumanOS Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111827' }
});
