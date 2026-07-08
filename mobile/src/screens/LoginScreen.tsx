import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as Updates from 'expo-updates';
import { authService } from '../services/authService';
import { useAuthStore } from '../store/useAuthStore';
import { useNavigation } from '@react-navigation/native';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigation = useNavigation<any>();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    setLoading(true);
    try {
      const data = await authService.login(email, password);
      // Save both tokens — the store persists them to SecureStore
      await login(data.access_token, data.refresh_token, data.user);
    } catch (err: any) {
      Alert.alert('Login Failed', err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome Back to HumanOS</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      
      {loading ? (
        <ActivityIndicator size="large" color="#0000ff" />
      ) : (
        <Button title="Login" onPress={handleLogin} />
      )}

      <View style={styles.spacer} />
      <Button 
        title="Need an account? Sign Up" 
        onPress={() => navigation.navigate('Signup')} 
        color="#888" 
      />
      <Text style={styles.versionStamp}>
        Bundle: {Updates.updateId?.slice(0, 8) ?? 'embedded'} | Runtime: {Updates.runtimeVersion ?? 'N/A'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    justifyContent: 'center', 
    padding: 20,
    backgroundColor: '#09090B',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 40,
    textAlign: 'center',
    color: '#FFFFFF',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
    color: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  spacer: {
    height: 20
  },
  versionStamp: {
    marginTop: 24,
    fontSize: 10,
    color: '#bbb',
    textAlign: 'center',
  }
});

