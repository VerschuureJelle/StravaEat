import type { ExpoConfig } from 'expo/config'
import baseConfig from './app.json'

// EAS sets EAS_BUILD=true during builds. In Expo Go this is undefined.
// react-native-purchases needs native code so we only add its plugin for real builds.
const isEasBuild = !!process.env.EAS_BUILD

const config: ExpoConfig = {
  ...baseConfig.expo,
  plugins: [
    ...(baseConfig.expo.plugins as any[]),
    ...(isEasBuild ? ['react-native-purchases'] : []),
  ],
}

export default config
