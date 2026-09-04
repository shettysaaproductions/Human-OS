import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
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
      const data = await authService.login(email.trim(), password);
      await login(data.access_token, data.refresh_token, data.user);
    } catch (err: any) {
      Alert.alert('Login Failed', err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.brand}>Nova</Text>
      <Text style={styles.title}>Welcome back</Text>
      <Text style={styles.subtitle}>Sign in to continue chatting with Nova</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#71717A"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#71717A"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
      />

      {loading ? (
        <ActivityIndicator size="large" color="#8B5CF6" style={styles.loader} />
      ) : (
        <TouchableOpacity style={styles.primaryBtn} onPress={handleLogin} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Log In</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={() => navigation.navigate('Signup')} style={styles.linkBtn}>
        <Text style={styles.linkText}>Need an account? Sign Up</Text>
      </TouchableOpacity>
      <Text style={styles.versionStamp}>
        Bundle: {Updates.updateId?.slice(0, 8) ?? 'embedded'} | Runtime: {Updates.runtimeVersion ?? 'N/A'}
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#09090B',
  },
  brand: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#8B5CF6',
    textAlign: 'center',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 15,
    color: '#A1A1AA',
    textAlign: 'center',
    marginBottom: 36,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    fontSize: 16,
    color: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  loader: { marginVertical: 16 },
  primaryBtn: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  linkBtn: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#A1A1AA', fontSize: 15 },
  versionStamp: {
    marginTop: 28,
    fontSize: 10,
    color: '#52525B',
    textAlign: 'center',
  },
});

