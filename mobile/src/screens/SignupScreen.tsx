import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { authService } from '../services/authService';
import { useAuthStore } from '../store/useAuthStore';
import { useNavigation } from '@react-navigation/native';

export function SignupScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigation = useNavigation<any>();

  const handleSignup = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const data = await authService.signup(email.trim(), password);
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (data.access_token) {
        await login(data.access_token, data.refresh_token, data.user);
      } else {
        Alert.alert(
          'Check Your Email',
          'A confirmation link has been sent to ' + email + '. Please verify your email then come back to log in.',
          [{ text: 'OK', onPress: () => navigation.navigate('Login' as never) }]
        );
      }
    } catch (err: any) {
      Alert.alert('Signup Failed', err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.brand}>Nova</Text>
      <Text style={styles.title}>Create your account</Text>
      <Text style={styles.subtitle}>Join Human OS and start talking to Nova</Text>

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
        placeholder="Password (min 6 characters)"
        placeholderTextColor="#71717A"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password-new"
      />

      {loading ? (
        <ActivityIndicator size="large" color="#8B5CF6" style={styles.loader} />
      ) : (
        <TouchableOpacity style={styles.primaryBtn} onPress={handleSignup} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Sign Up</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.linkBtn}>
        <Text style={styles.linkText}>Already have an account? Log In</Text>
      </TouchableOpacity>
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
});

