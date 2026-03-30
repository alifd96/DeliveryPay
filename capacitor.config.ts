import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.deliverysystem.app',
  appName: 'Delivery System',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
