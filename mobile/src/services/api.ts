import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Assuming local dev for now. Use 10.0.2.2 for Android emulator, localhost for iOS simulator
// We'll define a utility to resolve this depending on the platform, but for now we can just use localhost
import { Platform } from 'react-native';
const BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

export const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to attach the JWT token
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Error fetching token from SecureStore', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);
