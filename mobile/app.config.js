const baseConfig = require('./app.json')

const isEasBuild = !!process.env.EAS_BUILD

/** @type {import('expo/config').ExpoConfig} */
const config = {
  ...baseConfig.expo,
  plugins: [
    ...(baseConfig.expo.plugins || []),
    ...(isEasBuild ? ['react-native-purchases'] : []),
  ],
}

module.exports = config
