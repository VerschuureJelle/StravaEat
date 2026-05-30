const baseConfig = require('./app.json')

/** @type {import('expo/config').ExpoConfig} */
const config = {
  ...baseConfig.expo,
  plugins: [...(baseConfig.expo.plugins || [])],
}

module.exports = config
