const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  transformer: {
    babelTransformerPath: require.resolve('react-native-sass-transformer'),
  },
  resolver: {
    sourceExts: [...defaultConfig.resolver.sourceExts, 'scss', 'sass'],
  },
};

module.exports = mergeConfig(defaultConfig, config);
